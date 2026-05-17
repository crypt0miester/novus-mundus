"use client";

import { useMemo } from "react";
import Link from "next/link";
import { PublicKey } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  deriveLocationPda,
  toGrid,
  createAttackPlayerInstruction,
  createIntracityStartInstruction,
  createIntracityCompleteInstruction,
  createIntracityCancelInstruction,
  createTravelSpeedupInstruction,
  isTraveling,
  hasArrived,
  calculateDistanceMeters,
  calculateDefensivePower,
  calculateDamageOutput,
  getTotalDefensiveUnits,
  getTotalOperativeUnits,
  TravelType,
} from "novus-mundus-sdk";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useGameEngine } from "@/lib/hooks/useGameEngine";
import { useCityPlayers } from "@/lib/hooks/useCityPlayers";
import { useNow } from "@/lib/hooks/useNow";
import { useTransact } from "@/lib/hooks/useTransact";
import { useCombatOutcome } from "@/lib/store/combat-outcome";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useDomainNames } from "@/lib/hooks/useDomainNames";
import { GoldNumber } from "@/components/shared/GoldNumber";
import { GoldCountdown } from "@/components/shared/GoldCountdown";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { UnitGrid } from "@/components/shared/UnitGrid";
import { SpeedupPanel } from "@/components/shared/SpeedupPanel";
import { ProximityGrid } from "@/components/shared/ProximityGrid";
import { shortenAddress } from "@/lib/utils";

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
  const { data: geData } = useGameEngine();
  const { data: cityPlayers } = useCityPlayers(player?.currentCity);

  const targetKey = useMemo(() => {
    try {
      return new PublicKey(playerPubkey);
    } catch {
      return null;
    }
  }, [playerPubkey]);

  const target = useMemo(
    () =>
      (cityPlayers ?? []).find((p) => p.pubkey.toBase58() === playerPubkey) ??
      null,
    [cityPlayers, playerPubkey],
  );

  const ownerList = useMemo(
    () => (target ? [target.account.owner] : []),
    [target],
  );
  const domainNames = useDomainNames(ownerList);

  const pvpRange = geData?.account?.combatConfig?.pvpAttackRangeMeters ?? 15;
  const playerTraveling = player ? isTraveling(player) : false;
  // Ticks each second while traveling so arrival registers on its own.
  const now = useNow(playerTraveling);
  const isIntracity = player?.travelType === TravelType.Intracity;
  const playerArrived = player ? hasArrived(player, now) : false;
  const travelRemaining =
    player && playerTraveling && !playerArrived
      ? Math.max(0, player.arrivalTime.toNumber() - now)
      : 0;

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
        instructions: [ix],
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

  const handleTravelCloser = async (
    targetLat: number,
    targetLong: number,
    reportPhase: (p: TxPhase) => void,
  ) => {
    if (!publicKey || !player) throw new Error("Not ready");
    const ge = client.gameEngine;
    const cityId = player.currentCity;
    const [originLocation] = deriveLocationPda(
      ge, cityId, toGrid(player.currentLat), toGrid(player.currentLong),
    );
    const [destinationLocation] = deriveLocationPda(
      ge, cityId, toGrid(targetLat), toGrid(targetLong),
    );
    const originCreatorRefund = geData?.account?.authority ?? publicKey;
    const ix = createIntracityStartInstruction(
      { owner: publicKey, gameEngine: ge, cityId, originLocation, destinationLocation, originCreatorRefund },
      { destinationLat: targetLat, destinationLong: targetLong },
    );
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"]],
        successMessage: "Traveling closer to target!",
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  const handleIntracityComplete = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !player) throw new Error("Not ready");
    const ge = client.gameEngine;
    const cityId = player.currentCity;
    const [destinationLocation] = deriveLocationPda(
      ge, cityId, toGrid(player.travelingToLat), toGrid(player.travelingToLong),
    );
    const ix = createIntracityCompleteInstruction({
      owner: publicKey, gameEngine: ge, cityId, destinationLocation,
    });
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"]],
        successMessage: "Arrived at destination!",
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  const handleIntracityCancel = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !player) throw new Error("Not ready");
    const ge = client.gameEngine;
    const cityId = player.currentCity;
    const [originLocation] = deriveLocationPda(
      ge, cityId, toGrid(player.currentLat), toGrid(player.currentLong),
    );
    const [destinationLocation] = deriveLocationPda(
      ge, cityId, toGrid(player.travelingToLat), toGrid(player.travelingToLong),
    );
    const destinationCreatorRefund = geData?.account?.authority ?? publicKey;
    const ix = createIntracityCancelInstruction({
      owner: publicKey, gameEngine: ge, cityId, originLocation, destinationLocation, destinationCreatorRefund,
    });
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"]],
        successMessage: "Travel cancelled!",
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  const handleTravelSpeedup = async (
    tier: number,
    reportPhase: (p: TxPhase) => void,
  ) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ix = createTravelSpeedupInstruction(
      { owner: publicKey, gameEngine: client.gameEngine },
      { speedupTier: tier as 1 | 2 },
    );
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"]],
        successMessage: "Travel sped up!",
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  if (!target || !dist || !player) {
    return (
      <p className="text-sm text-text-muted">
        This player is no longer in your city.
      </p>
    );
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

  return (
    <div className="space-y-4">
      {/* Target header */}
      <div className="text-center">
        <div className="text-lg font-bold text-text-primary">{targetName}</div>
        <div className="text-xs text-text-muted">
          Level {target.account.level}
        </div>
      </div>

      {/* Target stats */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-surface/60 px-3 py-2 text-center">
          <div className="text-[10px] text-text-muted">Net Worth</div>
          <GoldNumber value={target.account.networth.toNumber()} size="sm" />
        </div>
        <div className="rounded-lg bg-surface/60 px-3 py-2 text-center">
          <div className="text-[10px] text-text-muted">Cash on Hand</div>
          <GoldNumber value={target.account.cashOnHand.toNumber()} prefix="$" size="sm" />
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
        <div className={`font-mono text-sm font-bold ${dist.inRange ? "text-green-400" : "text-red-400"}`}>
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
        <div className="space-y-3">
          <div className="rounded-lg border border-red-800/50 bg-red-900/10 p-3 text-center">
            <div className="text-xs font-semibold text-red-400">Out of range</div>
            <div className="text-[10px] text-red-600">
              {dist.distance.toFixed(1)}m away (max {pvpRange}m)
            </div>
          </div>
          <ProximityGrid
            targetLat={target.account.currentLat}
            targetLong={target.account.currentLong}
            playerLat={player.currentLat}
            playerLong={player.currentLong}
            cityId={player.currentCity}
            attackRange={pvpRange}
            onTravel={handleTravelCloser}
            disabled={playerTraveling}
          />
        </div>
      )}

      {/* Operative exposure hint */}
      {targetOps > 0 &&
        (targetDef === 0 ||
          (estimatedDamage != null && estimatedDamage > targetDef * 2)) && (
          <div className="rounded border border-red-800/30 bg-red-900/10 px-3 py-2 text-xs text-red-300">
            {targetDef === 0
              ? `Garrison empty — ${targetOps.toLocaleString()} operatives take full damage`
              : `Garrison may break — ${targetOps.toLocaleString()} ops exposed`}
          </div>
        )}

      {/* Travel controls — shown when traveling */}
      {playerTraveling && (
        <div className="space-y-3">
          <div className="rounded-lg border border-amber-800/50 bg-amber-900/20 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-amber-300">
                {isIntracity ? "Traveling within city" : "Traveling between cities"}
              </span>
              {playerArrived ? (
                <span className="rounded-full bg-green-900/40 px-2 py-0.5 text-[10px] font-semibold text-green-400">
                  ARRIVED
                </span>
              ) : (
                <GoldCountdown
                  endsAt={player.arrivalTime.toNumber()}
                  startedAt={player.departureTime.toNumber()}
                  showProgress
                  format="compact"
                  size="sm"
                />
              )}
            </div>
            {isIntracity && playerArrived && (
              <TxButton onClick={handleIntracityComplete} className="w-full text-xs">
                Complete Travel
              </TxButton>
            )}
            {isIntracity && !playerArrived && (
              <TxButton onClick={handleIntracityCancel} variant="secondary" className="w-full text-xs">
                Cancel Travel
              </TxButton>
            )}
            {!isIntracity && (
              <Link
                href="/map"
                className="block rounded-md border border-amber-800/50 bg-amber-900/20 px-3 py-1.5 text-center text-xs font-medium text-text-gold hover:bg-amber-900/40"
              >
                Go to Travel
              </Link>
            )}
          </div>
          <SpeedupPanel
            visible={!playerArrived}
            remainingSeconds={travelRemaining}
            onSpeedup={handleTravelSpeedup}
            gemsPerMinute={geData?.account?.gameplayConfig?.gemCostPerMinuteSpeedup ?? 1}
            gemBalance={player.gems?.toNumber?.()}
          />
        </div>
      )}

      {/* Attack — a standard strike, or an Overrun. Hidden while traveling. */}
      {!playerTraveling && (
        <div className="space-y-2">
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
            className="flex w-full flex-col items-center gap-0.5 py-2.5"
          >
            <span className="text-sm font-bold">Overrun</span>
            <span className="text-[10px] font-normal text-text-muted">
              {canOverrun
                ? "10k+ host · +27% damage"
                : "Requires a 10,000+ host"}
            </span>
          </TxButton>
        </div>
      )}
    </div>
  );
}
