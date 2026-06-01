"use client";

import { useState, useMemo, useEffect } from "react";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useWallet } from "@solana/wallet-adapter-react";
import { useConnection } from "@solana/wallet-adapter-react";
import { useQuery } from "@tanstack/react-query";
import { GoldNumber } from "@/components/shared/GoldNumber";
import { GameIcon } from "@/components/shared/GameIcon";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import {
  deriveCraftedEquipmentPda,
  createStartCraftInstruction,
  createStrikeInstruction,
  createAbandonCraftInstruction,
  createEquipInstruction,
  createInitializeForgeInstruction,
  deserializeCraftedEquipment,
  isCrafting,
  ownedCountsForSlot,
  equippedTierForSlot,
  isTraveling,
  type CraftedEquipmentAccount,
} from "novus-mundus-sdk";
import { FeatureLayout } from "./feature-layout";
import { ShowcaseBanner } from "./showcase-banner";

// One taxonomy for both flows: these ARE the on-chain EquipmentSlot ids
// (0 melee, 1 ranged, 2 siege, 3 armor). The old "Sword/Bow/Shield/Helm"
// labels disagreed with the chain (id 2 is a siege weapon, not a shield).
const EQUIPMENT = [
  { id: 0, name: "Melee Weapon", short: "Melee", desc: "Close-combat weapon", icon: "equip-melee" as const },
  { id: 1, name: "Ranged Weapon", short: "Ranged", desc: "Ranged weapon", icon: "equip-ranged" as const },
  { id: 2, name: "Siege Weapon", short: "Siege", desc: "Siege engine", icon: "equip-siege" as const },
  { id: 3, name: "Armor", short: "Armor", desc: "Defensive armor", icon: "equip-armor" as const },
];

// Quality tiers mirror the on-chain QualityTier (0 = none, 1..7 craftable).
const QUALITY_TIERS = [
  { id: 0, name: "None", noviCost: 0, materials: { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0 }, stages: 0, craftTime: "N/A", successRate: 100, forgeReq: 0, window: "N/A" },
  { id: 1, name: "Refined", noviCost: 1_000, materials: { common: 50, uncommon: 0, rare: 0, epic: 0, legendary: 0 }, stages: 1, craftTime: "4h", successRate: 100, forgeReq: 1, window: "1h" },
  { id: 2, name: "Superior", noviCost: 2_618, materials: { common: 100, uncommon: 25, rare: 0, epic: 0, legendary: 0 }, stages: 2, craftTime: "8h", successRate: 95, forgeReq: 5, window: "30m" },
  { id: 3, name: "Elite", noviCost: 6_854, materials: { common: 0, uncommon: 100, rare: 25, epic: 0, legendary: 0 }, stages: 3, craftTime: "16h", successRate: 85, forgeReq: 8, window: "15m" },
  { id: 4, name: "Masterwork", noviCost: 17_944, materials: { common: 0, uncommon: 0, rare: 100, epic: 25, legendary: 0 }, stages: 5, craftTime: "24h", successRate: 70, forgeReq: 12, window: "5m" },
  { id: 5, name: "Legendary", noviCost: 46_979, materials: { common: 0, uncommon: 0, rare: 0, epic: 100, legendary: 25 }, stages: 8, craftTime: "48h", successRate: 50, forgeReq: 16, window: "2m" },
  { id: 6, name: "Mythic", noviCost: 122_991, materials: { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 200 }, stages: 11, craftTime: "72h", successRate: 30, forgeReq: 18, window: "1.5m" },
  { id: 7, name: "Divine", noviCost: 322_069, materials: { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 400 }, stages: 13, craftTime: "7d", successRate: 15, forgeReq: 20, window: "1m" },
];

const CRAFTABLE_TIERS = QUALITY_TIERS.filter((q) => q.id > 0);

function tierName(tier: number): string {
  return QUALITY_TIERS[tier]?.name ?? `T${tier}`;
}

function mmss(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

// The tier ladder doubles as the forge "heat" palette: cold steel to bright gold
// at the sweet spot, crimson for a missed window. Pinned to the hero tier colors
// (src/lib/hero-image/palette.ts) so the forge reads as part of the same family.
const FORGE = {
  silver: "#b9c0c9",
  bronze: "#cd7f32",
  gold: "#daa520",
  goldBright: "#f1af09",
  crimson: "#9a2222",
  dim: "#3a3a3e",
} as const;

type Mode = "forge" | "equip";

export function ForgeTab() {
  const { data: playerData } = usePlayer();
  const player = playerData?.account;
  const client = useNovusMundusClient();
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const transact = useTransact();

  const [mode, setMode] = useState<Mode>("forge");
  const [selectedSlot, setSelectedSlot] = useState(0);
  const [selectedQuality, setSelectedQuality] = useState(1); // Refined
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));

  // Forge state: parse the CraftedEquipment account so the UI can be stateful
  // (idle → Start; active craft → Strike/Abandon with a live window).
  const { data: craft } = useQuery({
    queryKey: ["craft", publicKey?.toBase58()],
    queryFn: async (): Promise<CraftedEquipmentAccount | null> => {
      if (!publicKey) return null;
      // The forge account is a PDA of the owner WALLET (the forge instructions
      // derive it as deriveCraftedEquipmentPda(owner)), not the PlayerAccount
      // PDA. Deriving from playerPda read a non-existent account, so the view
      // never saw the active craft and stayed stuck on "Start Forging".
      const [craftPda] = await deriveCraftedEquipmentPda(publicKey);
      const info = await connection.getAccountInfo(craftPda);
      if (!info) return null;
      return deserializeCraftedEquipment(info.data);
    },
    enabled: !!publicKey,
    staleTime: 3_000,
    // Poll steadily while the forge tab is open so the view reflects chain state
    // after a craft starts, a stage advances, or it completes. A craft-gated
    // interval would never start polling from idle, so a post-tx invalidation
    // that raced ahead of confirmation would leave the view stuck on "Start".
    refetchInterval: 4_000,
  });

  const crafting = !!craft && isCrafting(craft);

  // Tick once a second while crafting, for the window countdown.
  useEffect(() => {
    if (!crafting) return;
    const t = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1_000);
    return () => clearInterval(t);
  }, [crafting]);

  const travelWarning = useMemo(
    () => (player && isTraveling(player) ? "Cannot craft while traveling" : null),
    [player],
  );

  const qualityInfo = QUALITY_TIERS[selectedQuality] ?? QUALITY_TIERS[1]!;
  const slotInfo = EQUIPMENT[selectedSlot]!;

  // Material requirement check for the selected tier.
  const materialCheck = useMemo(() => {
    if (!player) return [];
    const mats = qualityInfo.materials;
    const rows: { name: string; need: number; have: number; ok: boolean }[] = [];
    const add = (name: string, need: number, have: number) => {
      if (need > 0) rows.push({ name, need, have, ok: have >= need });
    };
    add("Common", mats.common, Number(player.commonMaterials ?? 0n));
    add("Uncommon", mats.uncommon, Number(player.uncommonMaterials ?? 0n));
    add("Rare", mats.rare, Number(player.rareMaterials ?? 0n));
    add("Epic", mats.epic, Number(player.epicMaterials ?? 0n));
    add("Legendary", mats.legendary, Number(player.legendaryMaterials ?? 0n));
    return rows;
  }, [player, qualityInfo]);

  // Live strike state for the active craft: where "now" sits in the current
  // stage's window, the precision (best dead-center), and whether it's strikable.
  const strike = useMemo(() => {
    if (!craft || !crafting) return null;
    const open = Number(craft.windowOpensAt);
    const close = Number(craft.windowClosesAt);
    const span = Math.max(1, close - open);
    if (nowSec < open) {
      return {
        phase: "heating" as const,
        frac: 0,
        precision: 0,
        precisionLabel: "Heating",
        detail: `opens in ${mmss(open - nowSec)}`,
        canStrike: false,
      };
    }
    if (nowSec <= close) {
      const frac = (nowSec - open) / span;
      const precision = Math.round(100 * (1 - Math.abs(frac - 0.5) * 2));
      const precisionLabel =
        precision >= 90 ? "Perfect" : precision >= 70 ? "Good" : precision >= 40 ? "Fair" : "Glancing";
      return {
        phase: "live" as const,
        frac,
        precision,
        precisionLabel,
        detail: `${precision}% · ${mmss(close - nowSec)} left`,
        canStrike: true,
      };
    }
    return {
      phase: "missed" as const,
      frac: 1,
      precision: 0,
      precisionLabel: "Missed",
      detail: "craft will fail",
      canStrike: false,
    };
  }, [craft, crafting, nowSec]);

  // Preflight gating for Start: mirror the on-chain checks we can see so the
  // button disables with a reason rather than letting the player hit a GameError.
  const insufficientMaterials = materialCheck.some((m) => !m.ok);
  const insufficientNovi = !!player && Number(player.lockedNovi) < qualityInfo.noviCost;
  const startReason = travelWarning
    ? travelWarning
    : insufficientMaterials
      ? "Not enough materials for this tier"
      : insufficientNovi
        ? "Not enough NOVI for this tier"
        : null;

  // Handlers (instructions unchanged from before).
  const handleStartCraft = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const ixs = [];
    // The forge account must exist before start_craft; init it on first craft.
    if (!craft) {
      ixs.push(await createInitializeForgeInstruction({ owner: publicKey, gameEngine: ge }));
    }
    ixs.push(
      await createStartCraftInstruction(
        { owner: publicKey, gameEngine: ge },
        { equipmentType: selectedSlot, qualityTier: selectedQuality },
      ),
    );
    return transact
      .mutateAsync({
        instructions: ixs,
        invalidateKeys: [["craft"], ["player"]],
        successMessage: `Forging a ${qualityInfo.name} ${slotInfo.name}…`,
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  const handleStrike = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ix = await createStrikeInstruction({ owner: publicKey, gameEngine: client.gameEngine });
    // The final stage completes the craft; surface the forged item as the payoff.
    const isFinalStage = !!craft && craft.currentStage >= craft.stagesRequired;
    const successMessage =
      isFinalStage && craft
        ? `Forged a ${tierName(craft.targetTier)} ${EQUIPMENT[craft.activeCraftEquipment]?.short ?? "item"}!`
        : "Tempered!";
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["craft"], ["player"]],
        successMessage,
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  const handleAbandonCraft = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ix = await createAbandonCraftInstruction({ owner: publicKey, gameEngine: client.gameEngine });
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["craft"], ["player"]],
        successMessage: "Craft abandoned.",
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  const handleEquip = async (slot: number, tier: number, reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ix = await createEquipInstruction(
      { owner: publicKey, gameEngine: client.gameEngine },
      { equipmentType: slot, qualityTier: tier },
    );
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["craft"], ["player"]],
        successMessage: tier === 0 ? "Unequipped." : `Equipped ${tierName(tier)} ${EQUIPMENT[slot]?.short}.`,
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  // ---- Mode switch ----
  const ModeTabs = (
    <div className="mb-4 flex gap-1 rounded-lg border border-zinc-800 bg-surface p-1">
      {(["forge", "equip"] as Mode[]).map((m) => (
        <button
          key={m}
          onClick={() => setMode(m)}
          className={`flex-1 rounded-md px-4 py-2 text-sm font-semibold capitalize transition-colors ${
            mode === m
              ? "bg-accent/30 text-text-primary"
              : "text-text-muted hover:text-text-secondary"
          }`}
        >
          {m}
        </button>
      ))}
    </div>
  );

  return (
    <FeatureLayout
      main={
        <>
          {ModeTabs}

          {mode === "forge" ? (
            <>
              <ShowcaseBanner
                image="/img/banners/forge-banner.webp"
                icon={slotInfo.icon}
                title={slotInfo.name}
                tag={`${qualityInfo.name} tier`}
              >
                <p className="text-xs italic text-zinc-300">
                  {slotInfo.desc}, forged and tempered at the {qualityInfo.name} tier.
                </p>
                <p className="text-xs text-zinc-400">
                  <span className="font-mono tabular-nums text-text-gold">
                    {qualityInfo.noviCost.toLocaleString()}
                  </span>{" "}
                  NOVI{" · "}
                  {qualityInfo.craftTime}
                  {" · "}
                  {qualityInfo.successRate}% success
                </p>
              </ShowcaseBanner>

              {travelWarning && (
                <div className="rounded-lg border border-border-gold/50 bg-accent/20 p-3 text-sm text-danger">
                  {travelWarning}
                </div>
              )}

              {/* Materials on hand */}
              {player && (
                <div className="card accent-border">
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
                    Materials
                  </h3>
                  <div className="grid grid-cols-3 gap-4 md:grid-cols-6">
                    <div>
                      <div className="text-xs text-text-muted">Fragments</div>
                      <span className="inline-flex items-center gap-1">
                        <GameIcon id="resource-fragments" size={14} />
                        <GoldNumber value={Number(player.fragments ?? 0n)} />
                      </span>
                    </div>
                    <div>
                      <div className="text-xs text-text-muted">Common</div>
                      <GoldNumber value={Number(player.commonMaterials ?? 0n)} glow={false} />
                    </div>
                    <div>
                      <div className="text-xs text-text-muted">Uncommon</div>
                      <GoldNumber value={Number(player.uncommonMaterials ?? 0n)} glow={false} />
                    </div>
                    <div>
                      <div className="text-xs text-text-muted">Rare</div>
                      <GoldNumber value={Number(player.rareMaterials ?? 0n)} glow={false} />
                    </div>
                    <div>
                      <div className="text-xs text-text-muted">Epic</div>
                      <GoldNumber value={Number(player.epicMaterials ?? 0n)} glow={false} />
                    </div>
                    <div>
                      <div className="text-xs text-text-muted">Legendary</div>
                      <GoldNumber value={Number(player.legendaryMaterials ?? 0n)} glow={false} />
                    </div>
                  </div>
                </div>
              )}

              {/* Pick the slot */}
              <div>
                <h2 className="mb-3 text-lg font-semibold text-text-primary">Choose Equipment</h2>
                <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
                  {EQUIPMENT.map((e) => (
                    <button
                      key={e.id}
                      onClick={() => setSelectedSlot(e.id)}
                      className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-all ${
                        selectedSlot === e.id
                          ? "border-border-gold bg-accent/20"
                          : "border-zinc-800 hover:border-zinc-700"
                      }`}
                    >
                      <GameIcon id={e.icon} size={28} />
                      <div>
                        <div className="text-sm font-semibold text-text-primary">{e.name}</div>
                        <div className="text-xs text-text-muted">{e.desc}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Pick the quality */}
              <div>
                <h2 className="mb-3 text-lg font-semibold text-text-primary">Quality Tier</h2>
                <div className="grid gap-2 grid-cols-2 md:grid-cols-4">
                  {CRAFTABLE_TIERS.map((q) => (
                    <button
                      key={q.id}
                      onClick={() => setSelectedQuality(q.id)}
                      className={`rounded-lg border p-3 text-left transition-all ${
                        selectedQuality === q.id
                          ? "border-border-gold bg-accent/20"
                          : "border-zinc-800 hover:border-zinc-700"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-semibold text-text-primary">{q.name}</div>
                      </div>
                      <div className="text-[11px] text-text-muted">
                        {q.stages} stages
                      </div>
                      <div className="text-[11px] text-text-muted">
                        Forge Lv {q.forgeReq}+ | {q.craftTime}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : (
            // ---- EQUIP MODE ----
            <>
              <div>
                <h2 className="mb-1 text-lg font-semibold text-text-primary">Loadout</h2>
                <p className="mb-4 text-xs text-text-muted">
                  Set one crafted item active per slot for combat. Click an owned tier to equip it.
                </p>

                <div className="flex flex-col gap-3">
                  {EQUIPMENT.map((e) => {
                    const counts = craft ? ownedCountsForSlot(craft, e.id) : [];
                    const equipped = craft ? equippedTierForSlot(craft, e.id) : 0;
                    const ownedTiers = CRAFTABLE_TIERS.filter((q) => (counts[q.id] ?? 0) > 0);
                    return (
                      <div key={e.id} className="card">
                        <div className="mb-3 flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <GameIcon id={e.icon} size={28} />
                            <div>
                              <div className="text-sm font-semibold text-text-primary">{e.name}</div>
                              <div className="text-[11px] text-text-muted">
                                {equipped > 0 ? (
                                  <>
                                    equipped: <span className="text-text-gold">{tierName(equipped)}</span>
                                  </>
                                ) : (
                                  "nothing equipped"
                                )}
                              </div>
                            </div>
                          </div>
                          {equipped > 0 && (
                            <TxButton onClick={(rp) => handleEquip(e.id, 0, rp)} variant="secondary">
                              Unequip
                            </TxButton>
                          )}
                        </div>

                        {ownedTiers.length > 0 ? (
                          <div className="flex flex-wrap gap-2">
                            {ownedTiers.map((q) => (
                              <TxButton
                                key={q.id}
                                onClick={(rp) => handleEquip(e.id, q.id, rp)}
                                variant={equipped === q.id ? "primary" : "secondary"}
                              >
                                {q.name} ×{counts[q.id]}
                              </TxButton>
                            ))}
                          </div>
                        ) : (
                          <div className="text-[11px] text-text-muted">
                            None crafted yet.
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </>
      }
      aside={
        mode === "forge" ? (
          crafting && craft ? (
            // ---- Active craft panel ----
            <div className="card accent-border">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
                Active Craft
              </h3>
              <div className="mb-3 flex items-center gap-3">
                <GameIcon id={EQUIPMENT[craft.activeCraftEquipment]?.icon ?? "equip-melee"} size={32} />
                <div>
                  <div className="text-sm font-semibold text-text-primary">
                    {tierName(craft.targetTier)} {EQUIPMENT[craft.activeCraftEquipment]?.name ?? "Equipment"}
                  </div>
                  <div className="text-[11px] text-text-muted">
                    stage {Math.min(craft.currentStage, craft.stagesRequired)} / {craft.stagesRequired}
                    {" · "}
                    {craft.stagesCompleted} tempered
                  </div>
                </div>
              </div>

              {/* Stage pips — one per tempering stage; fill as each is struck. */}
              <div className="mb-3 flex gap-1">
                {Array.from({ length: Math.max(craft.stagesRequired, 1) }).map((_, i) => (
                  <div
                    key={i}
                    className="h-1.5 flex-1 rounded-full transition-colors"
                    style={{
                      background:
                        i < craft.stagesCompleted
                          ? FORGE.gold
                          : i === craft.stagesCompleted
                            ? FORGE.bronze
                            : FORGE.dim,
                    }}
                  />
                ))}
              </div>

              {/* Strike gauge — a heat bar spanning this stage's window. Strike
                  at the bright (gold) center for best precision; cools to steel
                  at the edges. The white marker is "now"; the bar dims while the
                  metal heats and goes cold (crimson note) once the window closes. */}
              {strike && (
                <div className="mb-3">
                  <div
                    className="relative h-3 w-full overflow-hidden rounded-full border border-zinc-800"
                    style={{
                      background:
                        strike.phase === "missed"
                          ? FORGE.dim
                          : `linear-gradient(90deg, ${FORGE.silver}, ${FORGE.bronze}, ${FORGE.gold}, ${FORGE.goldBright}, ${FORGE.gold}, ${FORGE.bronze}, ${FORGE.silver})`,
                      opacity: strike.phase === "heating" ? 0.45 : 1,
                    }}
                  >
                    {/* sweet-spot center tick */}
                    <div
                      className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2"
                      style={{ background: "rgba(255,255,255,0.35)" }}
                    />
                    {/* "now" marker */}
                    {strike.phase !== "heating" && (
                      <div
                        className="absolute inset-y-[-2px] w-[3px] -translate-x-1/2 rounded-full"
                        style={{
                          left: `${strike.frac * 100}%`,
                          background: "#fff",
                          boxShadow: "0 0 6px rgba(255,255,255,0.85)",
                        }}
                      />
                    )}
                  </div>
                  <div className="mt-1.5 flex items-center justify-between text-[11px]">
                    <span
                      className="font-semibold"
                      style={{
                        color:
                          strike.phase === "missed"
                            ? FORGE.crimson
                            : strike.phase === "live"
                              ? FORGE.goldBright
                              : FORGE.silver,
                      }}
                    >
                      {strike.precisionLabel}
                    </span>
                    <span className="font-mono text-text-muted">{strike.detail}</span>
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-3">
                <TxButton onClick={handleStrike} disabled={!strike?.canStrike}>
                  {strike?.phase === "heating"
                    ? "Heating…"
                    : strike?.phase === "missed"
                      ? "Window missed"
                      : "Strike now"}
                </TxButton>
                <TxButton onClick={handleAbandonCraft} variant="danger">
                  Abandon Craft
                </TxButton>
              </div>
            </div>
          ) : (
            // ---- Idle: cost preview + Start ----
            <>
              <div className="card">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
                  {slotInfo.name} · {qualityInfo.name}
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-xs text-text-muted">NOVI Cost</div>
                    <div className="text-sm font-semibold text-text-gold">
                      {qualityInfo.noviCost.toLocaleString()}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-text-muted">Tempering Stages</div>
                    <div className="text-sm font-semibold text-text-secondary">
                      {qualityInfo.stages} strikes
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-text-muted">Craft Time</div>
                    <div className="text-sm font-semibold text-text-secondary">{qualityInfo.craftTime}</div>
                  </div>
                  <div>
                    <div className="text-xs text-text-muted">Strike Window</div>
                    <div className="text-sm font-semibold text-text-secondary">{qualityInfo.window}</div>
                  </div>
                </div>

                {materialCheck.length > 0 && (
                  <div className="mt-4">
                    <div className="mb-2 text-xs font-semibold text-text-muted">Material Requirements</div>
                    <div className="flex flex-wrap gap-3">
                      {materialCheck.map((m) => (
                        <div key={m.name} className="rounded border border-zinc-800 px-3 py-2">
                          <div className="text-[11px] text-text-muted">{m.name}</div>
                          <div
                            className="text-sm font-semibold"
                            style={{ color: m.ok ? FORGE.gold : FORGE.crimson }}
                          >
                            {m.have} / {m.need}
                          </div>
                        </div>
                      ))}
                    </div>
                    {materialCheck.some((m) => !m.ok) && (
                      <div className="mt-2 text-[11px]" style={{ color: FORGE.crimson }}>
                        Insufficient materials
                      </div>
                    )}
                  </div>
                )}

                <div className="mt-3 text-[11px] text-text-muted">
                  {qualityInfo.successRate >= 85 ? (
                    <span style={{ color: FORGE.gold }}>High success rate. Reliable at this tier.</span>
                  ) : qualityInfo.successRate >= 50 ? (
                    <span style={{ color: FORGE.bronze }}>
                      Moderate success. Strike within each window precisely.
                    </span>
                  ) : (
                    <span style={{ color: FORGE.crimson }}>
                      Low success. Expert timing and high Forge mastery required.
                    </span>
                  )}{" "}
                  Missing a strike window fails the craft.
                </div>
              </div>

              <TxButton onClick={handleStartCraft} disabled={!!startReason} className="px-6">
                Start Forging {slotInfo.short}
              </TxButton>
            </>
          )
        ) : (
          // Equip-mode aside: lifetime forge stats.
          <div className="card">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
              Forge Record
            </h3>
            {craft ? (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-xs text-text-muted">Successful</div>
                  <div className="text-sm font-semibold" style={{ color: FORGE.gold }}>
                    {craft.successfulCrafts}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-text-muted">Failed</div>
                  <div className="text-sm font-semibold" style={{ color: FORGE.crimson }}>
                    {craft.failedCrafts}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-text-muted">Total Crafts</div>
                  <div className="text-sm font-semibold text-text-secondary">{craft.totalCrafts}</div>
                </div>
                <div>
                  <div className="text-xs text-text-muted">NOVI Spent</div>
                  <div className="text-sm font-semibold text-text-gold">
                    {Number(craft.totalNoviSpent).toLocaleString()}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-[11px] text-text-muted">No crafts yet.</div>
            )}
          </div>
        )
      }
    />
  );
}
