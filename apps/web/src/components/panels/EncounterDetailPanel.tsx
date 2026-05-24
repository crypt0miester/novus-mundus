"use client";

import { useMemo } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import type { TransactionInstruction } from "@solana/web3.js";
import {
  derivePlayerPda,
  deriveLootPda,
  deriveLocationPda,
  toGrid,
  createAttackEncounterInstruction,
  createPurchaseStaminaInstruction,
  isTraveling,
  getEncounterStaminaCost,
  calculateDistanceMeters,
  ENCOUNTER_ATTACK_RANGE_METERS,
} from "novus-mundus-sdk";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useMorphActions } from "@/lib/hooks/useMorphActions";
import { useGameEngine } from "@/lib/hooks/useGameEngine";
import { useEncounters } from "@/lib/hooks/useEncounters";
import { useStamina } from "@/lib/hooks/useStamina";
import { useTransact } from "@/lib/hooks/useTransact";
import { useCombatOutcome } from "@/lib/store/combat-outcome";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { StatBar } from "@/components/shared/StatBar";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { TargetTravel } from "@/components/panels/TargetTravel";

const RARITY_LABELS = ["Common", "Uncommon", "Rare", "Epic", "Legendary"];
const RARITY_COLORS = [
  "text-zinc-400",
  "text-green-400",
  "text-blue-400",
  "text-fuchsia-400",
  "text-gold-400",
];
const ENCOUNTER_RANGE = ENCOUNTER_ATTACK_RANGE_METERS;

/**
 * The encounter detail — opened in the RightPanel from the combat tab's
 * encounter list. Self-derives off the encounter pubkey: distance, level band,
 * stamina, and the attack / travel actions. The list only has to `show()` it.
 */
export function EncounterDetailPanel({ encounterPubkey }: { encounterPubkey: string }) {
  const { publicKey } = useWallet();
  const client = useNovusMundusClient();
  const transact = useTransact();
  const { data: playerData } = usePlayer();
  const player = playerData?.account;
  const { data: geData } = useGameEngine();
  const { data: encounterData } = useEncounters(player?.currentCity);

  const encounter = useMemo(
    () => (encounterData ?? []).find((e) => e.pubkey.toBase58() === encounterPubkey) ?? null,
    [encounterData, encounterPubkey],
  );

  const playerTraveling = player ? isTraveling(player) : false;

  const maxLevelDiff = geData?.account?.gameplayConfig?.maxEncounterLevelDiff ?? 30;

  const dist = useMemo(() => {
    if (!player || !encounter) return null;
    const d = calculateDistanceMeters(
      player.currentLat,
      player.currentLong,
      encounter.account.locationLat,
      encounter.account.locationLong,
    );
    return { distance: d, inRange: d <= ENCOUNTER_RANGE };
  }, [player, encounter]);

  const levelBand = useMemo(() => {
    if (!player || !encounter) return null;
    const diff = Math.abs((encounter.account.level ?? 0) - (player.level ?? 0));
    return { level: encounter.account.level ?? 0, diff, inBand: diff <= maxLevelDiff };
  }, [player, encounter, maxLevelDiff]);

  const staminaCost = encounter ? getEncounterStaminaCost(encounter.account.rarity ?? 0) : null;
  // Stamina regenerates over time; the on-chain field is only a snapshot.
  // useStamina applies the program's regen math so the panel agrees with the
  // stamina bar — and with what attack_encounter sees after it regenerates.
  const stamina = useStamina(player);
  const playerStamina = stamina.current;
  const hasStamina = staminaCost != null ? playerStamina >= staminaCost : true;

  // ── Handlers ──

  const handleAttack = async (
    reportPhase: (p: TxPhase) => void,
    prepend: TransactionInstruction[] = [],
  ) => {
    if (!publicKey || !player || !encounter) throw new Error("No target");
    const ge = client.gameEngine;
    const enc = encounter.account;
    const [playerPda] = derivePlayerPda(ge, publicKey);
    const [loot] = deriveLootPda(playerPda, player.lootCounter.toNumber());
    const [encounterLocation] = deriveLocationPda(
      ge,
      enc.cityId,
      toGrid(enc.locationLat),
      toGrid(enc.locationLong),
    );
    const locationCreatorRefund = geData?.account?.authority ?? publicKey;
    const ix = createAttackEncounterInstruction(
      {
        owner: publicKey,
        gameEngine: ge,
        encounter: encounter.pubkey,
        loot,
        encounterLocation,
        locationCreatorRefund,
      },
      { encounterId: enc.id.toNumber() },
    );
    const maxHealth = enc.maxHealth.toNumber();
    return transact
      .mutateAsync({
        instructions: [...prepend, ix],
        invalidateKeys: [["player"], ["encounters"], ["loot"]],
        successMessage: "Attack landed!",
        onPhase: reportPhase,
      })
      .then((r) => {
        useCombatOutcome.getState().show(r.events, handleAttack, { maxHealth });
        return r.signature;
      });
  };

  const handleStaminaAndAttack = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !player || !encounter) throw new Error("No target");
    const ge = client.gameEngine;
    const enc = encounter.account;
    const [playerPda] = derivePlayerPda(ge, publicKey);
    const [loot] = deriveLootPda(playerPda, player.lootCounter.toNumber());
    const [encounterLocation] = deriveLocationPda(
      ge,
      enc.cityId,
      toGrid(enc.locationLat),
      toGrid(enc.locationLong),
    );
    const locationCreatorRefund = geData?.account?.authority ?? publicKey;
    const staminaIx = createPurchaseStaminaInstruction(
      { gameEngine: ge, owner: publicKey },
      { amount: 1 },
    );
    const attackIx = createAttackEncounterInstruction(
      {
        owner: publicKey,
        gameEngine: ge,
        encounter: encounter.pubkey,
        loot,
        encounterLocation,
        locationCreatorRefund,
      },
      { encounterId: enc.id.toNumber() },
    );
    const maxHealth = enc.maxHealth.toNumber();
    return transact
      .mutateAsync({
        instructions: [staminaIx, attackIx],
        invalidateKeys: [["player"], ["encounters"], ["loot"]],
        successMessage: "Bought stamina & attacked!",
        onPhase: reportPhase,
      })
      .then((r) => {
        useCombatOutcome.getState().show(r.events, handleStaminaAndAttack, {
          maxHealth,
        });
        return r.signature;
      });
  };

  // Hook order: must run before the early return below.
  const morphActions =
    !encounter || !player || playerTraveling
      ? null
      : [
          {
            id: "attack",
            label: levelBand?.inBand === false ? "LEVEL GAP" : "Attack",
            variant: "primary" as const,
            disabled: !hasStamina || !dist?.inRange || levelBand?.inBand === false,
            onClick: handleAttack,
          },
          {
            id: "stamina-attack",
            label: "+Stamina & Attack",
            disabled: !dist?.inRange || levelBand?.inBand === false,
            onClick: handleStaminaAndAttack,
          },
        ];
  useMorphActions(morphActions);

  if (!encounter || !dist || !player) {
    return <p className="text-sm text-text-muted">This encounter is no longer available.</p>;
  }

  const rarity = encounter.account.rarity ?? 0;
  const hp = encounter.account.health.toNumber();
  const maxHp = encounter.account.maxHealth.toNumber();

  return (
    <div className="space-y-4">
      {/* Target header */}
      <div className="text-center">
        <div className={`text-lg font-bold ${RARITY_COLORS[rarity]}`}>
          {RARITY_LABELS[rarity]} Encounter
        </div>
        <div className="text-xs text-text-muted">#{encounter.account.id.toString()}</div>
      </div>

      {/* HP */}
      <div>
        <div className="flex justify-between text-xs text-text-muted mb-1">
          <span>Health</span>
          <span>
            {hp.toLocaleString()} / {maxHp.toLocaleString()}
          </span>
        </div>
        <StatBar current={hp} max={maxHp} color="health" showValues={false} />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg bg-surface/60 px-3 py-2 text-center">
          <div className="text-[10px] text-text-muted">Stamina Cost</div>
          <div
            className={`font-mono text-sm font-bold ${hasStamina ? "text-text-primary" : "text-red-400"}`}
          >
            {staminaCost ?? "—"}
          </div>
        </div>
        <div className="rounded-lg bg-surface/60 px-3 py-2 text-center">
          <div className="text-[10px] text-text-muted">Distance</div>
          <div
            className={`font-mono text-sm font-bold ${dist.inRange ? "text-green-400" : "text-red-400"}`}
          >
            {dist.distance.toFixed(1)}m
          </div>
        </div>
        <div className="rounded-lg bg-surface/60 px-3 py-2 text-center">
          <div className="text-[10px] text-text-muted">Level</div>
          <div
            className={`font-mono text-sm font-bold ${levelBand?.inBand === false ? "text-red-400" : "text-text-primary"}`}
          >
            {encounter.account.level}
          </div>
        </div>
      </div>

      {/* Level band — cannot be fixed by travelling */}
      {levelBand && !levelBand.inBand && (
        <div className="rounded-lg border border-red-800/50 bg-red-900/10 p-3 text-center">
          <div className="text-xs font-semibold text-red-400">Level gap too wide</div>
          <div className="text-[10px] text-red-600">
            Encounter Lv {levelBand.level} · you are Lv {player.level ?? 0} — {levelBand.diff}{" "}
            apart, max {maxLevelDiff}.
          </div>
        </div>
      )}

      {/* Range status */}
      {dist.inRange ? (
        <div className="rounded-lg border border-green-800/50 bg-green-900/10 p-3 text-center">
          <div className="text-xs font-semibold text-green-400">Target in range</div>
          <div className="text-[10px] text-green-600">
            {dist.distance.toFixed(1)}m / {ENCOUNTER_RANGE}m max
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-red-800/50 bg-red-900/10 p-3 text-center">
          <div className="text-xs font-semibold text-red-400">Out of range</div>
          <div className="text-[10px] text-red-600">
            {dist.distance.toFixed(1)}m away (max {ENCOUNTER_RANGE}m)
          </div>
        </div>
      )}

      <TargetTravel
        targetLat={encounter.account.locationLat}
        targetLong={encounter.account.locationLong}
        range={ENCOUNTER_RANGE}
        inRange={dist.inRange}
        proximityDisabled={levelBand?.inBand === false}
        onArriveAttack={hasStamina && levelBand?.inBand !== false ? handleAttack : undefined}
      />

      {/* Stamina warning */}
      {!hasStamina && !playerTraveling && (
        <div className="rounded-lg border border-red-800/50 bg-red-900/10 p-2 text-center text-xs text-red-400">
          Insufficient stamina ({playerStamina} / {staminaCost})
        </div>
      )}

      {!playerTraveling && (
        <div className="hidden space-y-2 lg:block">
          <TxButton
            onClick={handleAttack}
            className="w-full py-3 text-base font-bold"
            disabled={!hasStamina || !dist.inRange || levelBand?.inBand === false}
          >
            {levelBand?.inBand === false ? "LEVEL GAP TOO WIDE" : "ATTACK"}
          </TxButton>
          <TxButton
            onClick={handleStaminaAndAttack}
            variant="secondary"
            className="w-full text-xs"
            disabled={!dist.inRange || levelBand?.inBand === false}
          >
            Buy Stamina &amp; Attack
          </TxButton>
        </div>
      )}
    </div>
  );
}
