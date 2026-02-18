"use client";

import { useState, useMemo } from "react";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useGameEngine } from "@/lib/hooks/useGameEngine";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useWallet } from "@solana/wallet-adapter-react";
import { GoldNumber } from "@/components/shared/GoldNumber";
import { TxButton } from "@/components/shared/TxButton";
import { StatBar } from "@/components/shared/StatBar";
import type { TxPhase } from "@/components/shared/TxButton";
import { PageTransition } from "@/components/shared/PageTransition";
import { FeatureGate } from "@/components/shared/FeatureGate";
import { FEATURES } from "@/lib/hooks/useFeatureGate";
import { NoviGenerator } from "@/components/shared/NoviGenerator";
import { NoviRewards } from "@/components/shared/NoviRewards";
import { GameInfoPanel } from "@/components/shared/GameInfoPanel";
import { InfoGrid } from "@/components/shared/InfoGrid";
import { bpsToMultiplier, formatTime } from "@/lib/utils";
import {
  createHireUnitsInstruction,
  createPurchaseEquipmentInstruction,
  createPurchaseStaminaInstruction,
  createCollectResourcesInstruction,
  createVaultTransferInstruction,
  createUpdateLockedNoviInstruction,
  getCurrentTimeOfDay,
  getTimeOfDayName,
  getActivityMultiplier,
  isTraveling,
  getEffectiveTier,
} from "@/lib/sdk";

const UNIT_TYPES = [
  { label: "Infantry", tier: 1, multiplier: 1, field: "defensiveUnit1" as const, building: "Barracks Lv1" },
  { label: "Cavalry", tier: 2, multiplier: 4, field: "defensiveUnit2" as const, building: "Barracks Lv3" },
  { label: "Siege", tier: 3, multiplier: 16, field: "defensiveUnit3" as const, building: "Barracks Lv5" },
  { label: "Laborer", tier: 1, multiplier: 1, field: "operativeUnit1" as const, building: "Camp Lv1" },
  { label: "Artisan", tier: 2, multiplier: 4, field: "operativeUnit2" as const, building: "Camp Lv3" },
  { label: "Engineer", tier: 3, multiplier: 16, field: "operativeUnit3" as const, building: "Camp Lv5" },
];

const EQUIPMENT = [
  { label: "Melee Weapons", field: "meleeWeapons" as const },
  { label: "Ranged Weapons", field: "rangedWeapons" as const },
  { label: "Siege Weapons", field: "siegeWeapons" as const },
  { label: "Armor Pieces", field: "armorPieces" as const },
];

const COLLECTION_TYPES = [
  { label: "Cash", value: 0 },
  { label: "Mining (Gems)", value: 1 },
  { label: "Fishing (Produce)", value: 2 },
  { label: "Farming (Produce)", value: 3 },
];

export default function EconomyPage() {
  const { data: playerData } = usePlayer();
  const { data: geData } = useGameEngine();
  const client = useNovusMundusClient();
  const { publicKey } = useWallet();
  const transact = useTransact();

  const player = playerData?.account;
  const [activeTab, setActiveTab] = useState<"hire" | "equip" | "collect" | "stamina" | "transfer">("hire");
  const [hireNoviAmount, setHireNoviAmount] = useState(100);
  const [hireType, setHireType] = useState(0);
  const [equipType, setEquipType] = useState(0);
  const [equipAmount, setEquipAmount] = useState(1);
  const [equipPayCash, setEquipPayCash] = useState(false);
  const [collectType, setCollectType] = useState(0);
  const [collectNoviAmount, setCollectNoviAmount] = useState(100);
  const [vaultAmount, setVaultAmount] = useState(0);
  const [vaultDirection, setVaultDirection] = useState<"deposit" | "withdraw">("deposit");

  const tabs = [
    { key: "hire" as const, label: "Hire Units" },
    { key: "equip" as const, label: "Equipment" },
    { key: "collect" as const, label: "Collect" },
    { key: "stamina" as const, label: "Stamina" },
    { key: "transfer" as const, label: "Transfer" },
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

  const handleHire = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const ix = createHireUnitsInstruction(
      { owner: publicKey, gameEngine: ge },
      { unitType: hireType, noviAmount: hireNoviAmount }
    );
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["player"]],
      successMessage: `Spent ${hireNoviAmount} NOVI to hire ${UNIT_TYPES[hireType]?.label}!`,
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleClaimAndHire = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const claimIx = createUpdateLockedNoviInstruction({ owner: publicKey, gameEngine: ge });
    const hireIx = createHireUnitsInstruction(
      { owner: publicKey, gameEngine: ge },
      { unitType: hireType, noviAmount: hireNoviAmount }
    );
    return transact.mutateAsync({
      instructions: [claimIx, hireIx],
      invalidateKeys: [["player"]],
      successMessage: `Claimed NOVI & hired ${UNIT_TYPES[hireType]?.label}!`,
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handlePurchaseEquipment = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const ix = createPurchaseEquipmentInstruction(
      { owner: publicKey, gameEngine: ge },
      { equipmentType: equipType, quantity: equipAmount, payWithCash: equipPayCash }
    );
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["player"]],
      successMessage: `Purchased ${equipAmount} ${EQUIPMENT[equipType]?.label}!`,
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleClaimAndEquip = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const claimIx = createUpdateLockedNoviInstruction({ owner: publicKey, gameEngine: ge });
    const equipIx = createPurchaseEquipmentInstruction(
      { owner: publicKey, gameEngine: ge },
      { equipmentType: equipType, quantity: equipAmount, payWithCash: equipPayCash }
    );
    return transact.mutateAsync({
      instructions: [claimIx, equipIx],
      invalidateKeys: [["player"]],
      successMessage: `Claimed NOVI & purchased ${equipAmount} ${EQUIPMENT[equipType]?.label}!`,
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

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
      <div className="mx-auto max-w-5xl space-y-6">
        <h1 className="tier-title font-display text-3xl font-bold tracking-wide">ECONOMY</h1>

        {travelWarning && (
          <div className="rounded-lg border border-amber-800/50 bg-amber-900/20 p-3 text-sm text-amber-300">
            {travelWarning}
          </div>
        )}

        {/* NOVI Generator + Rewards */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <NoviGenerator compact />
          <NoviRewards />
        </div>

        {/* Treasury Overview */}
        {player && (
          <div className="card accent-border">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <div>
                <div className="text-xs text-text-muted">Cash on Hand</div>
                <GoldNumber value={player.cashOnHand.toNumber()} prefix="$ " format="compact" />
              </div>
              <div>
                <div className="text-xs text-text-muted">Cash in Vault</div>
                <GoldNumber value={player.cashInVault.toNumber()} prefix="$ " format="compact" glow={false} />
              </div>
              <div>
                <div className="text-xs text-text-muted">NOVI</div>
                <GoldNumber value={player.lockedNovi.toNumber()} prefix="◆ " format="compact" />
              </div>
              <div>
                <div className="text-xs text-text-muted">Gems</div>
                <GoldNumber value={player.gems.toNumber()} prefix="✦ " />
              </div>
            </div>
            {timeInfo && (
              <div className="mt-3 text-xs text-text-muted">
                Time of Day: <span className="text-text-secondary">{timeInfo.name}</span>
                {timeInfo.hiringMult > 1 && (
                  <span className="ml-2 text-green-400">Hiring bonus: {((timeInfo.hiringMult - 1) * 100).toFixed(0)}% off</span>
                )}
                {timeInfo.hiringMult < 1 && (
                  <span className="ml-2 text-amber-400">Hiring premium: +{((1 - timeInfo.hiringMult) / timeInfo.hiringMult * 100).toFixed(0)}%</span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 rounded-lg bg-surface p-1">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? "bg-surface-raised text-text-gold"
                  : "text-text-muted hover:text-text-secondary"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Hire Units Panel */}
        {activeTab === "hire" && player && (
          <FeatureGate feature={FEATURES.HIRE_DEFENSIVE}>
          <div className="card">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
              Hire Units
            </h3>
            <p className="mb-4 text-xs text-text-muted">
              Burn NOVI to generate power, which is converted to units. Requires estate with Barracks (defensive) or Camp (operative).
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              {UNIT_TYPES.map((unit, i) => (
                <button
                  key={i}
                  onClick={() => setHireType(i)}
                  className={`rounded-lg border p-3 text-left transition-all ${
                    hireType === i
                      ? "border-amber-600 bg-amber-900/20"
                      : "border-zinc-800 hover:border-zinc-700"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-text-primary">{unit.label}</span>
                    <span className="text-xs text-text-muted">Tier {unit.tier}</span>
                  </div>
                  <div className="mt-1 text-xs text-text-muted">
                    Current: <GoldNumber value={player[unit.field]?.toNumber?.() ?? 0} size="sm" glow={false} />
                  </div>
                  <div className="flex items-center justify-between text-xs text-text-muted">
                    <span>Power: {unit.multiplier}x/unit</span>
                    <span className="text-amber-700">Req: {unit.building}</span>
                  </div>
                </button>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-4">
              <label className="text-sm text-text-muted">NOVI to spend:</label>
              <input
                type="number"
                value={hireNoviAmount}
                onChange={(e) => setHireNoviAmount(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-28 rounded-lg border border-zinc-800 bg-surface px-3 py-2 text-sm text-text-primary"
                min={1}
              />
              <TxButton onClick={handleHire}>
                Hire {UNIT_TYPES[hireType]?.label}
              </TxButton>
              <TxButton onClick={handleClaimAndHire} variant="secondary" className="text-xs">
                Claim NOVI &amp; Hire
              </TxButton>
            </div>
          </div>
          </FeatureGate>
        )}

        {/* Equipment Panel */}
        {activeTab === "equip" && player && (
          <FeatureGate feature={FEATURES.PURCHASE_EQUIPMENT}>
          <div className="card">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
              Purchase Equipment
            </h3>
            <p className="mb-4 text-xs text-text-muted">
              Buy equipment using locked NOVI or cash. Market building provides discounts.
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              {EQUIPMENT.map((eq, i) => (
                <button
                  key={i}
                  onClick={() => setEquipType(i)}
                  className={`rounded-lg border p-3 text-left transition-all ${
                    equipType === i
                      ? "border-amber-600 bg-amber-900/20"
                      : "border-zinc-800 hover:border-zinc-700"
                  }`}
                >
                  <div className="text-sm font-semibold text-text-primary">{eq.label}</div>
                  <div className="mt-1 text-xs text-text-muted">
                    Owned: <GoldNumber value={player[eq.field]?.toNumber?.() ?? 0} size="sm" glow={false} />
                  </div>
                </button>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-4">
              <label className="text-sm text-text-muted">Quantity:</label>
              <input
                type="number"
                value={equipAmount}
                onChange={(e) => setEquipAmount(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-24 rounded-lg border border-zinc-800 bg-surface px-3 py-2 text-sm text-text-primary"
                min={1}
              />
              <button
                onClick={() => setEquipPayCash(!equipPayCash)}
                className={`rounded-lg px-3 py-2 text-xs transition-colors ${
                  equipPayCash ? "bg-green-900/30 text-green-400" : "bg-amber-900/30 text-text-gold"
                }`}
              >
                {equipPayCash ? "Pay: Cash" : "Pay: NOVI"}
              </button>
              <TxButton onClick={handlePurchaseEquipment}>
                Buy {equipAmount} {EQUIPMENT[equipType]?.label}
              </TxButton>
              {!equipPayCash && (
                <TxButton onClick={handleClaimAndEquip} variant="secondary" className="text-xs">
                  Claim NOVI &amp; Buy
                </TxButton>
              )}
            </div>
          </div>
          </FeatureGate>
        )}

        {/* Collect Resources Panel */}
        {activeTab === "collect" && player && (
          <FeatureGate feature={FEATURES.COLLECT_CASH}>
          <div className="card">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
              Collect Resources
            </h3>
            <p className="mb-4 text-xs text-text-muted">
              Operatives collect resources by consuming NOVI. Collection type determines what you receive.
            </p>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
              {COLLECTION_TYPES.map((ct) => (
                <button
                  key={ct.value}
                  onClick={() => setCollectType(ct.value)}
                  className={`rounded-lg border p-3 text-left transition-all ${
                    collectType === ct.value
                      ? "border-amber-600 bg-amber-900/20"
                      : "border-zinc-800 hover:border-zinc-700"
                  }`}
                >
                  <div className="text-sm font-semibold text-text-primary">{ct.label}</div>
                </button>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-4">
              <label className="text-sm text-text-muted">NOVI to spend:</label>
              <input
                type="number"
                value={collectNoviAmount}
                onChange={(e) => setCollectNoviAmount(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-28 rounded-lg border border-zinc-800 bg-surface px-3 py-2 text-sm text-text-primary"
                min={1}
              />
              <TxButton onClick={handleCollect}>
                Collect {COLLECTION_TYPES[collectType]?.label}
              </TxButton>
              <TxButton onClick={handleClaimAndCollect} variant="secondary" className="text-xs">
                Claim NOVI &amp; Collect
              </TxButton>
            </div>
          </div>
          </FeatureGate>
        )}

        {/* Stamina Panel — no gate (always allowed) */}
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
              <div className="text-[11px] text-text-muted">
                Encounter costs: Common 10 · Uncommon 25 · Rare 50 · Epic 100 · Legendary 250
              </div>
            </div>
            <div className="flex items-center gap-4">
              <TxButton onClick={handlePurchaseStamina}>Buy 10 Stamina</TxButton>
              <TxButton onClick={handleClaimAndStamina} variant="secondary" className="text-xs">
                Claim NOVI &amp; Buy Stamina
              </TxButton>
            </div>
          </div>
        )}

        {/* Vault Transfer Panel */}
        {activeTab === "transfer" && player && (
          <FeatureGate feature={FEATURES.VAULT_TRANSFER}>
          <div className="card">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
              Vault Transfer
            </h3>
            <p className="mb-4 text-xs text-text-muted">
              Vault provides 75% protection during PvP attacks. Requires estate with Vault building.
            </p>
            <div className="flex gap-2 mb-4">
              <button
                onClick={() => setVaultDirection("deposit")}
                className={`rounded-lg px-3 py-2 text-sm ${
                  vaultDirection === "deposit"
                    ? "bg-amber-900/30 text-text-gold"
                    : "text-text-muted"
                }`}
              >
                Hand → Vault
              </button>
              <button
                onClick={() => setVaultDirection("withdraw")}
                className={`rounded-lg px-3 py-2 text-sm ${
                  vaultDirection === "withdraw"
                    ? "bg-amber-900/30 text-text-gold"
                    : "text-text-muted"
                }`}
              >
                Vault → Hand
              </button>
            </div>
            <div className="flex items-center gap-4">
              <input
                type="number"
                value={vaultAmount}
                onChange={(e) => setVaultAmount(Math.max(0, parseInt(e.target.value) || 0))}
                className="w-32 rounded-lg border border-zinc-800 bg-surface px-3 py-2 text-sm text-text-primary"
                placeholder="Amount"
              />
              <TxButton
                onClick={handleVaultTransfer}
                disabled={vaultAmount <= 0 || !!vaultValidation}
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
    </PageTransition>
  );
}
