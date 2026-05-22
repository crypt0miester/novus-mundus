"use client";

import { useMemo } from "react";
import { PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  createAttackPlayerInstruction,
  isTraveling,
  calculateDistanceMeters,
  calculateDefensivePower,
  calculateDamageOutput,
  getTotalDefensiveUnits,
  getTotalOperativeUnits,
} from "novus-mundus-sdk";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useCityPlayers } from "@/lib/hooks/useCityPlayers";
import { useTransact } from "@/lib/hooks/useTransact";
import { useCombatOutcome } from "@/lib/store/combat-outcome";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useDomainNames } from "@/lib/hooks/useDomainNames";
import { GoldNumber } from "@/components/shared/GoldNumber";
import { GameIcon } from "@/components/shared/GameIcon";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { useMorphActions } from "@/lib/hooks/useMorphActions";
import type { PanelAction } from "@/lib/store/right-panel";
import { UnitGrid } from "@/components/shared/UnitGrid";
import { TargetTravel } from "@/components/panels/TargetTravel";
import { shortenAddress } from "@/lib/utils";

// Mirrors the program's PVP_ATTACK_RANGE_METERS (attack_player.rs) — the
// program enforces this constant, not GameEngine.combatConfig, so the panel
// must too or the proximity grid will offer cells the chain rejects.
const PVP_RANGE = 15;

/**
 * The PvP target detail — opened in the RightPanel from the combat tab's
 * player list. Self-derives off the target's pubkey: distance, the target's
 * forces, and the attack / travel actions. The list only has to `show()` it.
 */
export function PvpDetailPanel({ playerPubkey }: { playerPubkey: string }) {
  const { publicKey } = useWallet();
  const client = useNovusMundusClient();
  const transact = useTransact();
  const { data: playerData } = usePlayer();
  const player = playerData?.account;
  const { data: cityPlayers } = useCityPlayers(player?.currentCity);

  const targetKey = useMemo(() => {
    try {
      return new PublicKey(playerPubkey);
    } catch {
      return null;
    }
  }, [playerPubkey]);

  const target = useMemo(
    () => (cityPlayers ?? []).find((p) => p.pubkey.toBase58() === playerPubkey) ?? null,
    [cityPlayers, playerPubkey],
  );

  const ownerList = useMemo(() => (target ? [target.account.owner] : []), [target]);
  const domainNames = useDomainNames(ownerList);

  const pvpRange = PVP_RANGE;
  const playerTraveling = player ? isTraveling(player) : false;

  const dist = useMemo(() => {
    if (!player || !target) return null;
    const d = calculateDistanceMeters(
      player.currentLat,
      player.currentLong,
      target.account.currentLat,
      target.account.currentLong,
    );
    return { distance: d, inRange: d <= pvpRange };
  }, [player, target, pvpRange]);

  const estimatedDamage = useMemo(() => {
    if (!player) return null;
    const defUnits = getTotalDefensiveUnits(player).toNumber();
    const offUnits = getTotalOperativeUnits(player).toNumber();
    const weapons =
      (player.meleeWeapons?.toNumber?.() ?? 0) +
      (player.rangedWeapons?.toNumber?.() ?? 0) +
      (player.siegeWeapons?.toNumber?.() ?? 0);
    try {
      return calculateDamageOutput(defUnits + offUnits, weapons, false);
    } catch {
      return null;
    }
  }, [player]);

  // ── Handlers ──

  // A standard strike, or an Overrun — a 10k+ host committing to one
  // overwhelming charge for a √φ (~1.27×) damage bonus (logic/combat.rs).
  const handleAttack = async (
    overrun: boolean,
    reportPhase: (p: TxPhase) => void,
    prepend: TransactionInstruction[] = [],
  ) => {
    if (!publicKey || !player || !target || !targetKey) throw new Error("No target");
    const ix = createAttackPlayerInstruction(
      {
        attacker: publicKey,
        gameEngine: client.gameEngine,
        defenderPlayer: targetKey,
        attackerCityId: player.currentCity,
        defenderCityId: target.account.currentCity,
      },
      { driveBy: overrun },
    );
    return transact
      .mutateAsync({
        instructions: [...prepend, ix],
        invalidateKeys: [["player"], ["cityPlayers"]],
        successMessage: overrun ? "Overrun launched!" : "Attack executed!",
        onPhase: reportPhase,
      })
      .then((r) => {
        useCombatOutcome
          .getState()
          .show(r.events, (reportPhase) => handleAttack(overrun, reportPhase));
        return r.signature;
      });
  };

  if (!target || !dist || !player) {
    return <p className="text-sm text-text-muted">This player is no longer in your city.</p>;
  }

  const targetName =
    target.account.name ||
    domainNames.get(target.account.owner.toBase58()) ||
    shortenAddress(target.account.owner.toBase58());

  // Overrun grants its bonus only with a 10k+ host (logic/combat.rs).
  const attackerUnits = getTotalDefensiveUnits(player).toNumber();
  const canOverrun = attackerUnits >= 10000;

  const targetDef = calculateDefensivePower(
    target.account.defensiveUnit1.toNumber(),
    target.account.defensiveUnit2.toNumber(),
    target.account.defensiveUnit3.toNumber(),
  );
  const targetOps =
    target.account.operativeUnit1.toNumber() +
    target.account.operativeUnit2.toNumber() +
    target.account.operativeUnit3.toNumber();

  const morphActions: PanelAction[] | null = playerTraveling
    ? null
    : [
        {
          id: "attack-player",
          label: "Attack Player",
          variant: "danger" as const,
          disabled: !dist.inRange,
          onClick: (rp) => handleAttack(false, rp),
        },
        {
          id: "overrun",
          label: canOverrun ? "Overrun (+27%)" : "Overrun (10k+)",
          disabled: !dist.inRange || !canOverrun,
          onClick: (rp) => handleAttack(true, rp),
        },
      ];
  useMorphActions(morphActions);

  return (
    <div className="space-y-4">
      {/* Target header */}
      <div className="text-center">
        <div className="text-lg font-bold text-text-primary">{targetName}</div>
        <div className="text-xs text-text-muted">Level {target.account.level}</div>
      </div>

      {/* Target stats */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-surface/60 px-3 py-2 text-center">
          <div className="text-[10px] text-text-muted">Net Worth</div>
          <GoldNumber value={target.account.networth.toNumber()} size="sm" />
        </div>
        <div className="rounded-lg bg-surface/60 px-3 py-2 text-center">
          <div className="text-[10px] text-text-muted">Cash on Hand</div>
          <span className="inline-flex items-center gap-1">
            <GameIcon id="resource-cash" size={14} />
            <GoldNumber value={target.account.cashOnHand.toNumber()} size="sm" />
          </span>
        </div>
      </div>

      {/* Target units */}
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-2">
          Target Forces
        </div>
        <UnitGrid
          defense={[
            target.account.defensiveUnit1.toNumber(),
            target.account.defensiveUnit2.toNumber(),
            target.account.defensiveUnit3.toNumber(),
          ]}
          offense={[
            target.account.operativeUnit1.toNumber(),
            target.account.operativeUnit2.toNumber(),
            target.account.operativeUnit3.toNumber(),
          ]}
        />
      </div>

      {/* Distance */}
      <div className="rounded-lg bg-surface/60 px-3 py-2 text-center">
        <div className="text-[10px] text-text-muted">Distance</div>
        <div
          className={`font-mono text-sm font-bold ${dist.inRange ? "text-green-400" : "text-red-400"}`}
        >
          {dist.distance.toFixed(1)}m
        </div>
      </div>

      {/* Range status */}
      {dist.inRange ? (
        <div className="rounded-lg border border-green-800/50 bg-green-900/10 p-3 text-center">
          <div className="text-xs font-semibold text-green-400">Target in range</div>
          <div className="text-[10px] text-green-600">
            {dist.distance.toFixed(1)}m / {pvpRange}m max
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-red-800/50 bg-red-900/10 p-3 text-center">
          <div className="text-xs font-semibold text-red-400">Out of range</div>
          <div className="text-[10px] text-red-600">
            {dist.distance.toFixed(1)}m away (max {pvpRange}m)
          </div>
        </div>
      )}

      <TargetTravel
        targetLat={target.account.currentLat}
        targetLong={target.account.currentLong}
        range={pvpRange}
        inRange={dist.inRange}
        onArriveAttack={(rp, prepend) => handleAttack(false, rp, prepend)}
      />

      {/* Operative exposure hint */}
      {targetOps > 0 &&
        (targetDef === 0 || (estimatedDamage != null && estimatedDamage > targetDef * 2)) && (
          <div className="rounded border border-red-800/30 bg-red-900/10 px-3 py-2 text-xs text-red-300">
            {targetDef === 0
              ? `Garrison empty — ${targetOps.toLocaleString()} operatives take full damage`
              : `Garrison may break — ${targetOps.toLocaleString()} ops exposed`}
          </div>
        )}

      {!playerTraveling && (
        <div className="hidden space-y-2 lg:block">
          <TxButton
            onClick={(rp) => handleAttack(false, rp)}
            variant="danger"
            className="w-full py-3 text-base font-bold"
            disabled={!dist.inRange}
          >
            Attack Player
          </TxButton>
          <TxButton
            onClick={(rp) => handleAttack(true, rp)}
            variant="secondary"
            disabled={!dist.inRange || !canOverrun}
            className="w-full py-2.5"
          >
            <span className="flex flex-col items-center gap-0.5">
              <span className="text-sm font-bold">Overrun</span>
              <span className="text-[10px] font-normal text-text-muted">
                {canOverrun ? "10k+ host · +27% damage" : "Requires a 10,000+ host"}
              </span>
            </span>
          </TxButton>
        </div>
      )}
    </div>
  );
}
