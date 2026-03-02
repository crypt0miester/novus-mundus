"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useGameEngine } from "@/lib/hooks/useGameEngine";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useWallet } from "@solana/wallet-adapter-react";
import { GoldNumber } from "@/components/shared/GoldNumber";
import { TxButton } from "@/components/shared/TxButton";
import { StatBar } from "@/components/shared/StatBar";
import type { TxPhase } from "@/components/shared/TxButton";
import { FeatureGate } from "@/components/shared/FeatureGate";
import { FEATURES, useFeatureGate } from "@/lib/hooks/useFeatureGate";
import { NoviGenerator } from "@/components/shared/NoviGenerator";
import {
  createHireUnitsInstruction,
  createPurchaseEquipmentInstruction,
  createPurchaseStaminaInstruction,
  createCollectResourcesInstruction,
  createVaultTransferInstruction,
  createUpdateLockedNoviInstruction,
} from "@/lib/sdk";

const UNIT_TYPES = [
  { label: "Infantry", tier: 1, multiplier: 1, field: "defensiveUnit1" as const, building: "Barracks", group: "Defensive" },
  { label: "Cavalry", tier: 2, multiplier: 4, field: "defensiveUnit2" as const, building: "Barracks", group: "Defensive" },
  { label: "Siege", tier: 3, multiplier: 16, field: "defensiveUnit3" as const, building: "Barracks", group: "Defensive" },
  { label: "Laborer", tier: 1, multiplier: 1, field: "operativeUnit1" as const, building: "Camp", group: "Operative" },
  { label: "Artisan", tier: 2, multiplier: 4, field: "operativeUnit2" as const, building: "Camp", group: "Operative" },
  { label: "Engineer", tier: 3, multiplier: 16, field: "operativeUnit3" as const, building: "Camp", group: "Operative" },
];

const EQUIPMENT = [
  { label: "Melee Weapons", field: "meleeWeapons" as const },
  { label: "Ranged Weapons", field: "rangedWeapons" as const },
  { label: "Siege Weapons", field: "siegeWeapons" as const },
  { label: "Armor Pieces", field: "armorPieces" as const },
];

const COLLECTION_TYPES = [
  { label: "Cash Collection", shortLabel: "Cash", value: 0, icon: "$", produces: "Cash on Hand", units: "Operative", color: "amber" as const, desc: "Convert NOVI into cash via your operative workforce", feature: FEATURES.COLLECT_CASH },
  { label: "Gem Mining", shortLabel: "Mining", value: 1, icon: "\u2726", produces: "Gems + Fragments", units: "Operative", color: "purple" as const, desc: "Mine precious gems from deep underground veins", feature: FEATURES.COLLECT_MINING },
  { label: "Fishing", shortLabel: "Fishing", value: 2, icon: "~", produces: "Produce + Fragments", units: "Operative", color: "cyan" as const, desc: "Harvest the waters for food to sustain your forces", feature: FEATURES.COLLECT_FISHING },
  { label: "Farming", shortLabel: "Farming", value: 3, icon: "\u2698", produces: "Produce + Fragments", units: "Operative", color: "green" as const, desc: "Tend the land with your operative units to grow food", feature: FEATURES.COLLECT_FARMING },
];

const COLOR_MAP = {
  amber:  { border: "border-amber-600",  bg: "bg-amber-900/20",  ring: "ring-amber-600/30",  icon: "text-amber-400",  iconBg: "bg-amber-900/40",  glow: "shadow-amber-900/20",  stat: "text-amber-400",  badge: "bg-amber-900/30 text-amber-400" },
  purple: { border: "border-purple-600", bg: "bg-purple-900/20", ring: "ring-purple-600/30", icon: "text-fuchsia-400", iconBg: "bg-purple-900/40", glow: "shadow-purple-900/20", stat: "text-fuchsia-400", badge: "bg-purple-900/30 text-fuchsia-400" },
  cyan:   { border: "border-cyan-600",   bg: "bg-cyan-900/20",   ring: "ring-cyan-600/30",   icon: "text-cyan-400",   iconBg: "bg-cyan-900/40",   glow: "shadow-cyan-900/20",   stat: "text-cyan-400",   badge: "bg-cyan-900/30 text-cyan-400" },
  green:  { border: "border-green-600",  bg: "bg-green-900/20",  ring: "ring-green-600/30",  icon: "text-green-400",  iconBg: "bg-green-900/40",  glow: "shadow-green-900/20",  stat: "text-green-400",  badge: "bg-green-900/30 text-green-400" },
} as const;

type MarketSection = "hire" | "equip" | "collect" | "stamina" | "vault";

const SECTIONS: { key: MarketSection; label: string }[] = [
  { key: "hire", label: "Hire" },
  { key: "equip", label: "Equip" },
  { key: "collect", label: "Collect" },
  { key: "stamina", label: "Stamina" },
  { key: "vault", label: "Vault" },
];

export function MarketTab() {
  const { data: playerData } = usePlayer();
  const { data: geData } = useGameEngine();
  const client = useNovusMundusClient();
  const { publicKey } = useWallet();
  const transact = useTransact();

  const player = playerData?.account;
  const [section, setSection] = useState<MarketSection>("hire");
  const [hireNoviAmount, setHireNoviAmount] = useState(100);
  const [hireType, setHireType] = useState<number>(0);
  const [equipType, setEquipType] = useState<number>(0);
  const [equipAmount, setEquipAmount] = useState(1);
  const [equipPayCash, setEquipPayCash] = useState(false);
  const [collectType, setCollectType] = useState(0);
  const [collectNoviAmount, setCollectNoviAmount] = useState(100);
  const [vaultAmount, setVaultAmount] = useState(0);
  const [vaultDirection, setVaultDirection] = useState<"deposit" | "withdraw">("deposit");

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

  const defensiveGate = useFeatureGate(FEATURES.HIRE_DEFENSIVE);
  const operativeGate = useFeatureGate(FEATURES.HIRE_OPERATIVE);
  const equipGate = useFeatureGate(FEATURES.PURCHASE_EQUIPMENT);

  const selectedUnit = UNIT_TYPES[hireType] ?? null;
  const selectedEquip = EQUIPMENT[equipType] ?? null;
  const selectedUnitGate = selectedUnit?.group === "Operative" ? operativeGate : defensiveGate;

  if (!player) return null;

  const noviBalance = player.lockedNovi?.toNumber?.() ?? 0;
  const cashBalance = player.cashOnHand?.toNumber?.() ?? 0;

  return (
    <div className="space-y-4">
      {/* NOVI Generator */}
      <NoviGenerator compact />

      {/* Section toggle */}
      <div className="-mx-4 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="flex gap-1 rounded-lg bg-surface p-1">
          {SECTIONS.map((s) => (
            <button
              key={s.key}
              onClick={() => setSection(s.key)}
              className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                section === s.key ? "bg-surface-raised text-text-gold" : "text-text-muted hover:text-text-secondary"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Hire Units ── */}
      {section === "hire" && (
        <div className="space-y-4">
          {(["Defensive", "Operative"] as const).map((group) => {
            const units = UNIT_TYPES.map((u, i) => ({ ...u, index: i })).filter((u) => u.group === group);
            const building = group === "Defensive" ? "Barracks" : "Camp";
            const gate = group === "Defensive" ? defensiveGate : operativeGate;
            const isLocked = !gate.allowed;
            return (
              <div key={group}>
                <div className="mb-2 flex items-baseline justify-between">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted">{group}</h4>
                  <span className="text-[10px] text-text-muted">Requires {building}</span>
                </div>
                {isLocked && gate.missing.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-2">
                    {gate.missing.map((m) => (
                      <Link key={m.label} href={m.href} className="rounded-md border border-amber-800/50 bg-amber-900/20 px-2.5 py-1 text-xs font-medium text-text-gold hover:bg-amber-900/40">
                        {m.label} &rarr;
                      </Link>
                    ))}
                  </div>
                )}
                <div className="grid gap-2 grid-cols-3">
                  {units.map((unit) => {
                    const count = player[unit.field]?.toNumber?.() ?? 0;
                    const isSelected = hireType === unit.index;
                    return (
                      <button
                        key={unit.label}
                        onClick={() => !isLocked && setHireType(unit.index)}
                        disabled={isLocked}
                        className={`rounded-lg border p-3 text-left transition-all ${
                          isLocked
                            ? "cursor-not-allowed border-zinc-800/50 opacity-50"
                            : isSelected
                              ? "border-amber-600 bg-amber-900/20 ring-1 ring-amber-600/30"
                              : "border-zinc-800 hover:border-zinc-700"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className={`text-sm font-semibold ${isLocked ? "text-zinc-600" : "text-text-primary"}`}>{unit.label}</span>
                          <span className="text-[10px] text-text-muted">{unit.multiplier}x</span>
                        </div>
                        <div className="mt-1 text-xs font-mono tabular-nums">
                          {isLocked ? <span className="text-zinc-600">Locked</span> : <GoldNumber value={count} size="sm" glow={false} />}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* Inline hire controls */}
          {selectedUnit && selectedUnitGate.allowed && (
            <div className="card">
              <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
                Hire {selectedUnit.label}
              </h4>
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-500">Your NOVI</span>
                  <span className="font-mono tabular-nums text-text-gold">{noviBalance.toLocaleString()}</span>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-text-muted">NOVI to spend</label>
                  <input
                    type="number"
                    value={hireNoviAmount}
                    onChange={(e) => setHireNoviAmount(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-full rounded-lg border border-zinc-800 bg-surface px-3 py-2 text-sm font-mono text-text-primary tabular-nums"
                    min={1}
                  />
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <TxButton onClick={handleHire} className="flex-1" disabled={noviBalance < hireNoviAmount}>
                    {noviBalance >= hireNoviAmount ? `Hire ${selectedUnit.label}` : "Insufficient NOVI"}
                  </TxButton>
                  <TxButton onClick={handleClaimAndHire} variant="secondary" className="flex-1 text-xs">
                    Claim NOVI &amp; Hire
                  </TxButton>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Equipment ── */}
      {section === "equip" && (
        <div className="space-y-4">
          <div className="mb-2 text-xs text-text-muted">
            Buy equipment using locked NOVI or cash. Market building provides discounts.
          </div>
          {!equipGate.allowed && equipGate.missing.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {equipGate.missing.map((m) => (
                <Link key={m.label} href={m.href} className="rounded-md border border-amber-800/50 bg-amber-900/20 px-2.5 py-1 text-xs font-medium text-text-gold hover:bg-amber-900/40">
                  {m.label} &rarr;
                </Link>
              ))}
            </div>
          )}
          <div className="grid gap-2 grid-cols-2">
            {EQUIPMENT.map((eq, i) => {
              const owned = player[eq.field]?.toNumber?.() ?? 0;
              const isSelected = equipType === i;
              const isLocked = !equipGate.allowed;
              return (
                <button
                  key={eq.label}
                  onClick={() => !isLocked && setEquipType(i)}
                  disabled={isLocked}
                  className={`rounded-lg border p-3 text-left transition-all ${
                    isLocked
                      ? "cursor-not-allowed border-zinc-800/50 opacity-50"
                      : isSelected
                        ? "border-amber-600 bg-amber-900/20 ring-1 ring-amber-600/30"
                        : "border-zinc-800 hover:border-zinc-700"
                  }`}
                >
                  <div className={`text-sm font-semibold ${isLocked ? "text-zinc-600" : "text-text-primary"}`}>{eq.label}</div>
                  <div className="mt-1 text-xs text-text-muted">
                    {isLocked ? <span className="text-zinc-600">Locked</span> : <>Owned: <GoldNumber value={owned} size="sm" glow={false} /></>}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Inline equip controls */}
          {selectedEquip && equipGate.allowed && (
            <div className="card">
              <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
                Buy {selectedEquip.label}
              </h4>
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-500">Your {equipPayCash ? "Cash" : "NOVI"}</span>
                  <span className="font-mono tabular-nums text-text-gold">
                    {(equipPayCash ? cashBalance : noviBalance).toLocaleString()}
                  </span>
                </div>
                <button
                  onClick={() => setEquipPayCash(!equipPayCash)}
                  className={`w-full rounded-lg px-3 py-2 text-xs transition-colors ${
                    equipPayCash ? "bg-green-900/30 text-green-400" : "bg-amber-900/30 text-text-gold"
                  }`}
                >
                  {equipPayCash ? "Pay with: Cash" : "Pay with: NOVI"}
                </button>
                <div>
                  <label className="mb-1 block text-xs text-text-muted">Quantity</label>
                  <input
                    type="number"
                    value={equipAmount}
                    onChange={(e) => setEquipAmount(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-full rounded-lg border border-zinc-800 bg-surface px-3 py-2 text-sm font-mono text-text-primary tabular-nums"
                    min={1}
                  />
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <TxButton onClick={handlePurchaseEquipment} className="flex-1">
                    Buy {equipAmount} {selectedEquip.label}
                  </TxButton>
                  {!equipPayCash && (
                    <TxButton onClick={handleClaimAndEquip} variant="secondary" className="flex-1 text-xs">
                      Claim NOVI &amp; Buy
                    </TxButton>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Collect Resources ── */}
      {section === "collect" && (
        <CollectSection
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
      {section === "stamina" && (
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
              Common 10 &middot; Uncommon 25 &middot; Rare 50 &middot; Epic 100 &middot; Legendary 250
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

      {/* ── Vault ── */}
      {section === "vault" && (
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
                  vaultDirection === "deposit" ? "bg-amber-900/30 text-text-gold" : "text-text-muted"
                }`}
              >
                Hand &rarr; Vault
              </button>
              <button
                onClick={() => setVaultDirection("withdraw")}
                className={`flex-1 rounded-lg px-3 py-2 text-sm sm:flex-none ${
                  vaultDirection === "withdraw" ? "bg-amber-900/30 text-text-gold" : "text-text-muted"
                }`}
              >
                Vault &rarr; Hand
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
    </div>
  );
}

// ─── Collect Resources Section ────────────────────────────────

function CollectSection({
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
  const unitCount = operativeTotal;

  const noviBalance = player.lockedNovi?.toNumber?.() ?? 0;
  const hasEnough = noviBalance >= collectNoviAmount;

  return (
    <FeatureGate feature={FEATURES.COLLECT_CASH}>
      <div className="space-y-4">
        <div className="mb-2 text-xs text-text-muted">
          Burn NOVI via your operative workforce to collect resources. Requires specific estate buildings.
        </div>
        <div className="grid gap-2 grid-cols-2">
          {COLLECTION_TYPES.map((ct, i) => {
            const gate = gates[i]!;
            const clr = COLOR_MAP[ct.color];
            const isSelected = collectType === ct.value;
            const isLocked = !gate.allowed;
            const res = resourceAmounts[ct.value]!;

            return (
              <button
                key={ct.value}
                onClick={() => { if (!isLocked) setCollectType(ct.value); }}
                disabled={isLocked}
                className={`group relative rounded-lg border p-3 text-left transition-all ${
                  isLocked
                    ? "cursor-not-allowed border-zinc-800/50 opacity-50"
                    : isSelected
                      ? `${clr.border} ${clr.bg} ring-1 ${clr.ring}`
                      : "border-zinc-800 hover:border-zinc-700"
                }`}
              >
                <div className="flex items-center gap-2">
                  <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-base ${isLocked ? "bg-zinc-800 text-zinc-600" : `${clr.iconBg} ${clr.icon}`}`}>
                    {isLocked ? "\uD83D\uDD12" : ct.icon}
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
                  <div className="mt-2 flex items-baseline justify-between">
                    <span className="text-[10px] text-text-muted">{res.label}</span>
                    <span className={`font-mono text-sm font-bold tabular-nums ${clr.stat}`}>
                      {res.current.toLocaleString()}
                    </span>
                  </div>
                )}
                {isLocked && gate.missing.length > 0 && (
                  <div className="mt-1 text-[10px] text-zinc-600">{gate.missing[0]!.label}</div>
                )}
              </button>
            );
          })}
        </div>

        {/* Inline collect controls */}
        {selectedGate.allowed && (
          <div className="card">
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
              {selected.label}
            </h4>
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-500">Your NOVI</span>
                <span className={`font-mono tabular-nums ${hasEnough ? "text-text-gold" : "text-red-400"}`}>
                  {noviBalance.toLocaleString()}
                </span>
              </div>
              <div className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold ${c.badge}`}>
                Operative Units: {unitCount.toLocaleString()}
              </div>
              {unitCount === 0 && (
                <div className="rounded-lg bg-red-900/20 px-2.5 py-1.5 text-xs font-semibold text-red-400">
                  No operative units
                </div>
              )}
              <div>
                <label className="mb-1 block text-xs text-text-muted">NOVI to spend</label>
                <input
                  type="number"
                  value={collectNoviAmount}
                  onChange={(e) => setCollectNoviAmount(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-full rounded-lg border border-zinc-800 bg-surface px-3 py-2 text-sm font-mono text-text-primary tabular-nums"
                  min={1}
                />
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <TxButton
                  onClick={onCollect}
                  disabled={unitCount === 0 || !hasEnough}
                  className="flex-1"
                >
                  {hasEnough ? `Collect ${selected.shortLabel}` : "Insufficient NOVI"}
                </TxButton>
                <TxButton
                  onClick={onClaimAndCollect}
                  variant="secondary"
                  className="flex-1 text-xs"
                  disabled={unitCount === 0}
                >
                  Claim NOVI &amp; Collect
                </TxButton>
              </div>
            </div>
          </div>
        )}
      </div>
    </FeatureGate>
  );
}
