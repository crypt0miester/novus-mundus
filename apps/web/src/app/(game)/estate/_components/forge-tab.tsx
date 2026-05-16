"use client";

import { useState, useMemo } from "react";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useWallet } from "@solana/wallet-adapter-react";
import { useConnection } from "@solana/wallet-adapter-react";
import { useQuery } from "@tanstack/react-query";
import { GoldNumber } from "@/components/shared/GoldNumber";
import { GoldCountdown } from "@/components/shared/GoldCountdown";
import { StatBar } from "@/components/shared/StatBar";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import {
  derivePlayerPda,
  deriveCraftedEquipmentPda,
  createStartCraftInstruction,
  createStrikeInstruction,
  createAbandonCraftInstruction,
  createEquipInstruction,
  getCurrentTimeOfDay,
  getTimeOfDayName,
  getActivityMultiplier,
  isTraveling,
} from "novus-mundus-sdk";

const CRAFT_TYPES = [
  { id: 0, name: "Sword", desc: "Melee weapon", icon: "\uD83D\uDDE1" },
  { id: 1, name: "Bow", desc: "Ranged weapon", icon: "\uD83C\uDFF9" },
  { id: 2, name: "Shield", desc: "Defensive armor", icon: "\uD83D\uDEE1" },
  { id: 3, name: "Helm", desc: "Head armor", icon: "\u26D1" },
];

const EQUIP_TYPES = [
  { id: 0, name: "Melee Weapon" },
  { id: 1, name: "Ranged Weapon" },
  { id: 2, name: "Siege Weapon" },
  { id: 3, name: "Armor" },
];

export function ForgeTab() {
  const { data: playerData } = usePlayer();
  const player = playerData?.account;
  const client = useNovusMundusClient();
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const transact = useTransact();

  // Fetch crafted equipment
  const { data: craftData } = useQuery({
    queryKey: ["craft", publicKey?.toBase58()],
    queryFn: async () => {
      if (!publicKey) return null;
      const ge = client.gameEngine;
      const [playerPda] = derivePlayerPda(ge, publicKey);
      const [craftPda] = deriveCraftedEquipmentPda(playerPda);
      const info = await connection.getAccountInfo(craftPda);
      if (!info) return { pubkey: craftPda, exists: false, account: null };
      return { pubkey: craftPda, exists: true, account: info };
    },
    enabled: !!publicKey,
    staleTime: 10_000,
  });

  const [selectedCraft, setSelectedCraft] = useState(0);
  const [selectedQuality, setSelectedQuality] = useState(1); // Default to Refined
  const [equipType, setEquipType] = useState(0);
  const [equipTier, setEquipTier] = useState(1);

  // Quality tier reference data (mirrors on-chain QualityTier)
  const QUALITY_TIERS = useMemo(() => [
    { id: 0, name: "Common", noviCost: 0, materials: { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0 }, stages: 0, craftTime: "N/A", successRate: 100, forgeReq: 0, window: "N/A" },
    { id: 1, name: "Refined", noviCost: 1_000, materials: { common: 50, uncommon: 0, rare: 0, epic: 0, legendary: 0 }, stages: 1, craftTime: "4h", successRate: 100, forgeReq: 1, window: "1h" },
    { id: 2, name: "Superior", noviCost: 2_618, materials: { common: 100, uncommon: 25, rare: 0, epic: 0, legendary: 0 }, stages: 2, craftTime: "8h", successRate: 95, forgeReq: 5, window: "30m" },
    { id: 3, name: "Elite", noviCost: 6_854, materials: { common: 0, uncommon: 100, rare: 25, epic: 0, legendary: 0 }, stages: 3, craftTime: "16h", successRate: 85, forgeReq: 8, window: "15m" },
    { id: 4, name: "Masterwork", noviCost: 17_944, materials: { common: 0, uncommon: 0, rare: 100, epic: 25, legendary: 0 }, stages: 5, craftTime: "24h", successRate: 70, forgeReq: 12, window: "5m" },
    { id: 5, name: "Legendary", noviCost: 46_979, materials: { common: 0, uncommon: 0, rare: 0, epic: 100, legendary: 25 }, stages: 8, craftTime: "48h", successRate: 50, forgeReq: 16, window: "2m" },
    { id: 6, name: "Mythic", noviCost: 122_991, materials: { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 200 }, stages: 11, craftTime: "72h", successRate: 30, forgeReq: 18, window: "1.5m" },
    { id: 7, name: "Divine", noviCost: 322_069, materials: { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 400 }, stages: 13, craftTime: "7d", successRate: 15, forgeReq: 20, window: "1m" },
  ], []);

  // Time-of-day indicator
  const now = Math.floor(Date.now() / 1000);
  const timeInfo = useMemo(() => {
    if (!player) return null;
    const longitude = player.currentLong ?? 0;
    const tod = getCurrentTimeOfDay(now, longitude / 10000);
    return {
      name: getTimeOfDayName(tod),
    };
  }, [player, now]);

  // Traveling warning
  const travelWarning = useMemo(() => {
    if (!player) return null;
    return isTraveling(player) ? "Cannot craft while traveling" : null;
  }, [player]);

  // Selected quality info
  const qualityInfo = useMemo(() => {
    return QUALITY_TIERS[selectedQuality] ?? QUALITY_TIERS[1];
  }, [selectedQuality, QUALITY_TIERS]);

  // Material validation
  const materialCheck = useMemo(() => {
    if (!player || !qualityInfo) return null;
    const mats = qualityInfo.materials;
    const checks = [];
    if (mats.common > 0) {
      const have = player.commonMaterials?.toNumber?.() ?? 0;
      checks.push({ name: "Common", need: mats.common, have, ok: have >= mats.common });
    }
    if (mats.uncommon > 0) {
      const have = player.uncommonMaterials?.toNumber?.() ?? 0;
      checks.push({ name: "Uncommon", need: mats.uncommon, have, ok: have >= mats.uncommon });
    }
    if (mats.rare > 0) {
      const have = player.rareMaterials?.toNumber?.() ?? 0;
      checks.push({ name: "Rare", need: mats.rare, have, ok: have >= mats.rare });
    }
    if (mats.epic > 0) {
      const have = player.epicMaterials?.toNumber?.() ?? 0;
      checks.push({ name: "Epic", need: mats.epic, have, ok: have >= mats.epic });
    }
    if (mats.legendary > 0) {
      const have = player.legendaryMaterials?.toNumber?.() ?? 0;
      checks.push({ name: "Legendary", need: mats.legendary, have, ok: have >= mats.legendary });
    }
    return checks;
  }, [player, qualityInfo]);

  const handleStartCraft = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const ix = createStartCraftInstruction(
      { owner: publicKey, gameEngine: ge },
      { equipmentType: selectedCraft, qualityTier: selectedQuality },
    );
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["craft"], ["player"]],
      successMessage: `Crafting ${CRAFT_TYPES[selectedCraft]?.name ?? "equipment"} at ${QUALITY_TIERS[selectedQuality]?.name ?? ""} tier...`,
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleStrike = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const ix = createStrikeInstruction({ owner: publicKey, gameEngine: ge });
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["craft"], ["player"]],
      successMessage: "Strike!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleAbandonCraft = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const ix = createAbandonCraftInstruction({
      owner: publicKey,
      gameEngine: ge,
    });
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["craft"], ["player"]],
      successMessage: "Craft abandoned!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleEquip = async (
    equipmentType: number,
    qualityTier: number,
    reportPhase: (p: TxPhase) => void,
  ) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ix = createEquipInstruction(
      { owner: publicKey, gameEngine: client.gameEngine },
      { equipmentType, qualityTier },
    );
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["craft"], ["player"]],
      successMessage: qualityTier === 0 ? "Unequipped." : "Equipped!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  return (
    <div className="space-y-6">
      {travelWarning && (
        <div className="rounded-lg border border-amber-800/50 bg-amber-900/20 p-3 text-sm text-amber-300">
          {travelWarning}
        </div>
      )}

      {/* Time of Day */}
      {timeInfo && (
        <div className="text-xs text-text-muted">
          Time of Day: <span className="text-text-secondary">{timeInfo.name}</span>
        </div>
      )}

      {/* Materials */}
      {player && (
        <div className="card accent-border">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
            Materials
          </h3>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div>
              <div className="text-xs text-text-muted">Fragments</div>
              <GoldNumber value={player.fragments?.toNumber?.() ?? 0} prefix="\u25C7 " />
            </div>
            <div>
              <div className="text-xs text-text-muted">Common</div>
              <GoldNumber value={player.commonMaterials?.toNumber?.() ?? 0} glow={false} />
            </div>
            <div>
              <div className="text-xs text-text-muted">Uncommon</div>
              <GoldNumber value={player.uncommonMaterials?.toNumber?.() ?? 0} glow={false} />
            </div>
            <div>
              <div className="text-xs text-text-muted">Rare</div>
              <GoldNumber value={player.rareMaterials?.toNumber?.() ?? 0} glow={false} />
            </div>
          </div>
        </div>
      )}

      {/* Craft Selection */}
      <div>
        <h2 className="mb-3 text-lg font-semibold text-text-primary">Choose Equipment</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {CRAFT_TYPES.map((craft) => (
            <button
              key={craft.id}
              onClick={() => setSelectedCraft(craft.id)}
              className={`rounded-lg border p-4 text-left transition-all ${
                selectedCraft === craft.id
                  ? "border-amber-600 bg-amber-900/20"
                  : "border-zinc-800 hover:border-zinc-700"
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="text-3xl">{craft.icon}</span>
                <div>
                  <div className="text-sm font-semibold text-text-primary">{craft.name}</div>
                  <div className="text-xs text-text-muted">{craft.desc}</div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Quality Tier Selection */}
      <div>
        <h2 className="mb-3 text-lg font-semibold text-text-primary">Quality Tier</h2>
        <div className="grid gap-2 grid-cols-2 md:grid-cols-4">
          {QUALITY_TIERS.filter((q) => q.id > 0).map((q) => (
            <button
              key={q.id}
              onClick={() => setSelectedQuality(q.id)}
              className={`rounded-lg border p-3 text-left transition-all ${
                selectedQuality === q.id
                  ? "border-amber-600 bg-amber-900/20"
                  : "border-zinc-800 hover:border-zinc-700"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-text-primary">{q.name}</div>
                <span className={`text-[11px] ${
                  q.successRate >= 85 ? "text-green-400" : q.successRate >= 50 ? "text-amber-400" : "text-red-400"
                }`}>
                  {q.successRate}%
                </span>
              </div>
              <div className="text-[11px] text-text-muted">
                {q.noviCost.toLocaleString()} NOVI | {q.stages} stages
              </div>
              <div className="text-[11px] text-text-muted">
                Forge Lv {q.forgeReq}+ | {q.craftTime}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Crafting Cost Preview */}
      {qualityInfo && qualityInfo.id > 0 && (
        <div className="card">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
            {CRAFT_TYPES[selectedCraft]?.name} — {qualityInfo.name} Tier
          </h3>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
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
              <div className="text-sm font-semibold text-text-secondary">
                {qualityInfo.craftTime}
              </div>
            </div>
            <div>
              <div className="text-xs text-text-muted">Strike Window</div>
              <div className="text-sm font-semibold text-text-secondary">
                {qualityInfo.window}
              </div>
            </div>
          </div>

          {/* Material Requirements */}
          {materialCheck && materialCheck.length > 0 && (
            <div className="mt-4">
              <div className="text-xs font-semibold text-text-muted mb-2">Material Requirements</div>
              <div className="flex flex-wrap gap-3">
                {materialCheck.map((m) => (
                  <div key={m.name} className="rounded border border-zinc-800 px-3 py-2">
                    <div className="text-[11px] text-text-muted">{m.name}</div>
                    <div className={`text-sm font-semibold ${m.ok ? "text-green-400" : "text-red-400"}`}>
                      {m.have} / {m.need}
                    </div>
                  </div>
                ))}
              </div>
              {materialCheck.some((m) => !m.ok) && (
                <div className="mt-2 text-[11px] text-red-400">
                  Insufficient materials for this quality tier
                </div>
              )}
            </div>
          )}

          {/* Success hint */}
          <div className="mt-3 text-[11px] text-text-muted">
            {qualityInfo.successRate >= 85 ? (
              <span className="text-green-400">High success rate. Reliable craft at this tier.</span>
            ) : qualityInfo.successRate >= 50 ? (
              <span className="text-amber-400">Moderate success rate. You must strike within each window precisely.</span>
            ) : (
              <span className="text-red-400">Low success rate. Requires expert timing and high Forge mastery.</span>
            )}
            {" "}Missing a strike window fails the craft. Higher Forge levels extend windows.
          </div>
        </div>
      )}

      {/* Equip Gear */}
      <div className="card">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
          Equip Gear
        </h3>
        <p className="mb-3 text-[11px] text-text-muted">
          Set a crafted item active for combat. You must own the chosen quality tier.
        </p>
        <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4">
          {EQUIP_TYPES.map((et) => (
            <button
              key={et.id}
              onClick={() => setEquipType(et.id)}
              className={`rounded-lg border p-2 text-center text-xs transition-all ${
                equipType === et.id
                  ? "border-amber-600 bg-amber-900/20 text-text-primary"
                  : "border-zinc-800 text-text-muted hover:border-zinc-700"
              }`}
            >
              {et.name}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm text-text-muted">
            Quality:
            <select
              value={equipTier}
              onChange={(e) => setEquipTier(parseInt(e.target.value))}
              className="ml-2 rounded-lg border border-zinc-800 bg-surface px-3 py-2 text-sm text-text-primary"
            >
              {QUALITY_TIERS.filter((q) => q.id > 0).map((q) => (
                <option key={q.id} value={q.id}>{q.name}</option>
              ))}
            </select>
          </label>
          <TxButton onClick={(rp) => handleEquip(equipType, equipTier, rp)}>
            Equip
          </TxButton>
          <TxButton onClick={(rp) => handleEquip(equipType, 0, rp)} variant="secondary">
            Unequip
          </TxButton>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap justify-center gap-3">
        <TxButton onClick={handleStartCraft} className="px-6">
          Start Crafting {CRAFT_TYPES[selectedCraft]?.name}
        </TxButton>
        <TxButton onClick={handleStrike} variant="secondary">
          Strike (Improve Quality)
        </TxButton>
        <TxButton onClick={handleAbandonCraft} variant="danger">
          Abandon Craft
        </TxButton>
      </div>
    </div>
  );
}
