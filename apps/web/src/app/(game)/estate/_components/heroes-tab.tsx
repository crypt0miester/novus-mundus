"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useEstate } from "@/lib/hooks/useEstate";
import { useHeroBuffs } from "@/lib/hooks/useDerived";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { DetailPanel } from "@/components/shared/DetailPanel";
import { useMorphActions } from "@/lib/hooks/useMorphActions";
import type { PanelAction } from "@/lib/store/right-panel";
import { GameIcon, buffStatIcon } from "@/components/shared/GameIcon";
import { InfoButton } from "@/components/shared/InfoButton";
import { LabelWithInfo } from "@/components/shared/LabelWithInfo";
import { HERO_SLOTS_INFO, FRAGMENT_COST_INFO, FRAGMENT_CAP_INFO } from "@/lib/copy/infoCopy";
import { Keypair, type PublicKey } from "@solana/web3.js";
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
  canMintHero,
  HERO_CATEGORY_NAMES,
} from "novus-mundus-sdk";
import { useAccountStore } from "@/lib/store/accounts";
import { useGameEngine } from "@/lib/hooks/useGameEngine";
import { useFeatureGate, FEATURES, BuildingId } from "@/lib/hooks/useFeatureGate";
import { PendingEffectBadge } from "@/components/heroes/PendingEffectBadge";
import type { TxPhase } from "@/components/shared/TxButton";
import { fragmentCost, heroLevelCap, MPL_CORE_PROGRAM_ID } from "./heroes/helpers";
import type { HeroData, Selection, TemplateInfo } from "./heroes/types";
import { HeroSlotCard } from "./heroes/HeroSlotCard";
import { UnlockedHeroCard } from "./heroes/UnlockedHeroCard";
import { TemplateCard } from "./heroes/TemplateCard";
import { HeroDetailPanel } from "./heroes/HeroDetailPanel";
import { TemplateDetailPanel } from "./heroes/TemplateDetailPanel";

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

  const heroTemplatesMap = useAccountStore((s) => s.heroTemplates);

  const [lockedHeroes, setLockedHeroes] = useState<(HeroData | null)[]>([null, null, null]);
  const [unlockedHeroes, setUnlockedHeroes] = useState<HeroData[]>([]);
  const [mintReceipts, setMintReceipts] = useState<Map<number, boolean>>(new Map());
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Selection>(null);
  // Lock instruction targets a specific active-hero slot; chain rejects when
  // that slot is already occupied. The Lock UI disables when ALL three slots
  // are full, but if (e.g.) the player has heroes in slots 0 and 2 with slot
  // 1 free, hard-coding slot 0 would still send a tx the chain refuses.
  // Pick the first empty slot.
  const lockSlot = useMemo(() => {
    if (!player) return 0;
    const slots = player.activeHeroes as PublicKey[];
    for (let i = 0; i < slots.length; i++) {
      if (isNullPubkey(slots[i])) return i;
    }
    return 0;
  }, [player]);

  const traveling = player ? isTraveling(player) : false;
  const fragments = Number(player?.fragments ?? 0n);
  const emptySlots = player ? player.activeHeroes.filter((h: any) => isNullPubkey(h)).length : 0;
  const filledSlots = 3 - emptySlots;

  const sanctuaryLevel = useMemo(() => {
    const buildings = estateData?.account?.buildings;
    if (!buildings) return 0;
    const sanctuary = buildings.find(
      (b: any) => b.buildingType === BuildingId.Sanctuary && (b.status === 2 || b.status === 3),
    );
    return sanctuary?.level ?? 0;
  }, [estateData]);

  const levelCap = heroLevelCap(sanctuaryLevel);

  // Mirrors `max_locked_heroes_for_sanctuary_level` in
  // programs/novus_mundus/src/helpers/estate.rs:264 — chain rejects
  // `lock_hero` once `current_locked_count` hits this cap. Storage
  // is `[Address; 3]`, so the 4 / 5 in the chain helper are unreachable
  // and the UI cap is `min(table, 3)`.
  const maxLockedHeroes = useMemo(() => {
    if (sanctuaryLevel === 0) return 0;
    if (sanctuaryLevel <= 4) return 1;
    if (sanctuaryLevel <= 9) return 2;
    return 3;
  }, [sanctuaryLevel]);
  // Next sanctuary level that unlocks an additional slot. Null when all
  // three storage slots are already unlocked.
  const nextSlotUnlockLevel = useMemo(() => {
    if (maxLockedHeroes >= 3) return null;
    if (maxLockedHeroes === 0) return 1;
    if (maxLockedHeroes === 1) return 5;
    return 10; // 2 → 3 at Sanctuary 10
  }, [maxLockedHeroes]);

  const templates: TemplateInfo[] = useMemo(() => {
    return Array.from(heroTemplatesMap.values())
      .filter((e) => e.account.enabled)
      .sort((a, b) => a.account.templateId - b.account.templateId)
      .map((e) => ({
        account: e.account,
        minted: mintReceipts.get(e.account.templateId) ?? false,
      }));
  }, [heroTemplatesMap, mintReceipts]);

  // Group templates by hero category (Historical / Mythological / Crypto Icons
  // / Gaming / Original) so the roster reads as themed collections rather than
  // one long id-sorted list. Ordered by category number; templates inside each
  // stay id-sorted from the memo above.
  const templatesByCategory = useMemo(() => {
    const byCat = new Map<number, TemplateInfo[]>();
    for (const t of templates) {
      const list = byCat.get(t.account.category) ?? [];
      list.push(t);
      byCat.set(t.account.category, list);
    }
    return [...byCat.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([category, items]) => ({
        category,
        name: HERO_CATEGORY_NAMES[category] ?? `Category ${category}`,
        items,
      }));
  }, [templates]);

  // Active category tab; null falls back to the first available category so the
  // roster shows one collection at a time instead of one long list.
  const [activeCategory, setActiveCategory] = useState<number | null>(null);
  const currentCategory =
    templatesByCategory.find((g) => g.category === activeCategory) ?? templatesByCategory[0] ?? null;

  // Fetch mint receipts (0-byte marker PDAs, not WS-tracked)
  useEffect(() => {
    if (!connection || !publicKey || heroTemplatesMap.size === 0) return;
    const ge = client.gameEngine;
    let cancelled = false;
    (async () => {
      const [playerPda] = await derivePlayerPda(ge, publicKey);
      const entries = Array.from(heroTemplatesMap.values()).filter((e) => e.account.enabled);
      const receiptPdas = await Promise.all(
        entries.map(async (e) => (await deriveHeroMintReceiptPda(playerPda, e.account.templateId))[0]),
      );
      const infos = await connection.getMultipleAccountsInfo(receiptPdas);
      if (cancelled) return;
      const map = new Map<number, boolean>();
      entries.forEach((e, i) => {
        map.set(e.account.templateId, infos[i] !== null && infos[i]!.lamports > 0);
      });
      setMintReceipts(map);
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [connection, publicKey, heroTemplatesMap, client, refreshKey]);

  // Fetch heroes: locked (player PDA's activeHeroes) + unlocked (wallet via getProgramAccounts)
  useEffect(() => {
    if (!player || !connection || !publicKey) return;
    setLoading(true);

    // Wallet / kingdom switch can fire a new effect run while the previous
    // fetch is still in flight; without this guard the older Promise.all
    // resolves later and overwrites the new wallet's heroes (selected as
    // well). The cleanup flips the flag so the late resolver no-ops.
    let cancelled = false;

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
              if (!asset.attributes.Template) return null;
              return { address: pubkey, asset } as HeroData;
            } catch {
              return null;
            }
          })
          .filter((h): h is HeroData => h !== null),
      )
      .catch(() => [] as HeroData[]);

    Promise.all([fetchLocked, fetchUnlocked]).then(([locked, unlocked]) => {
      if (cancelled) return;
      setLockedHeroes(locked);
      setUnlockedHeroes(unlocked);
      setLoading(false);

      // Keep the detail-panel selection pointed at the freshly-fetched NFT
      // data. Level-up / lock / unlock mutate NFT attributes, so the
      // previously selected HeroData object is stale after a refetch.
      setSelected((prev) => {
        if (!prev) {
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

    return () => {
      cancelled = true;
    };
  }, [player, connection, publicKey, refreshKey]);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  const handleMint = async (templateId: number, reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !gameEngine) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const heroMintKeypair = await Keypair.generate();
    const ix = await createMintHeroInstruction(
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
    const [playerPda] = await derivePlayerPda(ge, publicKey);
    const [heroTemplate] = await deriveHeroTemplatePda(templateId);
    const [estateAccount] = await deriveEstatePda(playerPda);
    const ix = await createLockHeroInstruction(
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
    const [playerPda] = await derivePlayerPda(ge, publicKey);
    const heroData = lockedHeroes[slotIndex];
    const templateId = heroData?.asset?.attributes.Template
      ? parseInt(heroData.asset.attributes.Template, 10)
      : 0;
    const [heroTemplate] = await deriveHeroTemplatePda(templateId);
    const [estateAccount] = await deriveEstatePda(playerPda);
    const ix = await createUnlockHeroInstruction(
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
    const ix = await createAssignDefensiveHeroInstruction(
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
    const [playerPda] = await derivePlayerPda(ge, publicKey);
    const [heroTemplate] = await deriveHeroTemplatePda(templateId);
    const [estateAccount] = await deriveEstatePda(playerPda);
    const ix = await createLevelUpHeroInstruction({
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
    const ix = await createBurnHeroInstruction(
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

  // Morph bar carries actions on mobile (panel buttons are desktop-only).
  const morphActions: PanelAction[] | null = (() => {
    if (!player || !selected) return null;

    if (selected.type === "template") {
      const t = selected.info;
      const mintable =
        canMintHero(t.account) && !t.minted && (player.level ?? 0) >= t.account.requiredPlayerLevel;
      return [
        {
          id: "mint",
          label: t.minted ? "Minted" : "Mint",
          variant: "primary",
          disabled: !mintable || traveling,
          onClick: (rp) => handleMint(t.account.templateId, rp),
        },
      ];
    }

    const hero = selected.hero;
    const attrs = hero.asset.attributes;
    const templateId = parseInt(attrs.Template || "0", 10);
    const level = attrs.Level ? parseInt(attrs.Level, 10) : 0;
    const canLevel =
      levelUpGate.allowed && fragments >= fragmentCost(level) && level < levelCap && levelCap > 0;

    const list: PanelAction[] = [];
    if (levelUpGate.allowed) {
      list.push({
        id: "level-up",
        label: "Level Up",
        variant: "primary",
        disabled: !canLevel || traveling,
        onClick: (rp) => handleLevelUp(hero.address, templateId, rp),
      });
    }
    if (selected.type === "locked") {
      if (player.defensiveHeroSlot !== selected.slot) {
        list.push({
          id: "assign-defender",
          label: "Defend",
          onClick: (rp) => handleAssignDefensive(selected.slot, rp),
        });
      }
      list.push({
        id: "unlock",
        label: "Unlock",
        onClick: (rp) => handleUnlock(selected.slot, rp),
      });
    } else {
      if (lockGate.allowed) {
        list.push({
          id: "lock",
          label: "Lock",
          disabled: emptySlots === 0,
          onClick: (rp) => handleLock(hero.address, lockSlot, templateId, rp),
        });
      }
      list.push({
        id: "burn",
        label: "Burn",
        variant: "danger",
        onClick: (rp) => handleBurn(hero.address, templateId, rp),
      });
    }
    return list.length > 0 ? list : null;
  })();
  useMorphActions(morphActions);

  if (!player) return null;

  const selectedHero =
    selected?.type === "locked" || selected?.type === "unlocked" ? selected.hero : null;
  const selectedTemplate = selected?.type === "template" ? selected.info : null;

  const isHeroSelected = (addr: PublicKey) => selectedHero?.address.toBase58() === addr.toBase58();
  const isTemplateSelected = (id: number) => selectedTemplate?.account.templateId === id;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:grid-rows-1 lg:h-full">
      {/* Left: lists — scrolls independently of the detail column */}
      <div className="space-y-4 lg:col-span-2 lg:min-h-0 lg:overflow-y-auto px-1">
        <div className="flex items-center gap-4 text-xs text-text-muted">
          <LabelWithInfo info={HERO_SLOTS_INFO}>
            {filledSlots}/{maxLockedHeroes} slots
            {maxLockedHeroes < 3 && (
              <span className="text-text-muted/70"> · {3 - maxLockedHeroes} locked</span>
            )}
          </LabelWithInfo>
          <LabelWithInfo info={FRAGMENT_COST_INFO}>
            Fragments: {fragments.toLocaleString()}
          </LabelWithInfo>
          {levelCap > 0 && <LabelWithInfo info={FRAGMENT_CAP_INFO}>Cap: Lv{levelCap}</LabelWithInfo>}
          {traveling && <span className="text-danger">Traveling</span>}
          {loading && <span>Loading heroes...</span>}
        </div>

        <div>
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
              Active Slots{" "}
              <InfoButton>Slots holding a locked hero whose buffs are live. A meditating hero earns XP but gives no buffs.</InfoButton>
            </h3>
            <span className="font-mono text-[10px] tabular-nums text-text-muted">
              {filledSlots}/{maxLockedHeroes} filled · {maxLockedHeroes}/3 unlocked
            </span>
          </div>

          {/* Lock gate banner — surface why slots can't be filled before the
              player taps an empty card and gets a silent no-op. */}
          {!lockGate.allowed && lockGate.missing.length > 0 && (
            <div className="mb-2 space-y-1.5 rounded-lg border border-border-gold/40 bg-accent/10 px-3 py-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                Hero locking is gated
              </div>
              {lockGate.missing.map((m) => (
                <div key={m.label}>
                  <p className="text-[11px] leading-relaxed text-text-muted">{m.narrative}</p>
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

          <div className="grid gap-2 grid-cols-3">
            {[0, 1, 2].map((i) => {
              const hero = lockedHeroes[i];
              const isEmpty = isNullPubkey(player.activeHeroes[i]);
              // Slot index is beyond what the Sanctuary level allows. The
              // chain enforces this via `max_locked_heroes_for_sanctuary_level`
              // — surface it in the per-slot hint so a player tapping the
              // third card at Sanctuary 5 understands why the lock won't go
              // through, on top of the unlock-hint banner above.
              const isSanctuaryLocked = i >= maxLockedHeroes;
              const emptyHint = !lockGate.allowed
                ? "Locking gated"
                : isSanctuaryLocked
                  ? `Sanctuary lv ${nextSlotUnlockLevel ?? "?"} unlocks`
                  : unlockedHeroes.length > 0
                    ? "Lock a hero below"
                    : "Mint a hero first";
              return (
                <HeroSlotCard
                  key={i}
                  index={i}
                  hero={hero}
                  isEmpty={isEmpty}
                  isDefensive={player.defensiveHeroSlot === i}
                  isMeditating={player.meditatingHeroSlot === i}
                  isSelected={!!hero && isHeroSelected(hero.address)}
                  onClick={() => hero && setSelected({ type: "locked", slot: i, hero })}
                  emptyHint={emptyHint}
                />
              );
            })}
          </div>
        </div>

        <PendingEffectBadge variant="block" />

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

          {lockGate.allowed && nextSlotUnlockLevel !== null && (
            <div className="mb-2 rounded-lg border border-border-gold/40 bg-accent/10 px-3 py-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                {maxLockedHeroes === 0 ? "Hero slots locked" : "Unlock the next slot"}
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-text-muted">
                {maxLockedHeroes === 0
                  ? "Build a Sanctuary on your estate to unlock your first hero slot."
                  : `Upgrade to Sanctuary level ${nextSlotUnlockLevel} to unlock slot ${maxLockedHeroes + 1}.`}
              </p>
            </div>
          )}
        {unlockedHeroes.length > 0 && (
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
              Available ({unlockedHeroes.length}){" "}
              <InfoButton>Heroes held in your wallet that are not locked into a slot yet.</InfoButton>
            </h3>
            <div className="grid gap-2 grid-cols-3">
              {unlockedHeroes.map((hero) => (
                <UnlockedHeroCard
                  key={hero.address.toBase58()}
                  hero={hero}
                  isSelected={isHeroSelected(hero.address)}
                  onClick={() => setSelected({ type: "unlocked", hero })}
                />
              ))}
            </div>
          </div>
        )}

        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
            Templates
          </h3>
          {templates.length === 0 ? (
            <div className="card py-6 text-center text-xs text-text-muted">
              No hero templates found
            </div>
          ) : (
            <>
              {/* Category tabs — one collection at a time (Historical /
                  Mythological / Crypto Icons / Gaming / Original). */}
              <div className="mb-2 flex flex-wrap gap-1 rounded-lg bg-surface-overlay/40 p-1">
                {templatesByCategory.map((group) => {
                  const active = group.category === currentCategory?.category;
                  return (
                    <button
                      key={group.category}
                      onClick={() => setActiveCategory(group.category)}
                      className={`flex-1 whitespace-nowrap rounded-md px-2 py-1.5 text-[11px] font-semibold transition-colors ${
                        active
                          ? "bg-surface-raised text-text-primary"
                          : "text-text-muted hover:text-text-secondary"
                      }`}
                    >
                      {group.name}
                      <span className="ml-1 font-normal text-text-muted">{group.items.length}</span>
                    </button>
                  );
                })}
              </div>
              {currentCategory && (
                <div className="grid gap-2 grid-cols-2 sm:grid-cols-3">
                  {currentCategory.items.map((t) => (
                    <TemplateCard
                      key={t.account.templateId}
                      template={t}
                      isSelected={isTemplateSelected(t.account.templateId)}
                      onClick={() => setSelected({ type: "template", info: t })}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Right: Detail Panel — fixed-height column, scrolls independently */}
      <DetailPanel open={!!selected} onClose={() => setSelected(null)} variant="column">
        {selectedHero && (
          <HeroDetailPanel
            selected={selected}
            hero={selectedHero}
            templates={templates}
            fragments={fragments}
            levelCap={levelCap}
            sanctuaryLevel={sanctuaryLevel}
            emptySlots={emptySlots}
            defensiveHeroSlot={player.defensiveHeroSlot}
            traveling={traveling}
            lockGate={lockGate}
            levelUpGate={levelUpGate}
            lockSlot={lockSlot}
            onLevelUp={handleLevelUp}
            onAssignDefensive={handleAssignDefensive}
            onUnlock={handleUnlock}
            onLock={handleLock}
            onBurn={handleBurn}
          />
        )}

        {selectedTemplate && (
          <TemplateDetailPanel
            template={selectedTemplate}
            playerLevel={player?.level ?? 0}
            traveling={traveling}
            onMint={handleMint}
          />
        )}
      </DetailPanel>
    </div>
  );
}
