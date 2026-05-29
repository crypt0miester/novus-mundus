"use client";

import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import type { TransactionInstruction } from "@solana/web3.js";
import {
  toGrid,
  calculateDistanceMeters,
  isTraveling,
  hasArrived,
  TravelType,
} from "novus-mundus-sdk";
import {
  buildIntracityCancelIx,
  buildIntracityCompleteIx,
  buildIntracityStartIx,
  buildTravelSpeedupIxs,
} from "@/lib/chain/travel";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useGameEngine } from "@/lib/hooks/useGameEngine";
import { useNow } from "@/lib/hooks/useNow";
import { useMorphActions } from "@/lib/hooks/useMorphActions";
import { useTransact } from "@/lib/hooks/useTransact";
import type { PanelAction } from "@/lib/store/right-panel";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { GoldCountdown } from "@/components/shared/GoldCountdown";
import { SpeedupPanel, maxSpeedupCount } from "@/components/shared/SpeedupPanel";
import { ProximityGrid } from "@/components/shared/ProximityGrid";
import styles from "./TargetTravel.module.css";

/**
 * Shared travel block for the encounter / PvP target detail panels. Holds the
 * derived travel state, the intracity start/complete/cancel + speedup handlers,
 * and renders the out-of-range ProximityGrid plus the in-transit controls. The
 * two panels differ only in the target's coordinates and the attack range, so
 * those are passed in; everything else here is identical between them.
 */
export function TargetTravel({
  targetLat,
  targetLong,
  range,
  inRange,
  proximityDisabled = false,
  onArriveAttack,
}: {
  targetLat: number;
  targetLong: number;
  range: number;
  /** When already in range, the proximity grid is hidden. */
  inRange: boolean;
  proximityDisabled?: boolean;
  /**
   * Submits the host panel's attack with the passed instructions prepended,
   * as one transaction. When the player arrives intracity within strike
   * range, the travel block fires this with an `intracity_complete` prepended
   * so settling + attacking land together. Omit it to keep arrival as a plain
   * "Complete Travel" (e.g. when the panel can't attack — no stamina, level
   * gap).
   */
  onArriveAttack?: (
    reportPhase: (p: TxPhase) => void,
    prepend: TransactionInstruction[],
  ) => Promise<string>;
}) {
  const { publicKey } = useWallet();
  const client = useNovusMundusClient();
  const transact = useTransact();
  const { data: playerData } = usePlayer();
  const player = playerData?.account;
  const { data: geData } = useGameEngine();

  const playerTraveling = player ? isTraveling(player) : false;
  // Ticks each second while traveling so arrival registers on its own.
  const now = useNow(playerTraveling);
  const isIntracity = player?.travelType === TravelType.Intracity;
  const playerArrived = player ? hasArrived(player, now) : false;
  const travelRemaining =
    player && playerTraveling && !playerArrived
      ? Math.max(0, player.arrivalTime.toNumber() - now)
      : 0;

  // ── Handlers ──

  const handleTravelCloser = async (
    destLat: number,
    destLong: number,
    reportPhase: (p: TxPhase) => void,
  ) => {
    if (!publicKey || !player) throw new Error("Not ready");
    const ix = buildIntracityStartIx({
      owner: publicKey,
      gameEngine: client.gameEngine,
      gameAuthority: geData?.account?.authority,
      player,
      targetGridLat: toGrid(destLat),
      targetGridLong: toGrid(destLong),
    });
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"]],
        successMessage: "Traveling closer to target!",
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  const buildCompleteIx = () => {
    if (!publicKey || !player) throw new Error("Not ready");
    return buildIntracityCompleteIx({
      owner: publicKey,
      gameEngine: client.gameEngine,
      player,
    }).ix;
  };

  const handleIntracityComplete = async (reportPhase: (p: TxPhase) => void) => {
    return transact
      .mutateAsync({
        instructions: [buildCompleteIx()],
        invalidateKeys: [["player"]],
        successMessage: "Arrived at destination!",
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  const handleIntracityCancel = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !player) throw new Error("Not ready");
    const ix = buildIntracityCancelIx({
      owner: publicKey,
      gameEngine: client.gameEngine,
      player,
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
    count: number = 1,
  ) => {
    if (!publicKey) throw new Error("Wallet not connected");
    // Hold-to-charge packs `count` speedups into one tx; each reads the live timer.
    const n = Math.max(1, Math.floor(count));
    const instructions = buildTravelSpeedupIxs({
      owner: publicKey,
      gameEngine: client.gameEngine,
      tier: tier as 1 | 2,
      count: n,
    });
    return transact
      .mutateAsync({
        instructions,
        invalidateKeys: [["player"]],
        successMessage: n > 1 ? `Travel sped up ×${n}!` : "Travel sped up!",
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  // Whether the cell the player is walking toward sits within strike range —
  // distinct from `inRange`, which reflects the player's *current* position
  // (still the origin until intracity_complete settles them).
  const destInRange =
    !!player &&
    playerTraveling &&
    calculateDistanceMeters(player.travelingToLat, player.travelingToLong, targetLat, targetLong) <=
      range;
  // On arrival within range, fold the settle (intracity_complete) into the
  // host panel's attack so both land in a single transaction.
  const canArriveAttack = playerArrived && isIntracity && destInRange && !!onArriveAttack;
  const handleArriveAttack = (rp: (p: TxPhase) => void) => onArriveAttack!(rp, [buildCompleteIx()]);

  // Surface in-transit actions on the mobile morph bar (SpeedupPanel
  // tier cards are display-only there). Mutually exclusive with the
  // host panel's attack actions — each registers `null` when the other
  // is active, so only one morph slot is populated.
  const gemsPerMinute = geData?.account?.gameplayConfig?.gemCostPerMinuteSpeedup ?? 1;
  const gemBalance = player?.gems?.toNumber?.();

  // Hold-to-charge caps — how many speedup instructions one tx can usefully
  // hold per tier (timer-collapse ∧ gem affordability). Travel has 2 tiers:
  // T1 leaves 50% of time / 1x cost, T2 leaves 25% / 2x cost.
  const speedupTiers = [
    {
      tier: 1,
      label: "Hasten",
      description: "50% time reduction",
      maxCount: maxSpeedupCount({
        remainingSeconds: travelRemaining,
        timeMultiplier: 0.5,
        costMultiplier: 1,
        gemsPerMinute,
        gemBalance: gemBalance ?? 0,
      }),
    },
    {
      tier: 2,
      label: "Rush",
      description: "75% time reduction",
      maxCount: maxSpeedupCount({
        remainingSeconds: travelRemaining,
        timeMultiplier: 0.25,
        costMultiplier: 2,
        gemsPerMinute,
        gemBalance: gemBalance ?? 0,
      }),
    },
  ];

  let travelActions: PanelAction[] | null = null;
  if (playerTraveling && playerArrived) {
    // Arrived within range to one-tap "Attack" (settles + strikes in one tx).
    // Otherwise intracity still needs a tx to settle; intercity finishes on
    // the map.
    if (canArriveAttack) {
      travelActions = [
        {
          id: "arrive-attack",
          label: "Attack",
          variant: "primary",
          onClick: handleArriveAttack,
        },
      ];
    } else if (isIntracity) {
      travelActions = [
        {
          id: "complete-travel",
          label: "Complete Travel",
          variant: "primary",
          onClick: handleIntracityComplete,
        },
      ];
    }
  } else if (playerTraveling) {
    const acts: PanelAction[] = [
      {
        id: "hasten",
        label: "Hasten",
        variant: "primary",
        disabled: speedupTiers[0]?.maxCount === 0,
        onClick: (rp) => handleTravelSpeedup(1, rp),
        onHold: (rp, count) => handleTravelSpeedup(1, rp, count),
        holdMax: speedupTiers[0]?.maxCount,
      },
      {
        id: "rush",
        label: "Rush",
        disabled: speedupTiers[1]?.maxCount === 0,
        onClick: (rp) => handleTravelSpeedup(2, rp),
        onHold: (rp, count) => handleTravelSpeedup(2, rp, count),
        holdMax: speedupTiers[1]?.maxCount,
      },
    ];
    // Only intracity travel can be cancelled mid-route.
    if (isIntracity) {
      acts.push({
        id: "stop-travel",
        label: "Cancel",
        variant: "danger",
        onClick: handleIntracityCancel,
      });
    }
    travelActions = acts;
  }
  useMorphActions(travelActions);

  if (!player) return null;

  return (
    <>
      {!inRange && (
        <ProximityGrid
          targetLat={targetLat}
          targetLong={targetLong}
          playerLat={player.currentLat}
          playerLong={player.currentLong}
          cityId={player.currentCity}
          attackRange={range}
          onTravel={handleTravelCloser}
          disabled={playerTraveling || proximityDisabled}
        />
      )}
      {/* Travel controls — a parchment "map inset" so travel reads as the
          cartographer's view, matching the world map. */}
      {playerTraveling && (
        <div className="space-y-3">
          <div className={`${styles.inset} space-y-2`}>
            <div className="flex items-center justify-between">
              <span className={styles.label}>
                {isIntracity ? "Traveling within city" : "Traveling between cities"}
              </span>
              {playerArrived ? (
                <span className={styles.arrived}>Arrived</span>
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
            {isIntracity &&
              playerArrived &&
              (canArriveAttack ? (
                <TxButton onClick={handleArriveAttack} className="w-full text-xs">
                  Attack
                </TxButton>
              ) : (
                <TxButton onClick={handleIntracityComplete} className="w-full text-xs">
                  Complete Travel
                </TxButton>
              ))}
            {isIntracity && !playerArrived && (
              <TxButton
                onClick={handleIntracityCancel}
                variant="secondary"
                className="w-full text-xs"
              >
                Cancel Travel
              </TxButton>
            )}
            {!isIntracity && (
              <Link href="/map" className={styles.seal}>
                Walk the road
              </Link>
            )}
          </div>
          <SpeedupPanel
            visible={!playerArrived}
            remainingSeconds={travelRemaining}
            tiers={speedupTiers}
            onSpeedup={(tier, rp, count) => handleTravelSpeedup(tier, rp, count)}
            gemsPerMinute={geData?.account?.gameplayConfig?.gemCostPerMinuteSpeedup ?? 1}
            gemBalance={player.gems?.toNumber?.()}
            variant="parchment"
          />
        </div>
      )}
    </>
  );
}
