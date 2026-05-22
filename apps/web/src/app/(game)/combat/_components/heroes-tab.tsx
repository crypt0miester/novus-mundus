"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useEstate } from "@/lib/hooks/useEstate";
import { useHeroBuffs } from "@/lib/hooks/useDerived";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useWallet } from "@solana/wallet-adapter-react";
import { useConnection } from "@solana/wallet-adapter-react";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { DetailPanel } from "@/components/shared/DetailPanel";
import { GameIcon, buffStatIcon } from "@/components/shared/GameIcon";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  derivePlayerPda,
  deriveHeroTemplatePda,
  deriveHeroMintReceiptPda,
  deriveEstatePda,
  createMintHeroInstruction,
  createLevelUpHeroInstruction,
  createBurnHeroInstruction,
  createLockHeroInstruction,
  createUnlockHeroInstruction,
  createAssignDefensiveHeroInstruction,
  isNullPubkey,
  isTraveling,
  parseAssetV1,
  getActiveBuffs,
  getBuffStatMeta,
  getBuffStatByAttrKey,
  canMintHero,
  HERO_TIER_NAMES,
  HERO_TYPE_NAMES,
  HERO_CATEGORY_NAMES,
  type ParsedAssetV1,
  type HeroTemplateAccount,
} from "novus-mundus-sdk";
import { useAccountStore } from "@/lib/store/accounts";
import { useGameEngine } from "@/lib/hooks/useGameEngine";
import { useFeatureGate, FEATURES, BuildingId } from "@/lib/hooks/useFeatureGate";
import { AbilityCard } from "@/components/heroes/AbilityCard";
import { PendingEffectBadge } from "@/components/heroes/PendingEffectBadge";

const MPL_CORE_PROGRAM_ID = new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");

// ── Cost helpers (mirrors Rust logic) ────────────────────────

function fragmentCost(currentLevel: number): number {
  const BASE = 10;
  if (currentLevel === 0) return BASE;
  let cost = BASE;
  for (let i = 0; i < currentLevel; i++) {
    cost = Math.floor((cost * 3) / 2);
    if (cost > Number.MAX_SAFE_INTEGER / 2) return Infinity;
  }
  return cost;
}

function heroLevelCap(sanctuaryLevel: number): number {
  if (sanctuaryLevel === 0) return 0;
  if (sanctuaryLevel <= 4) return 10;
  if (sanctuaryLevel <= 9) return 25;
  if (sanctuaryLevel <= 14) return 50;
  return 100;
}

function tierFromMintCost(lamports: number): number {
  if (lamports >= 10_000_000_000) return 4;
  if (lamports >= 5_000_000_000) return 3;
  if (lamports >= 1_000_000_000) return 2;
  if (lamports >= 250_000_000) return 1;
  return 0;
}

function burnReward(level: number, tier: number): number {
  const bases = [500, 5_000, 20_000, 100_000, 250_000];
  const base = bases[tier] ?? 500;
  const lvl = Math.max(level, 1);
  return base * lvl * lvl;
}

// ── Types ────────────────────────────────────────────────────

interface HeroData {
  address: PublicKey;
  asset: ParsedAssetV1;
}

interface TemplateInfo {
  account: HeroTemplateAccount;
  minted: boolean;
}

type Selection =
  | { type: "locked"; slot: number; hero: HeroData }
  | { type: "unlocked"; hero: HeroData }
  | { type: "template"; info: TemplateInfo }
  | null;

const IGNORED_ATTRS = new Set(["Template", "Serial", "Origin"]);

export function HeroesTab() {
  const { data: playerData } = usePlayer();
  const { data: geData } = useGameEngine();
  const { data: estateData } = useEstate();
  const { connection } = useConnection();
  const player = playerData?.account;
  const gameEngine = geData?.account;
  const heroBuffs = useHeroBuffs();
  const client = useNovusMundusClient();
  const { publicKey } = useWallet();
  const transact = useTransact();

  const lockGate = useFeatureGate(FEATURES.HERO_LOCK);
  const levelUpGate = useFeatureGate(FEATURES.HERO_LEVEL_UP);

  // Hero templates from Zustand (live via WS)
  const heroTemplatesMap = useAccountStore((s) => s.heroTemplates);

  const [lockedHeroes, setLockedHeroes] = useState<(HeroData | null)[]>([null, null, null]);
  const [unlockedHeroes, setUnlockedHeroes] = useState<HeroData[]>([]);
  const [mintReceipts, setMintReceipts] = useState<Map<number, boolean>>(new Map());
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Selection>(null);
  const lockSlot = 0;

  const traveling = player ? isTraveling(player) : false;
  const fragments = player?.fragments?.toNumber?.() ?? 0;
  const emptySlots = player ? player.activeHeroes.filter((h: any) => isNullPubkey(h)).length : 0;
  const filledSlots = 3 - emptySlots;

  // Sanctuary level for hero level cap
  const sanctuaryLevel = useMemo(() => {
    const buildings = estateData?.account?.buildings;
    if (!buildings) return 0;
    const sanctuary = buildings.find(
      (b: any) => b.buildingType === BuildingId.Sanctuary && (b.status === 2 || b.status === 3),
    );
    return sanctuary?.level ?? 0;
  }, [estateData]);

  const levelCap = heroLevelCap(sanctuaryLevel);

  // Derive templates from Zustand
  const templates: TemplateInfo[] = useMemo(() => {
    const entries = Array.from(heroTemplatesMap.values())
      .filter((e) => e.account.enabled)
      .sort((a, b) => a.account.templateId - b.account.templateId)
      .map((e) => ({
        account: e.account,
        minted: mintReceipts.get(e.account.templateId) ?? false,
      }));
    return entries;
  }, [heroTemplatesMap, mintReceipts]);

  // Fetch mint receipts (not tracked by WS - 0-byte marker PDAs)
  useEffect(() => {
    if (!connection || !publicKey || heroTemplatesMap.size === 0) return;

    const ge = client.gameEngine;
    const [playerPda] = derivePlayerPda(ge, publicKey);
    const entries = Array.from(heroTemplatesMap.values()).filter((e) => e.account.enabled);

    const receiptPdas = entries.map(
      (e) => deriveHeroMintReceiptPda(playerPda, e.account.templateId)[0],
    );

    connection
      .getMultipleAccountsInfo(receiptPdas)
      .then((infos) => {
        const map = new Map<number, boolean>();
        entries.forEach((e, i) => {
          map.set(e.account.templateId, infos[i] !== null && infos[i]!.lamports > 0);
        });
        setMintReceipts(map);
      })
      .catch(() => {});
  }, [connection, publicKey, heroTemplatesMap, client, refreshKey]);

  // Fetch heroes: locked (player PDA via activeHeroes) + unlocked (wallet via getProgramAccounts)
  useEffect(() => {
    if (!player || !connection || !publicKey) return;

    setLoading(true);

    const mints = player.activeHeroes as PublicKey[];
    const fetchLocked = (async () => {
      const slots: (HeroData | null)[] = [null, null, null];
      const filled = mints
        .map((mint, slot) => ({ mint, slot }))
        .filter((e) => !isNullPubkey(e.mint));
      if (filled.length === 0) return slots;
      try {
        const infos = await connection.getMultipleAccountsInfo(filled.map((e) => e.mint));
        filled.forEach((e, i) => {
          const info = infos[i];
          if (!info?.data) return;
          const asset = parseAssetV1(info.data);
          if (asset) slots[e.slot] = { address: e.mint, asset };
        });
      } catch {
        // Leave slots null on RPC failure.
      }
      return slots;
    })();

    const fetchUnlocked = connection
      .getProgramAccounts(MPL_CORE_PROGRAM_ID, {
        filters: [{ memcmp: { offset: 1, bytes: publicKey.toBase58() } }],
      })
      .then((accounts) =>
        accounts
          .map(({ pubkey, account }) => {
            try {
              const asset = parseAssetV1(account.data);
              if (!asset) return null;
              if (!asset.attributes["Template"]) return null;
              return { address: pubkey, asset } as HeroData;
            } catch {
              return null;
            }
          })
          .filter((h): h is HeroData => h !== null),
      )
      .catch(() => [] as HeroData[]);

    Promise.all([fetchLocked, fetchUnlocked]).then(([locked, unlocked]) => {
      setLockedHeroes(locked);
      setUnlockedHeroes(unlocked);
      setLoading(false);

      // Keep the detail-panel selection pointed at the freshly-fetched NFT
      // data. Level-up / lock / unlock mutate NFT attributes, so the
      // previously selected HeroData object is stale after a refetch.
      setSelected((prev) => {
        if (!prev) {
          // Initial auto-select on desktop.
          if (typeof window === "undefined" || window.innerWidth < 1024) return prev;
          const firstLocked = locked.findIndex((h) => h !== null);
          if (firstLocked >= 0 && locked[firstLocked]) {
            return { type: "locked", slot: firstLocked, hero: locked[firstLocked]! };
          }
          if (unlocked.length > 0) return { type: "unlocked", hero: unlocked[0] };
          return prev;
        }
        if (prev.type === "template") return prev;

        // Re-resolve the selected hero by address — it may have moved between
        // the locked slots and the wallet (lock/unlock), or be gone (burn).
        const addr = prev.hero.address;
        const lockedSlot = locked.findIndex((h) => h?.address.equals(addr));
        if (lockedSlot >= 0 && locked[lockedSlot]) {
          return { type: "locked", slot: lockedSlot, hero: locked[lockedSlot]! };
        }
        const unlockedHero = unlocked.find((h) => h.address.equals(addr));
        if (unlockedHero) return { type: "unlocked", hero: unlockedHero };
        return null;
      });
    });
  }, [player, connection, publicKey, refreshKey]);

  // ── Handlers ─────────────────────────────────────────────

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  const handleMint = async (templateId: number, reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !gameEngine) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const heroMintKeypair = Keypair.generate();
    const ix = createMintHeroInstruction(
      {
        minter: publicKey,
        gameEngine: ge,
        heroMint: heroMintKeypair.publicKey,
        treasury: gameEngine.treasuryWallet,
      },
      { templateId },
    );
    return transact
      .mutateAsync({
        instructions: [ix],
        signers: [heroMintKeypair],
        invalidateKeys: [["player"]],
        successMessage: "Hero minted!",
        onPhase: reportPhase,
      })
      .then((r) => {
        refresh();
        return r.signature;
      });
  };

  const handleLock = async (
    heroAddress: PublicKey,
    slotIndex: number,
    templateId: number,
    reportPhase: (p: TxPhase) => void,
  ) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const [playerPda] = derivePlayerPda(ge, publicKey);
    const [heroTemplate] = deriveHeroTemplatePda(templateId);
    const [estateAccount] = deriveEstatePda(playerPda);
    const ix = createLockHeroInstruction(
      { owner: publicKey, gameEngine: ge, heroMint: heroAddress, heroTemplate, estateAccount },
      { slotIndex },
    );
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"]],
        successMessage: "Hero locked!",
        onPhase: reportPhase,
      })
      .then((r) => {
        refresh();
        return r.signature;
      });
  };

  const handleUnlock = async (slotIndex: number, reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !player) throw new Error("Wallet not connected");
    const heroMint = player.activeHeroes[slotIndex];
    if (!heroMint || isNullPubkey(heroMint)) throw new Error("No hero in slot");
    const ge = client.gameEngine;
    const [playerPda] = derivePlayerPda(ge, publicKey);
    const heroData = lockedHeroes[slotIndex];
    const templateId = heroData?.asset?.attributes["Template"]
      ? parseInt(heroData.asset.attributes["Template"])
      : 0;
    const [heroTemplate] = deriveHeroTemplatePda(templateId);
    const [estateAccount] = deriveEstatePda(playerPda);
    const ix = createUnlockHeroInstruction(
      { owner: publicKey, gameEngine: ge, heroMint, heroTemplate, estateAccount },
      { slotIndex },
    );
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"]],
        successMessage: "Hero unlocked!",
        onPhase: reportPhase,
      })
      .then((r) => {
        refresh();
        return r.signature;
      });
  };

  const handleAssignDefensive = async (slotIndex: number, reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const ix = createAssignDefensiveHeroInstruction(
      { owner: publicKey, gameEngine: ge },
      { slotIndex },
    );
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"]],
        successMessage: "Defensive hero assigned!",
        onPhase: reportPhase,
      })
      .then((r) => {
        refresh();
        return r.signature;
      });
  };

  const handleLevelUp = async (
    heroMint: PublicKey,
    templateId: number,
    reportPhase: (p: TxPhase) => void,
  ) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const [playerPda] = derivePlayerPda(ge, publicKey);
    const [heroTemplate] = deriveHeroTemplatePda(templateId);
    const [estateAccount] = deriveEstatePda(playerPda);
    const ix = createLevelUpHeroInstruction({
      owner: publicKey,
      gameEngine: ge,
      heroMint,
      heroTemplate,
      estateAccount,
    });
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"]],
        successMessage: "Hero leveled up!",
        onPhase: reportPhase,
      })
      .then((r) => {
        refresh();
        return r.signature;
      });
  };

  const handleBurn = async (
    heroAddress: PublicKey,
    templateId: number,
    reportPhase: (p: TxPhase) => void,
  ) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const ix = createBurnHeroInstruction(
      { owner: publicKey, gameEngine: ge, heroAsset: heroAddress },
      { templateId },
    );
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"]],
        successMessage: "Hero burned! NOVI credited.",
        onPhase: reportPhase,
      })
      .then((r) => {
        refresh();
        return r.signature;
      });
  };

  if (!player) return null;

  // ── Detail panel helpers ─────────────────────────────────

  const selectedHero =
    selected?.type === "locked" || selected?.type === "unlocked" ? selected.hero : null;
  const selectedTemplate = selected?.type === "template" ? selected.info : null;

  const selectedAttrs = selectedHero?.asset?.attributes ?? {};
  const selectedLevel = selectedAttrs["Level"] ? parseInt(selectedAttrs["Level"]) : null;
  const selectedXp = selectedAttrs["XP"] ? parseInt(selectedAttrs["XP"]) : null;
  const selectedBuffs = Object.entries(selectedAttrs).filter(
    ([key]) => !IGNORED_ATTRS.has(key) && key !== "Level" && key !== "XP",
  );

  const isHeroSelected = (addr: PublicKey) => selectedHero?.address.toBase58() === addr.toBase58();
  const isTemplateSelected = (id: number) => selectedTemplate?.account.templateId === id;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {/* ── Left: lists ── */}
      <div className="space-y-4 lg:col-span-2">
        {/* Pending ability effect status (only renders when an effect is armed) */}
        <PendingEffectBadge variant="block" />

        {/* Buffs summary */}
        {heroBuffs.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {heroBuffs.map((buff) => {
              const icon = buffStatIcon(buff.stat);
              return (
                <div
                  key={buff.label}
                  className="flex items-center gap-1.5 rounded-md border border-zinc-800 bg-surface px-2.5 py-1"
                >
                  {icon && <GameIcon id={icon} title={buff.label} size={16} />}
                  <span className="text-xs font-bold text-text-gold">
                    +{(buff.bps / 100).toFixed(1)}%
                  </span>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex items-center gap-4 text-xs text-text-muted">
          <span>{filledSlots}/3 slots</span>
          <span>Fragments: {fragments.toLocaleString()}</span>
          {levelCap > 0 && <span>Cap: Lv{levelCap}</span>}
          {traveling && <span className="text-danger">Traveling</span>}
          {loading && <span>Loading heroes...</span>}
        </div>

        {/* Active Slots */}
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
            Active Slots
          </h3>
          <div className="grid gap-2 grid-cols-3">
            {[0, 1, 2].map((i) => {
              const hero = lockedHeroes[i];
              const isEmpty = isNullPubkey(player.activeHeroes[i]);
              const isDefensive = player.defensiveHeroSlot === i;
              const isMeditating = player.meditatingHeroSlot === i;
              const attrs = hero?.asset?.attributes ?? {};
              const level = attrs["Level"] ? parseInt(attrs["Level"]) : null;
              const roleLabel = isDefensive ? "DEF" : isMeditating ? "MED" : "ACT";
              const roleColor = isDefensive
                ? "text-blue-400"
                : isMeditating
                  ? "text-fuchsia-400"
                  : "text-green-400";

              if (isEmpty) {
                return (
                  <div key={i} className="card flex items-center justify-center py-4 opacity-40">
                    <span className="text-xs text-text-muted">Empty</span>
                  </div>
                );
              }

              return (
                <div
                  key={i}
                  onClick={() => hero && setSelected({ type: "locked", slot: i, hero })}
                  className={`card cursor-pointer transition-all ${
                    hero && isHeroSelected(hero.address) ? "ring-1 ring-[var(--nm-accent)]" : ""
                  } ${isMeditating ? "accent-border-bright" : "accent-border"}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-text-primary">
                        {hero?.asset?.name || `Hero #${i + 1}`}
                      </div>
                      <div className={`text-[10px] font-medium ${roleColor}`}>
                        {roleLabel} · Slot {i}
                      </div>
                    </div>
                    {level != null && (
                      <div className="ml-2 text-lg font-bold text-text-gold">{level}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Available Heroes (unlocked, in wallet) */}
        {unlockedHeroes.length > 0 && (
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
              Available ({unlockedHeroes.length})
            </h3>
            <div className="grid gap-2 grid-cols-3">
              {unlockedHeroes.map((hero) => {
                const attrs = hero.asset.attributes;
                const level = attrs["Level"] ? parseInt(attrs["Level"]) : null;
                return (
                  <div
                    key={hero.address.toBase58()}
                    onClick={() => setSelected({ type: "unlocked", hero })}
                    className={`card cursor-pointer border-dashed transition-all ${
                      isHeroSelected(hero.address)
                        ? "ring-1 ring-[var(--nm-accent)]"
                        : "border-zinc-700"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-text-primary">
                          {hero.asset.name || "Hero"}
                        </div>
                        <div className="text-[10px] font-medium text-text-gold">Unlocked</div>
                      </div>
                      {level != null && (
                        <div className="ml-2 text-lg font-bold text-text-gold">{level}</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Template Picker */}
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
            Templates
          </h3>
          {templates.length === 0 ? (
            <div className="card py-6 text-center text-xs text-text-muted">
              No hero templates found
            </div>
          ) : (
            <div className="grid gap-2 grid-cols-2 sm:grid-cols-3">
              {templates.map((t) => {
                const buffs = getActiveBuffs(t.account);
                const supply =
                  t.account.supplyCap > 0
                    ? `${t.account.mintedCount}/${t.account.supplyCap}`
                    : `${t.account.mintedCount}`;

                return (
                  <div
                    key={t.account.templateId}
                    onClick={() => setSelected({ type: "template", info: t })}
                    className={`card cursor-pointer transition-all ${
                      t.minted ? "opacity-50 border-green-900/40" : ""
                    } ${isTemplateSelected(t.account.templateId) ? "ring-1 ring-[var(--nm-accent)]" : ""}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-text-primary">
                          {t.account.name}
                        </div>
                        <div className="text-[10px] text-text-muted">
                          #{t.account.templateId} · {supply}
                        </div>
                      </div>
                      {t.minted && (
                        <span className="shrink-0 rounded-full bg-green-900/30 px-2 py-0.5 text-[10px] font-medium text-green-400">
                          Minted
                        </span>
                      )}
                    </div>
                    {buffs.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {buffs.map((b) => {
                          const icon = buffStatIcon(b.stat);
                          return (
                            <span
                              key={b.stat}
                              className="flex items-center gap-1 rounded bg-surface px-1 py-0.5 text-[10px] text-text-muted"
                            >
                              {icon ? (
                                <GameIcon
                                  id={icon}
                                  title={getBuffStatMeta(b.stat)?.name}
                                  size={13}
                                />
                              ) : (
                                <>{getBuffStatMeta(b.stat)?.abbr ?? "?"}</>
                              )}
                              <span className="font-mono text-text-secondary">{b.baseBps}</span>
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Right: Detail Panel ── */}
      <DetailPanel open={!!selected} onClose={() => setSelected(null)}>
        {/* ── Hero Detail (locked or unlocked) ── */}
        {selectedHero && (
          <>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-base font-semibold text-text-primary">
                  {selectedHero.asset.name || "Hero"}
                </div>
                <div className="text-[10px] text-text-muted">
                  {selected?.type === "locked"
                    ? `Locked · Slot ${(selected as { slot: number }).slot}`
                    : "Unlocked · In Wallet"}
                </div>
              </div>
              {selectedLevel != null && (
                <div className="text-right">
                  <div className="text-2xl font-bold text-text-gold">{selectedLevel}</div>
                  <div className="text-[9px] text-text-muted">LEVEL</div>
                </div>
              )}
            </div>

            {selectedXp != null && (
              <div className="text-xs text-text-muted">
                XP: <span className="font-mono">{selectedXp.toLocaleString()}</span>
              </div>
            )}

            {/* Buffs */}
            {selectedBuffs.length > 0 && (
              <div>
                <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                  Buffs
                </div>
                <div className="space-y-1">
                  {selectedBuffs.map(([key, value]) => {
                    const meta = getBuffStatByAttrKey(key);
                    const icon = meta ? buffStatIcon(meta.stat) : undefined;
                    return (
                      <div
                        key={key}
                        className="flex items-center justify-between rounded bg-surface px-2 py-1"
                      >
                        <span className="flex items-center gap-1.5 text-xs text-text-secondary">
                          {icon && <GameIcon id={icon} title={meta?.name} size={18} />}
                          {meta?.name ?? key}
                        </span>
                        <span className="font-mono text-xs font-semibold text-text-primary">
                          {value}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Metadata */}
            <div className="space-y-1 text-[10px] text-text-muted">
              {selectedAttrs["Template"] && (
                <div>
                  Template: <span className="font-mono">{selectedAttrs["Template"]}</span>
                </div>
              )}
              {selectedAttrs["Serial"] && (
                <div>
                  Serial: <span className="font-mono">{selectedAttrs["Serial"]}</span>
                </div>
              )}
              {selectedAttrs["Origin"] && (
                <div>
                  Origin: <span className="font-mono">{selectedAttrs["Origin"]}</span>
                </div>
              )}
            </div>

            {(() => {
              const tidStr = selectedAttrs["Template"];
              if (!tidStr) return null;
              const tpl = templates.find((e) => String(e.account.templateId) === tidStr)?.account;
              if (!tpl) return null;
              const interactive =
                selected?.type === "locked"
                  ? {
                      heroMint: selectedHero.address,
                      slotIndex: (selected as { slot: number }).slot,
                    }
                  : undefined;
              return <AbilityCard template={tpl} interactive={interactive} />;
            })()}

            {/* Level Up */}
            {(() => {
              const heroTemplateId = parseInt(selectedAttrs["Template"] || "0");
              const currentLevel = selectedLevel ?? 0;
              const cost = fragmentCost(currentLevel);
              const canLevel =
                levelUpGate.allowed && fragments >= cost && currentLevel < levelCap && levelCap > 0;
              const atCap = currentLevel >= levelCap && levelCap > 0;

              return (
                <div className="rounded-md border border-zinc-800 bg-surface px-3 py-2">
                  <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                    Level Up
                  </div>
                  {!levelUpGate.allowed ? (
                    <div className="space-y-2">
                      {levelUpGate.missing.map((m) => (
                        <div key={m.label}>
                          <p className="text-[10px] leading-relaxed text-text-muted">
                            {m.narrative}
                          </p>
                          <Link
                            href={m.href}
                            className="mt-1 inline-flex items-center gap-1 rounded border border-border-gold/50 bg-accent/20 px-2 py-1 text-[10px] font-medium text-text-gold transition-colors hover:bg-accent/40"
                          >
                            {m.label}
                            <ChevronRight className="h-3 w-3" />
                          </Link>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-text-muted">Cost</span>
                        <span
                          className={`font-mono ${fragments >= cost ? "text-text-primary" : "text-red-400"}`}
                        >
                          {cost === Infinity ? "MAX" : cost.toLocaleString()} fragments
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-text-muted">Level cap</span>
                        <span className="font-mono text-text-secondary">
                          {levelCap > 0
                            ? `Lv${levelCap} (Sanctuary Lv${sanctuaryLevel})`
                            : "No Sanctuary"}
                        </span>
                      </div>
                      {atCap && (
                        <p className="mt-1 text-[10px] text-danger">
                          At cap. Upgrade Sanctuary for higher cap.
                        </p>
                      )}
                      <TxButton
                        onClick={(rp) => handleLevelUp(selectedHero.address, heroTemplateId, rp)}
                        disabled={!canLevel || traveling}
                        variant="secondary"
                        className="mt-2 w-full text-xs"
                      >
                        Level Up
                      </TxButton>
                    </>
                  )}
                </div>
              );
            })()}

            {/* Actions — pinned as a sticky footer; detail content scrolls behind it */}
            <div className="sticky bottom-0 z-10 -mx-4 -mb-4 border-t border-border-default bg-surface-raised px-4 pb-4 pt-3">
              {selected?.type === "locked" ? (
                <div className="space-y-2">
                  {player.defensiveHeroSlot !== (selected as { slot: number }).slot && (
                    <TxButton
                      onClick={(rp) =>
                        handleAssignDefensive((selected as { slot: number }).slot, rp)
                      }
                      variant="secondary"
                      className="w-full text-xs"
                    >
                      Assign as Defender
                    </TxButton>
                  )}
                  <TxButton
                    onClick={(rp) => handleUnlock((selected as { slot: number }).slot, rp)}
                    variant="secondary"
                    className="w-full text-xs"
                  >
                    Unlock from Slot
                  </TxButton>
                </div>
              ) : (
                <div className="space-y-2">
                  {lockGate.allowed ? (
                    <>
                      <div className="flex items-end gap-2">
                        <TxButton
                          onClick={(rp) => {
                            const templateId = parseInt(
                              selectedHero.asset.attributes["Template"] || "0",
                            );
                            return handleLock(selectedHero.address, lockSlot, templateId, rp);
                          }}
                          disabled={emptySlots === 0}
                          className="flex-1 text-xs"
                        >
                          Lock to Slot
                        </TxButton>
                      </div>
                      {emptySlots === 0 && (
                        <p className="text-[10px] text-danger">Unlock a slot first</p>
                      )}
                    </>
                  ) : (
                    <div className="space-y-2 rounded-md border border-border-gold/40 bg-surface px-3 py-2">
                      {lockGate.missing.map((m) => (
                        <div key={m.label}>
                          <p className="text-[10px] leading-relaxed text-text-muted">
                            {m.narrative}
                          </p>
                          <Link
                            href={m.href}
                            className="mt-1 inline-flex items-center gap-1 rounded border border-border-gold/50 bg-accent/20 px-2 py-1 text-[10px] font-medium text-text-gold transition-colors hover:bg-accent/40"
                          >
                            {m.label}
                            <ChevronRight className="h-3 w-3" />
                          </Link>
                        </div>
                      ))}
                    </div>
                  )}
                  <TxButton
                    onClick={(rp) => {
                      const tid = parseInt(selectedHero.asset.attributes["Template"] || "0");
                      return handleBurn(selectedHero.address, tid, rp);
                    }}
                    variant="danger"
                    className="w-full text-xs"
                  >
                    Burn Hero
                  </TxButton>
                </div>
              )}
            </div>
          </>
        )}

        {/* ── Template Detail (mint) ── */}
        {selectedTemplate &&
          (() => {
            const t = selectedTemplate;
            const buffs = getActiveBuffs(t.account);
            const playerLevel = player?.level ?? 0;
            const meetsLevel = playerLevel >= t.account.requiredPlayerLevel;
            const mintable = canMintHero(t.account) && !t.minted && meetsLevel;
            const supply =
              t.account.supplyCap > 0
                ? `${t.account.mintedCount} / ${t.account.supplyCap}`
                : `${t.account.mintedCount} minted`;
            const mintCostLamports =
              typeof t.account.mintCostSol === "number"
                ? t.account.mintCostSol
                : ((t.account.mintCostSol as any).toNumber?.() ?? 0);
            const tier = tierFromMintCost(mintCostLamports);
            const costSol = mintCostLamports / 1_000_000_000;

            return (
              <>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-base font-semibold text-text-primary">
                      {t.account.name}
                    </div>
                    <div className="text-[10px] text-text-muted">
                      Template #{t.account.templateId} · {HERO_TIER_NAMES[tier]}
                    </div>
                  </div>
                  {t.minted && (
                    <span className="shrink-0 rounded-full bg-green-900/30 px-2 py-0.5 text-[10px] font-medium text-green-400">
                      Minted
                    </span>
                  )}
                </div>

                {/* Template stats */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-text-muted">Mint cost</span>
                    <span className="font-mono text-text-primary">{costSol} SOL</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-text-muted">Type</span>
                    <span className="text-text-secondary">
                      {HERO_TYPE_NAMES[t.account.heroType] ?? "Unknown"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-text-muted">Category</span>
                    <span className="text-text-secondary">
                      {HERO_CATEGORY_NAMES[t.account.category] ?? "Unknown"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-text-muted">Supply</span>
                    <span className="font-mono text-text-secondary">{supply}</span>
                  </div>
                  {t.account.requiredPlayerLevel > 0 && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-text-muted">Required level</span>
                      <span
                        className={`font-mono ${meetsLevel ? "text-text-secondary" : "text-red-400"}`}
                      >
                        Lv{t.account.requiredPlayerLevel} {!meetsLevel && `(you: ${playerLevel})`}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-text-muted">Burn value (Lv1)</span>
                    <span className="font-mono text-text-secondary">
                      {(burnReward(1, tier) / 10).toLocaleString()} NOVI
                    </span>
                  </div>
                </div>

                {/* Buffs */}
                {buffs.length > 0 && (
                  <div>
                    <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                      Base Buffs
                    </div>
                    <div className="space-y-1">
                      {buffs.map((b) => {
                        const icon = buffStatIcon(b.stat);
                        return (
                          <div
                            key={b.stat}
                            className="flex items-center justify-between rounded bg-surface px-2 py-1"
                          >
                            <span className="flex items-center gap-1.5 text-xs text-text-secondary">
                              {icon && (
                                <GameIcon
                                  id={icon}
                                  title={getBuffStatMeta(b.stat)?.name}
                                  size={18}
                                />
                              )}
                              {getBuffStatMeta(b.stat)?.name ?? `Stat ${b.stat}`}
                            </span>
                            <span className="font-mono text-xs font-semibold text-text-primary">
                              +{(b.baseBps / 100).toFixed(1)}%
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Signature Ability (read-only on template detail) */}
                <AbilityCard template={t.account} />

                {/* Mint action */}
                <div className="border-t border-border-default pt-3">
                  <TxButton
                    onClick={(rp) => handleMint(t.account.templateId, rp)}
                    disabled={!mintable || traveling}
                    className="w-full"
                  >
                    {t.minted ? "Already Minted" : `Mint`}
                  </TxButton>
                  {!mintable && !t.minted && (
                    <p className="mt-1 text-center text-[10px] text-danger">
                      {!meetsLevel
                        ? `Requires player level ${t.account.requiredPlayerLevel} (you are ${playerLevel})`
                        : t.account.supplyCap > 0 && t.account.mintedCount >= t.account.supplyCap
                          ? "Supply exhausted"
                          : "Not available"}
                    </p>
                  )}
                </div>
              </>
            );
          })()}
      </DetailPanel>
    </div>
  );
}
