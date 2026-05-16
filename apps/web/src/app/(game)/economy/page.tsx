"use client";

import { useState, useMemo } from "react";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useGameEngine } from "@/lib/hooks/useGameEngine";
import { useTeam } from "@/lib/hooks/useTeam";
import { useQuery } from "@tanstack/react-query";
import { PublicKey } from "@solana/web3.js";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useWallet } from "@solana/wallet-adapter-react";
import { GoldNumber } from "@/components/shared/GoldNumber";
import { TxButton } from "@/components/shared/TxButton";
import { StatBar } from "@/components/shared/StatBar";
import type { TxPhase } from "@/components/shared/TxButton";
import { PageTransition } from "@/components/shared/PageTransition";
import { FeatureGate } from "@/components/shared/FeatureGate";
import { FEATURES, useFeatureGate } from "@/lib/hooks/useFeatureGate";
import Link from "next/link";
import { NoviGenerator } from "@/components/shared/NoviGenerator";
import { NoviRewards } from "@/components/shared/NoviRewards";
import { GameInfoPanel } from "@/components/shared/GameInfoPanel";
import { InfoGrid } from "@/components/shared/InfoGrid";
import { bpsToMultiplier, formatTime } from "@/lib/utils";
import {
  createPurchaseStaminaInstruction,
  createCollectResourcesInstruction,
  createVaultTransferInstruction,
  createUpdateLockedNoviInstruction,
  createTransferCashInstruction,
  derivePlayerPda,
  isNullPubkey,
  getCurrentTimeOfDay,
  getTimeOfDayName,
  getActivityMultiplier,
  isTraveling,
  getEffectiveTier,
} from "@/lib/sdk";

const COLLECTION_TYPES = [
  {
    label: "Cash Collection",
    shortLabel: "Cash",
    value: 0,
    icon: "$",
    produces: "Cash on Hand",
    units: "Operative",
    color: "amber",
    desc: "Convert NOVI into cash via your operative workforce",
    feature: FEATURES.COLLECT_CASH,
  },
  {
    label: "Gem Mining",
    shortLabel: "Mining",
    value: 1,
    icon: "✦",
    produces: "Gems + Fragments",
    units: "Operative",
    color: "purple",
    desc: "Mine precious gems from deep underground veins",
    feature: FEATURES.COLLECT_MINING,
  },
  {
    label: "Fishing",
    shortLabel: "Fishing",
    value: 2,
    icon: "~",
    produces: "Produce + Fragments",
    units: "Operative",
    color: "cyan",
    desc: "Harvest the waters for food to sustain your forces",
    feature: FEATURES.COLLECT_FISHING,
  },
  {
    label: "Farming",
    shortLabel: "Farming",
    value: 3,
    icon: "⚘",
    produces: "Produce + Fragments",
    units: "Defensive",
    color: "green",
    desc: "Tend the land with your defensive units to grow food",
    feature: FEATURES.COLLECT_FARMING,
  },
] as const;

export default function EconomyPage() {
  const { data: playerData } = usePlayer();
  const { data: geData } = useGameEngine();
  const client = useNovusMundusClient();
  const { publicKey } = useWallet();
  const transact = useTransact();

  const player = playerData?.account;
  const [activeTab, setActiveTab] = useState<"collect" | "stamina" | "transfer" | "send">("collect");
  const [collectType, setCollectType] = useState(0);
  const [collectNoviAmount, setCollectNoviAmount] = useState(100);
  const [vaultAmount, setVaultAmount] = useState(0);
  const [vaultDirection, setVaultDirection] = useState<"deposit" | "withdraw">("deposit");

  const tabs = [
    { key: "collect" as const, label: "Collect" },
    { key: "stamina" as const, label: "Stamina" },
    { key: "transfer" as const, label: "Vault" },
    { key: "send" as const, label: "Send Cash" },
  ];

  const now = Math.floor(Date.now() / 1000);
  const timeInfo = useMemo(() => {
    if (!player) return null;
    const longitude = player.currentLong ?? 0;
    const tod = getCurrentTimeOfDay(now, longitude / 10000);
    return {
      name: getTimeOfDayName(tod),
      hiringMult: getActivityMultiplier('hiring' as any, tod),
    };
  }, [player, now]);

  const travelWarning = useMemo(() => {
    if (!player) return null;
    return isTraveling(player) ? "Cannot act while traveling" : null;
  }, [player]);

  const vaultValidation = useMemo(() => {
    if (!player || vaultAmount <= 0) return null;
    if (vaultDirection === "deposit") {
      const cash = player.cashOnHand.toNumber();
      if (vaultAmount > cash) return `Insufficient cash on hand (have $${cash.toLocaleString()})`;
    } else {
      const vault = player.cashInVault.toNumber();
      if (vaultAmount > vault) return `Insufficient vault cash (have $${vault.toLocaleString()})`;
    }
    return null;
  }, [player, vaultAmount, vaultDirection]);

  // ── Handlers ─────────────────────────────────────────────

  const handleCollect = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const ix = createCollectResourcesInstruction(
      { owner: publicKey, gameEngine: ge },
      { noviAmount: collectNoviAmount, collectionType: collectType }
    );
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["player"]],
      successMessage: `Collected ${COLLECTION_TYPES[collectType]?.label} resources!`,
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleClaimAndCollect = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const claimIx = createUpdateLockedNoviInstruction({ owner: publicKey, gameEngine: ge });
    const collectIx = createCollectResourcesInstruction(
      { owner: publicKey, gameEngine: ge },
      { noviAmount: collectNoviAmount, collectionType: collectType }
    );
    return transact.mutateAsync({
      instructions: [claimIx, collectIx],
      invalidateKeys: [["player"]],
      successMessage: `Claimed NOVI & collected ${COLLECTION_TYPES[collectType]?.label}!`,
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handlePurchaseStamina = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const ix = createPurchaseStaminaInstruction(
      { owner: publicKey, gameEngine: ge },
      { amount: 10 }
    );
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["player"]],
      successMessage: "Stamina purchased!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleClaimAndStamina = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const claimIx = createUpdateLockedNoviInstruction({ owner: publicKey, gameEngine: ge });
    const staminaIx = createPurchaseStaminaInstruction(
      { owner: publicKey, gameEngine: ge },
      { amount: 10 }
    );
    return transact.mutateAsync({
      instructions: [claimIx, staminaIx],
      invalidateKeys: [["player"]],
      successMessage: "Claimed NOVI & purchased stamina!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleVaultTransfer = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const ix = createVaultTransferInstruction(
      { owner: publicKey, gameEngine: ge },
      { amount: vaultAmount, toVault: vaultDirection === "deposit" },
    );
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["player"]],
      successMessage: `Vault ${vaultDirection === "deposit" ? "deposit" : "withdrawal"} complete!`,
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  return (
    <PageTransition>
      <div className="flex h-full flex-col gap-3 overflow-hidden">
        {/* Header + tabs */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
          <h1 className="tier-title font-display text-xl font-bold tracking-wide sm:text-2xl">ECONOMY</h1>
          <div className="-mx-4 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <div className="flex gap-1 rounded-lg bg-surface p-1">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    activeTab === tab.key
                      ? "bg-surface-raised text-text-gold"
                      : "text-text-muted hover:text-text-secondary"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Treasury strip — horizontal on mobile, hidden here on lg (shown in sidebar) */}
        {player && (
          <div className="flex gap-3 overflow-x-auto text-xs lg:hidden">
            <div className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border-default bg-surface-raised px-2.5 py-1.5">
              <span className="text-text-muted">Cash</span>
              <GoldNumber value={player.cashOnHand.toNumber()} prefix="$" format="compact" size="sm" />
            </div>
            <div className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border-default bg-surface-raised px-2.5 py-1.5">
              <span className="text-text-muted">Vault</span>
              <GoldNumber value={player.cashInVault.toNumber()} prefix="$" format="compact" size="sm" glow={false} />
            </div>
            <div className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border-default bg-surface-raised px-2.5 py-1.5">
              <span className="text-text-muted">NOVI</span>
              <GoldNumber value={player.lockedNovi.toNumber()} prefix="◆" format="compact" size="sm" />
            </div>
            <div className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border-default bg-surface-raised px-2.5 py-1.5">
              <span className="text-text-muted">Gems</span>
              <GoldNumber value={player.gems.toNumber()} prefix="✦" size="sm" />
            </div>
            {timeInfo && (
              <div className="flex shrink-0 items-center gap-1 rounded-lg border border-border-default bg-surface-raised px-2.5 py-1.5 text-text-muted">
                {timeInfo.name}
                {timeInfo.hiringMult > 1 && (
                  <span className="text-green-400">-{((timeInfo.hiringMult - 1) * 100).toFixed(0)}%</span>
                )}
                {timeInfo.hiringMult < 1 && (
                  <span className="text-amber-400">+{((1 - timeInfo.hiringMult) / timeInfo.hiringMult * 100).toFixed(0)}%</span>
                )}
              </div>
            )}
          </div>
        )}

        {travelWarning && (
          <div className="rounded-lg border border-amber-800/50 bg-amber-900/20 p-2 text-xs text-amber-300">
            {travelWarning}
          </div>
        )}

        {/* Main content: sidebar treasury (desktop only) + active panel */}
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-hidden lg:grid-cols-4">
          {/* Left sidebar: treasury + NOVI — desktop only */}
          <div className="hidden flex-col gap-3 overflow-y-auto lg:flex">
            {player && (
              <div className="card accent-border">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">Treasury</h3>
                <div className="space-y-1.5">
                  <div className="flex justify-between text-sm">
                    <span className="text-text-muted">Cash</span>
                    <GoldNumber value={player.cashOnHand.toNumber()} prefix="$ " format="compact" />
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-text-muted">Vault</span>
                    <GoldNumber value={player.cashInVault.toNumber()} prefix="$ " format="compact" glow={false} />
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-text-muted">NOVI</span>
                    <GoldNumber value={player.lockedNovi.toNumber()} prefix="◆ " format="compact" />
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-text-muted">Gems</span>
                    <GoldNumber value={player.gems.toNumber()} prefix="✦ " />
                  </div>
                </div>
                {timeInfo && (
                  <div className="mt-2 border-t border-border-default pt-2 text-[10px] text-text-muted">
                    {timeInfo.name}
                    {timeInfo.hiringMult > 1 && (
                      <span className="ml-1 text-green-400">-{((timeInfo.hiringMult - 1) * 100).toFixed(0)}%</span>
                    )}
                    {timeInfo.hiringMult < 1 && (
                      <span className="ml-1 text-amber-400">+{((1 - timeInfo.hiringMult) / timeInfo.hiringMult * 100).toFixed(0)}%</span>
                    )}
                  </div>
                )}
              </div>
            )}
            <NoviGenerator compact />
            <NoviRewards />
          </div>

          {/* Right: active tab panel */}
          <div className="col-span-1 overflow-y-auto lg:col-span-3">

        {/* ── Collect Resources ── */}
        {activeTab === "collect" && player && (
          <CollectPanel
            player={player}
            collectType={collectType}
            setCollectType={setCollectType}
            collectNoviAmount={collectNoviAmount}
            setCollectNoviAmount={setCollectNoviAmount}
            onCollect={handleCollect}
            onClaimAndCollect={handleClaimAndCollect}
          />
        )}

        {/* ── Stamina ── */}
        {activeTab === "stamina" && player && (
          <div className="card">
            <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-text-muted">
              Stamina Refill
            </h3>
            <div className="mb-4 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-text-muted">Current Stamina</div>
                  <GoldNumber
                    value={player.encounterStamina?.toNumber?.() ?? 0}
                    suffix={` / ${player.maxEncounterStamina?.toNumber?.() ?? 0}`}
                  />
                </div>
                <div className="text-right text-xs text-text-muted">
                  Regen: 1 per 5 min
                </div>
              </div>
              <StatBar
                current={player.encounterStamina?.toNumber?.() ?? 0}
                max={player.maxEncounterStamina?.toNumber?.() ?? 100}
                color="gold"
                showValues={false}
              />
              <div className="text-[10px] text-text-muted sm:text-[11px]">
                Common 10 · Uncommon 25 · Rare 50 · Epic 100 · Legendary 250
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
              <TxButton onClick={handlePurchaseStamina} className="w-full sm:w-auto">Buy 10 Stamina</TxButton>
              <TxButton onClick={handleClaimAndStamina} variant="secondary" className="w-full text-xs sm:w-auto">
                Claim NOVI &amp; Buy Stamina
              </TxButton>
            </div>
          </div>
        )}

        {/* ── Vault Transfer ── */}
        {activeTab === "transfer" && player && (
          <FeatureGate feature={FEATURES.VAULT_TRANSFER}>
          <div className="card">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
              Vault Transfer
            </h3>
            <p className="mb-4 text-xs text-text-muted">
              Vault provides 75% protection during PvP attacks. Requires estate with Vault building.
            </p>
            <div className="mb-4 flex gap-2">
              <button
                onClick={() => setVaultDirection("deposit")}
                className={`flex-1 rounded-lg px-3 py-2 text-sm sm:flex-none ${
                  vaultDirection === "deposit"
                    ? "bg-amber-900/30 text-text-gold"
                    : "text-text-muted"
                }`}
              >
                Hand → Vault
              </button>
              <button
                onClick={() => setVaultDirection("withdraw")}
                className={`flex-1 rounded-lg px-3 py-2 text-sm sm:flex-none ${
                  vaultDirection === "withdraw"
                    ? "bg-amber-900/30 text-text-gold"
                    : "text-text-muted"
                }`}
              >
                Vault → Hand
              </button>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
              <input
                type="number"
                value={vaultAmount}
                onChange={(e) => setVaultAmount(Math.max(0, parseInt(e.target.value) || 0))}
                className="w-full rounded-lg border border-zinc-800 bg-surface px-3 py-2 text-sm text-text-primary sm:w-32"
                placeholder="Amount"
              />
              <TxButton
                onClick={handleVaultTransfer}
                disabled={vaultAmount <= 0 || !!vaultValidation}
                className="w-full sm:w-auto"
              >
                {vaultDirection === "deposit" ? "Deposit" : "Withdraw"} ${vaultAmount.toLocaleString()}
              </TxButton>
            </div>
            {vaultValidation && (
              <div className="mt-2 text-xs text-red-400">{vaultValidation}</div>
            )}
          </div>
          </FeatureGate>
        )}

        {/* ── Send Cash ── */}
        {activeTab === "send" && player && (
          <SendCashPanel player={player} />
        )}

        {/* Game Parameters */}
        {geData?.account && (() => {
          const ge = geData.account;
          const ec = ge.economicConfig;
          const cc = ge.combatConfig;
          return (
            <GameInfoPanel>
              <InfoGrid items={[
                { label: "Cost Multiplier", value: ec.costMultiplier.toNumber().toLocaleString(), highlight: true },
                { label: "Infantry Cost", value: ec.defensiveUnit1Cost.toNumber().toLocaleString() },
                { label: "Cavalry Cost", value: ec.defensiveUnit2Cost.toNumber().toLocaleString() },
                { label: "Siege Unit Cost", value: ec.defensiveUnit3Cost.toNumber().toLocaleString() },
                { label: "Laborer Cost", value: ec.operativeUnit1Cost.toNumber().toLocaleString() },
                { label: "Artisan Cost", value: ec.operativeUnit2Cost.toNumber().toLocaleString() },
                { label: "Engineer Cost", value: ec.operativeUnit3Cost.toNumber().toLocaleString() },
                { label: "Melee Weapon", value: ec.meleeWeaponCost.toNumber().toLocaleString() },
                { label: "Ranged Weapon", value: ec.rangedWeaponCost.toNumber().toLocaleString() },
                { label: "Siege Weapon", value: ec.siegeWeaponCost.toNumber().toLocaleString() },
                { label: "Armor", value: ec.armorCost.toNumber().toLocaleString() },
                { label: "Vehicle Capacity", value: ge.gameplayConfig.vehicleCapacity.toNumber().toLocaleString() },
                { label: "Industrial Mult", value: bpsToMultiplier(ec.industrialMultiplier) },
                { label: "Office Mult", value: bpsToMultiplier(ec.officeMultiplier) },
                { label: "General Mult", value: bpsToMultiplier(ec.generalMultiplier) },
                { label: "Stamina Cost", value: ec.staminaCost.toNumber().toLocaleString() },
                { label: "Max Stamina T0", value: cc.maxStaminaByTier[0]?.toNumber().toLocaleString() ?? "—" },
                { label: "Max Stamina T1", value: cc.maxStaminaByTier[1]?.toNumber().toLocaleString() ?? "—" },
                { label: "Max Stamina T2", value: cc.maxStaminaByTier[2]?.toNumber().toLocaleString() ?? "—" },
                { label: "Regen Interval", value: formatTime(cc.staminaRegenInterval.toNumber(), "compact") },
              ]} />
            </GameInfoPanel>
          );
        })()}
          </div>
        </div>
      </div>
    </PageTransition>
  );
}

// ─── Collect Resources Panel ────────────────────────────────

const COLOR_MAP = {
  amber:  { border: "border-amber-600",  bg: "bg-amber-900/20",  ring: "ring-amber-600/30",  icon: "text-amber-400",  iconBg: "bg-amber-900/40",  glow: "shadow-amber-900/20",  stat: "text-amber-400",  badge: "bg-amber-900/30 text-amber-400" },
  purple: { border: "border-purple-600", bg: "bg-purple-900/20", ring: "ring-purple-600/30", icon: "text-fuchsia-400", iconBg: "bg-purple-900/40", glow: "shadow-purple-900/20", stat: "text-fuchsia-400", badge: "bg-purple-900/30 text-fuchsia-400" },
  cyan:   { border: "border-cyan-600",   bg: "bg-cyan-900/20",   ring: "ring-cyan-600/30",   icon: "text-cyan-400",   iconBg: "bg-cyan-900/40",   glow: "shadow-cyan-900/20",   stat: "text-cyan-400",   badge: "bg-cyan-900/30 text-cyan-400" },
  green:  { border: "border-green-600",  bg: "bg-green-900/20",  ring: "ring-green-600/30",  icon: "text-green-400",  iconBg: "bg-green-900/40",  glow: "shadow-green-900/20",  stat: "text-green-400",  badge: "bg-green-900/30 text-green-400" },
} as const;

function CollectPanel({
  player,
  collectType,
  setCollectType,
  collectNoviAmount,
  setCollectNoviAmount,
  onCollect,
  onClaimAndCollect,
}: {
  player: any;
  collectType: number;
  setCollectType: (v: number) => void;
  collectNoviAmount: number;
  setCollectNoviAmount: (v: number) => void;
  onCollect: (reportPhase: (p: TxPhase) => void) => Promise<string>;
  onClaimAndCollect: (reportPhase: (p: TxPhase) => void) => Promise<string>;
}) {
  const cashGate = useFeatureGate(FEATURES.COLLECT_CASH);
  const miningGate = useFeatureGate(FEATURES.COLLECT_MINING);
  const fishingGate = useFeatureGate(FEATURES.COLLECT_FISHING);
  const farmingGate = useFeatureGate(FEATURES.COLLECT_FARMING);
  const gates = [cashGate, miningGate, fishingGate, farmingGate];

  const selected = COLLECTION_TYPES[collectType]!;
  const selectedGate = gates[collectType]!;
  const c = COLOR_MAP[selected.color];

  const resourceAmounts: Record<number, { current: number; label: string }> = {
    0: { current: player.cashOnHand?.toNumber?.() ?? 0, label: "Cash on Hand" },
    1: { current: player.gems?.toNumber?.() ?? 0, label: "Gems" },
    2: { current: player.produce?.toNumber?.() ?? 0, label: "Produce" },
    3: { current: player.produce?.toNumber?.() ?? 0, label: "Produce" },
  };

  const operativeTotal =
    (player.operativeUnit1?.toNumber?.() ?? 0) +
    (player.operativeUnit2?.toNumber?.() ?? 0) +
    (player.operativeUnit3?.toNumber?.() ?? 0);
  const defensiveTotal =
    (player.defensiveUnit1?.toNumber?.() ?? 0) +
    (player.defensiveUnit2?.toNumber?.() ?? 0) +
    (player.defensiveUnit3?.toNumber?.() ?? 0);
  const unitCount = selected.units === "Operative" ? operativeTotal : defensiveTotal;

  return (
    <FeatureGate feature={FEATURES.COLLECT_CASH}>
      <div className="space-y-4">
        {/* Collection type cards — 2 cols on mobile, 4 on desktop */}
        <div className="grid gap-2 grid-cols-2 lg:grid-cols-4">
          {COLLECTION_TYPES.map((ct, i) => {
            const gate = gates[i]!;
            const clr = COLOR_MAP[ct.color];
            const isSelected = collectType === ct.value;
            const isLocked = !gate.allowed;
            const res = resourceAmounts[ct.value]!;

            return (
              <button
                key={ct.value}
                onClick={() => !isLocked && setCollectType(ct.value)}
                disabled={isLocked}
                className={`group relative rounded-xl border p-3 text-left transition-all sm:p-4 ${
                  isLocked
                    ? "cursor-not-allowed border-zinc-800/50 opacity-50"
                    : isSelected
                      ? `${clr.border} ${clr.bg} ring-2 ${clr.ring} shadow-lg ${clr.glow}`
                      : "border-zinc-800 hover:border-zinc-600"
                }`}
              >
                <div className="flex items-center gap-2 mb-2 sm:gap-3 sm:mb-3">
                  <div className={`flex h-8 w-8 items-center justify-center rounded-lg text-base sm:h-10 sm:w-10 sm:text-lg ${isLocked ? "bg-zinc-800 text-zinc-600" : `${clr.iconBg} ${clr.icon}`}`}>
                    {isLocked ? "🔒" : ct.icon}
                  </div>
                  <div className="min-w-0">
                    <div className={`text-sm font-bold truncate ${isLocked ? "text-zinc-600" : "text-text-primary"}`}>
                      {ct.shortLabel}
                    </div>
                    <div className={`text-[10px] truncate ${isLocked ? "text-zinc-700" : "text-text-muted"}`}>
                      {ct.produces}
                    </div>
                  </div>
                </div>

                {!isLocked && (
                  <div className="flex items-baseline justify-between">
                    <span className="text-[10px] text-text-muted">{res.label}</span>
                    <span className={`font-mono text-sm font-bold tabular-nums ${clr.stat}`}>
                      {res.current.toLocaleString()}
                    </span>
                  </div>
                )}

                {isLocked && gate.missing.length > 0 && (
                  <div className="text-[10px] text-zinc-600">
                    {gate.missing[0]!.label}
                  </div>
                )}

                {isSelected && !isLocked && (
                  <div className={`absolute -top-1 -right-1 h-3 w-3 rounded-full ${clr.border} ${clr.bg} ring-2 ring-surface-raised`}>
                    <div className={`h-full w-full rounded-full ${clr.icon.replace("text-", "bg-")} animate-pulse`} />
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Selected type detail + action */}
        <div className={`rounded-xl border ${c.border} ${c.bg} p-4 sm:p-5`}>
          <div className="flex flex-col gap-4">
            {/* Info */}
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <div className={`flex h-8 w-8 items-center justify-center rounded-lg text-base ${c.iconBg} ${c.icon}`}>
                  {selected.icon}
                </div>
                <div>
                  <div className="text-base font-bold text-text-primary">{selected.label}</div>
                  <div className="text-xs text-text-muted">{selected.desc}</div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 sm:gap-3">
                <div className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold ${c.badge}`}>
                  {selected.units} Units: {unitCount.toLocaleString()}
                </div>
                <div className="rounded-lg bg-surface/60 px-2.5 py-1 text-[11px] text-text-muted">
                  NOVI: <span className="font-mono text-text-gold">{player.lockedNovi?.toNumber?.().toLocaleString() ?? 0}</span>
                </div>
                {unitCount === 0 && (
                  <div className="rounded-lg bg-red-900/20 px-2.5 py-1 text-[11px] font-semibold text-red-400">
                    No {selected.units.toLowerCase()} units
                  </div>
                )}
              </div>

              {!selectedGate.allowed && selectedGate.missing.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {selectedGate.missing.map((m) => (
                    <Link
                      key={m.label}
                      href={m.href}
                      className="rounded-md border border-amber-800/50 bg-amber-900/20 px-2.5 py-1 text-xs font-medium text-text-gold hover:bg-amber-900/40"
                    >
                      {m.label} &rarr;
                    </Link>
                  ))}
                </div>
              )}
            </div>

            {/* NOVI input + buttons */}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs text-text-muted">NOVI:</span>
                <input
                  type="number"
                  value={collectNoviAmount}
                  onChange={(e) => setCollectNoviAmount(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-full rounded-lg border border-zinc-800 bg-surface px-3 py-2 text-sm font-mono text-text-primary tabular-nums sm:w-28"
                  min={1}
                />
              </div>
              <div className="flex gap-2">
                <TxButton
                  onClick={onCollect}
                  disabled={!selectedGate.allowed || unitCount === 0}
                  className="flex-1 sm:flex-none"
                >
                  Collect {selected.shortLabel}
                </TxButton>
                <TxButton
                  onClick={onClaimAndCollect}
                  variant="secondary"
                  className="flex-1 text-xs sm:flex-none"
                  disabled={!selectedGate.allowed || unitCount === 0}
                >
                  Claim &amp; Collect
                </TxButton>
              </div>
            </div>
          </div>
        </div>
      </div>
    </FeatureGate>
  );
}

// ─── Send Cash Panel ────────────────────────────────────────

function SendCashPanel({ player }: { player: any }) {
  const client = useNovusMundusClient();
  const { publicKey } = useWallet();
  const transact = useTransact();
  const [recipient, setRecipient] = useState<PublicKey | null>(null);
  const [amount, setAmount] = useState(0);

  const teamPubkey =
    player?.team && !isNullPubkey(player.team) ? player.team : null;
  const { data: teamData } = useTeam(teamPubkey);
  const teamId = teamData?.account?.id;

  const { data: members } = useQuery({
    queryKey: ["teamMembers", teamPubkey?.toBase58()],
    queryFn: async () => {
      if (!teamPubkey) return [];
      return client.fetchTeamMembers(teamPubkey);
    },
    enabled: !!teamPubkey,
    staleTime: 30_000,
  });

  if (!teamPubkey) {
    return (
      <div className="card text-center">
        <p className="text-sm text-text-muted">
          Join a team to send cash to teammates.
        </p>
      </div>
    );
  }

  const myPlayerPda = publicKey
    ? derivePlayerPda(client.gameEngine, publicKey)[0].toBase58()
    : null;
  const recipients = (members ?? []).filter(
    (m: any) => m.account.player.toBase58() !== myPlayerPda,
  );

  const cashOnHand = player?.cashOnHand?.toNumber?.() ?? 0;
  const amountError =
    amount > 0 && amount > cashOnHand
      ? `Insufficient cash (have $${cashOnHand.toLocaleString()})`
      : null;

  const handleSend = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    if (!recipient) throw new Error("Select a recipient");
    if (teamId == null) throw new Error("Team not loaded");
    const ix = createTransferCashInstruction(
      {
        sender: publicKey,
        gameEngine: client.gameEngine,
        receiverPlayer: recipient,
        team: teamPubkey,
        teamId: teamId.toNumber(),
      },
      { amount },
    );
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["player"]],
      successMessage: "Cash sent!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  return (
    <div className="card">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
        Send Cash to Teammate
      </h3>
      <p className="mb-4 text-xs text-text-muted">
        Transfer cash on hand to a member of your team. Cash on hand: $
        {cashOnHand.toLocaleString()}.
      </p>

      {recipients.length === 0 ? (
        <p className="text-sm text-text-muted">No other team members to send to.</p>
      ) : (
        <>
          <div className="mb-4 space-y-2">
            {recipients.map((m: any) => {
              const pda = m.account.player.toBase58();
              const isSelected = recipient?.toBase58() === pda;
              return (
                <button
                  key={pda}
                  onClick={() => setRecipient(m.account.player)}
                  className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left transition-all ${
                    isSelected
                      ? "border-amber-600 bg-amber-900/20"
                      : "border-zinc-800 hover:border-zinc-700"
                  }`}
                >
                  <span className="font-mono text-sm text-text-primary">
                    {pda.slice(0, 4)}…{pda.slice(-4)}
                  </span>
                  <span className="text-xs text-text-muted">Slot {m.account.slotIndex}</span>
                </button>
              );
            })}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(Math.max(0, parseInt(e.target.value) || 0))}
              className="w-full rounded-lg border border-zinc-800 bg-surface px-3 py-2 text-sm text-text-primary sm:w-40"
              placeholder="Amount"
            />
            <TxButton
              onClick={handleSend}
              disabled={!recipient || amount <= 0 || !!amountError}
              className="w-full sm:w-auto"
            >
              Send ${amount.toLocaleString()}
            </TxButton>
          </div>
          {amountError && (
            <div className="mt-2 text-xs text-red-400">{amountError}</div>
          )}
        </>
      )}
    </div>
  );
}
