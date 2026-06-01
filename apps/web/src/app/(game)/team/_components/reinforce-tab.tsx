"use client";

import { useState, useMemo, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useTeam } from "@/lib/hooks/useTeam";
import { useLockedHeroes, NO_HERO_SLOT } from "@/lib/hooks/useLockedHeroes";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useWallet } from "@solana/wallet-adapter-react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useGameEngine } from "@/lib/hooks/useGameEngine";
import { GoldNumber } from "@/components/shared/GoldNumber";
import { GoldCountdown } from "@/components/shared/GoldCountdown";
import { SpeedupPanel, maxSpeedupCount } from "@/components/shared/SpeedupPanel";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { DomainName } from "@/components/shared/DomainName";
import { InfoButton } from "@/components/shared/InfoButton";
import { LabelWithInfo } from "@/components/shared/LabelWithInfo";
import { REINFORCEMENT_STATUS_INFO, REINFORCEMENT_RELIEVE_INFO } from "@/lib/copy/infoCopy";
import {
  TripleCountInput,
  DEFENSIVE_UNIT_LABELS,
  DEFENSIVE_UNIT_ICONS,
  WEAPON_LABELS,
  WEAPON_ICONS,
} from "@/components/shared/TripleCountInput";
import {
  derivePlayerPda,
  createSendReinforcementInstruction,
  createRecallReinforcementInstruction,
  createProcessArrivalInstruction,
  createRelieveReinforcementInstruction,
  createReinforcementSpeedupInstruction,
  parsePlayer,
  isNullPubkey,
  isTraveling,
  getCurrentTimeOfDay,
  getTimeOfDayName,
  type ReinforcementAccount,
} from "novus-mundus-sdk";

const REINFORCEMENT_STATUS_LABEL = ["Traveling", "Active", "Returning", "Completed"];

// In-flight reinforcement enriched with resolved owner wallets.
interface ReinforcementRow {
  pubkey: PublicKey;
  account: ReinforcementAccount;
  direction: "sent" | "received";
  senderWallet: PublicKey | null;
  destinationWallet: PublicKey | null;
}

interface ReinforceTabProps {
  /**
   * Hide the "Send Reinforcements" form. Forces view renders this for the
   * in-flight rollup but doesn't want the send form — sending now lives on
   * the EntityPanel via ReinforceComposerPanel.
   */
  hideComposer?: boolean;
}

export function ReinforceTab({ hideComposer = false }: ReinforceTabProps = {}) {
  const { data: playerData } = usePlayer();
  const player = playerData?.account;
  const { data: geData } = useGameEngine();
  const ge = geData?.account;
  const client = useNovusMundusClient();
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const transact = useTransact();
  const teamPubkey = player?.team && !isNullPubkey(player.team) ? player.team : null;
  const { data: teamData } = useTeam(teamPubkey);
  const teamId = teamData?.account?.id;
  const ownedUnits: [number, number, number] = [
    Number(player?.defensiveUnit1 ?? 0n),
    Number(player?.defensiveUnit2 ?? 0n),
    Number(player?.defensiveUnit3 ?? 0n),
  ];
  const ownedWeapons: [number, number, number] = [
    Number(player?.meleeWeapons ?? 0n),
    Number(player?.rangedWeapons ?? 0n),
    Number(player?.siegeWeapons ?? 0n),
  ];

  // Locked heroes (slots 0-2); one may optionally travel with the reinforcement.
  const [reinHeroSlot, setReinHeroSlot] = useState(NO_HERO_SLOT);
  const lockedHeroes = useLockedHeroes();

  const nowSec = Math.floor(Date.now() / 1000);
  const traveling = player ? isTraveling(player) : false;
  const tod = useMemo(() => getCurrentTimeOfDay(nowSec, 0), [nowSec]);
  const todName = getTimeOfDayName(tod);

  const [targetAddress, setTargetAddress] = useState("");
  const [reinUnits, setReinUnits] = useState<[number, number, number]>([0, 0, 0]);
  const [reinWeapons, setReinWeapons] = useState<[number, number, number]>([0, 0, 0]);

  // Allow deep-link from the team members panel: ?tab=reinforce&target=<wallet>
  // seeds the target on first mount only — manual edits aren't overwritten.
  const searchParams = useSearchParams();
  useEffect(() => {
    const t = searchParams.get("target");
    if (t) setTargetAddress(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // In-flight reinforcements — fetched both directions (sent + received).
  // The store only keeps a single reinforcement singleton, so the list of all
  // active/in-flight reinforcements is queried directly via the SDK client.
  const [reinforcements, setReinforcements] = useState<ReinforcementRow[]>([]);

  useEffect(() => {
    if (!publicKey) {
      setReinforcements([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const ge = client.gameEngine;
      const [myPlayerPda] = await derivePlayerPda(ge, publicKey);
      const [sent, received] = await Promise.all([
        client.fetchReinforcementsSent(myPlayerPda),
        client.fetchReinforcementsReceived(myPlayerPda),
      ]);
      const rows: {
        pubkey: PublicKey;
        account: ReinforcementAccount;
        direction: "sent" | "received";
      }[] = [
        ...sent.map((r) => ({ ...r, direction: "sent" as const })),
        ...received.map((r) => ({ ...r, direction: "received" as const })),
      ].filter((r) => r.account.status !== 3); // exclude Completed

      // Resolve sender/destination player PDAs to owner wallets.
      const pdaSet = new Set<string>();
      for (const r of rows) {
        pdaSet.add(r.account.sender.toBase58());
        pdaSet.add(r.account.destination.toBase58());
      }
      const pdaList = Array.from(pdaSet).map((s) => new PublicKey(s));
      const walletMap = new Map<string, PublicKey>();
      if (pdaList.length > 0) {
        const infos = await connection.getMultipleAccountsInfo(pdaList);
        for (let i = 0; i < infos.length; i++) {
          const info = infos[i];
          if (!info) continue;
          const parsed = parsePlayer(info);
          if (parsed) walletMap.set(pdaList[i].toBase58(), parsed.owner);
        }
      }
      if (cancelled) return;
      setReinforcements(
        rows.map((r) => ({
          pubkey: r.pubkey,
          account: r.account,
          direction: r.direction,
          senderWallet: walletMap.get(r.account.sender.toBase58()) ?? null,
          destinationWallet: walletMap.get(r.account.destination.toBase58()) ?? null,
        })),
      );
    })().catch(() => {
      if (!cancelled) setReinforcements([]);
    });
    return () => {
      cancelled = true;
    };
  }, [publicKey?.toBase58(), client, connection, transact.isPending]);

  const isValidAddress = useMemo(() => {
    if (!targetAddress.trim()) return false;
    try {
      new PublicKey(targetAddress.trim());
      return true;
    } catch {
      return false;
    }
  }, [targetAddress]);

  const handleSend = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !player) throw new Error("Wallet not connected");
    if (!isValidAddress) throw new Error("Enter a valid target address");
    if (!teamId) throw new Error("You must be on a team to send reinforcements");
    if (reinUnits.every((n) => n === 0) && reinWeapons.every((n) => n === 0)) {
      throw new Error("Choose units or weapons to send");
    }
    const ge = client.gameEngine;
    const targetPubkey = new PublicKey(targetAddress.trim());
    // The destination's current city is needed for the instruction — read it
    // from their on-chain player account.
    const [destPda] = await derivePlayerPda(ge, targetPubkey);
    const destInfo = await connection.getAccountInfo(destPda);
    const destPlayer = destInfo ? parsePlayer(destInfo) : null;
    if (!destPlayer) throw new Error("Target player not found");
    const hero = reinHeroSlot < 3 ? lockedHeroes[reinHeroSlot] : null;
    const ix = await createSendReinforcementInstruction(
      {
        sender: publicKey,
        gameEngine: ge,
        destinationOwner: targetPubkey,
        senderCityId: player.currentCity,
        destinationCityId: destPlayer.currentCity,
        teamId: Number(teamId),
        heroNft: hero?.mint,
      },
      {
        defensiveUnit1: reinUnits[0],
        defensiveUnit2: reinUnits[1],
        defensiveUnit3: reinUnits[2],
        meleeWeapons: reinWeapons[0],
        rangedWeapons: reinWeapons[1],
        siegeWeapons: reinWeapons[2],
        heroSlot: hero ? reinHeroSlot : NO_HERO_SLOT,
      },
    );
    const total = reinUnits.reduce((a, b) => a + b, 0);
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"]],
        successMessage: `Sent ${total.toLocaleString()} units in reinforcement!`,
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  // Recall a reinforcement the player sent.
  const handleRecall = async (row: ReinforcementRow, reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    if (!row.destinationWallet) throw new Error("Destination wallet unresolved");
    const ge = client.gameEngine;
    const ix = await createRecallReinforcementInstruction({
      sender: publicKey,
      gameEngine: ge,
      destinationOwner: row.destinationWallet,
      senderCityId: row.account.senderCity ?? 0,
      destinationCityId: row.account.destinationCity ?? 0,
    });
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"]],
        successMessage: "Reinforcements recalled!",
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  // Speed up the travel of a chosen reinforcement (sender pays gems).
  const handleReinforcementSpeedup = async (
    row: ReinforcementRow,
    tier: number,
    reportPhase: (p: TxPhase) => void,
    count: number = 1,
  ) => {
    if (!publicKey) throw new Error("Wallet not connected");
    if (!row.destinationWallet) throw new Error("Destination wallet unresolved");
    const geKey = client.gameEngine;
    const destinationOwner = row.destinationWallet;
    // Hold-to-charge packs `count` speedups into one tx; each reads the live
    // timer on-chain, so the leg (outbound or return) collapses step by step.
    const n = Math.max(1, Math.floor(count));
    const instructions = await Promise.all(
      Array.from({ length: n }, () =>
        createReinforcementSpeedupInstruction(
          { sender: publicKey, gameEngine: geKey, destinationOwner },
          { speedupTier: tier as 1 | 2 },
        ),
      ),
    );
    return transact
      .mutateAsync({
        instructions,
        invalidateKeys: [["player"]],
        successMessage: n > 1 ? `Reinforcement sped up ×${n}!` : "Reinforcement travel sped up!",
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  // Permissionless: process arrival of a traveling reinforcement.
  const handleProcessArrival = async (row: ReinforcementRow, reportPhase: (p: TxPhase) => void) => {
    const ix = await createProcessArrivalInstruction({
      reinforcement: row.pubkey,
      destinationPlayer: row.account.destination,
    });
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"]],
        successMessage: "Reinforcement arrival processed!",
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  // Destination relieves a reinforcement (sends it back home).
  const handleRelieve = async (row: ReinforcementRow, reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    if (!row.senderWallet) throw new Error("Sender wallet unresolved");
    const ge = client.gameEngine;
    const ix = await createRelieveReinforcementInstruction({
      destinationOwner: publicKey,
      gameEngine: ge,
      senderOwner: row.senderWallet,
      senderCityId: row.account.senderCity ?? 0,
      destinationCityId: row.account.destinationCity ?? 0,
    });
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"]],
        successMessage: "Reinforcements relieved (sent back)!",
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-xs text-text-muted">
        <span>{todName}</span>
      </div>

      {traveling && (
        <div className="rounded-lg border border-border-gold bg-accent/20 px-4 py-3 text-sm text-danger">
          You are currently traveling. Reinforcement actions may be restricted.
        </div>
      )}

      {/* Your Forces */}
      {player && (
        <div className="card accent-border">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
            Available Forces
          </h3>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <div className="text-xs text-text-muted">Infantry</div>
              <GoldNumber value={Number(player.defensiveUnit1 ?? 0n)} />
            </div>
            <div>
              <div className="text-xs text-text-muted">Cavalry</div>
              <GoldNumber value={Number(player.defensiveUnit2 ?? 0n)} />
            </div>
            <div>
              <div className="text-xs text-text-muted">Siege</div>
              <GoldNumber value={Number(player.defensiveUnit3 ?? 0n)} />
            </div>
          </div>
        </div>
      )}

      {/* Send Reinforcements — hidden when this tab is rendered inside Forces
          (sending lives on the EntityPanel via ReinforceComposerPanel). */}
      {!hideComposer && (
        <div className="card">
          <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-text-muted">
            Send Reinforcements
          </h3>
          <div className="space-y-3">
            <div>
              <label className="text-sm text-text-muted">
                Target Player Address:
                <input
                  type="text"
                  value={targetAddress}
                  onChange={(e) => setTargetAddress(e.target.value)}
                  placeholder="Wallet address..."
                  className="mt-1 w-full rounded-lg border border-zinc-800 bg-surface px-3 py-2 text-sm text-text-primary placeholder-text-muted"
                />
              </label>
              {targetAddress.trim() && !isValidAddress && (
                <p className="text-xs text-red-400">Invalid Solana address</p>
              )}
            </div>
            {/* Units & weapons committed to the reinforcement */}
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                Defensive Units
              </div>
              <TripleCountInput
                labels={DEFENSIVE_UNIT_LABELS}
                icons={DEFENSIVE_UNIT_ICONS}
                available={ownedUnits}
                value={reinUnits}
                onChange={setReinUnits}
              />
              <div className="mt-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                Weapons
              </div>
              <TripleCountInput
                labels={WEAPON_LABELS}
                icons={WEAPON_ICONS}
                available={ownedWeapons}
                value={reinWeapons}
                onChange={setReinWeapons}
              />
            </div>
            {/* Hero picker — only rendered when the player has at least one
              locked hero. Buttons (one per filled slot) instead of a select
              so common cases (1 hero) are a single tap. */}
            {lockedHeroes.some((h) => h !== null) && (
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                  Hero (optional)
                </div>
                <div className="mt-1 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setReinHeroSlot(NO_HERO_SLOT)}
                    className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                      reinHeroSlot === NO_HERO_SLOT
                        ? "border-border-gold/50 bg-accent/30 text-text-gold"
                        : "border-zinc-700 bg-surface text-text-secondary hover:bg-surface/70"
                    }`}
                  >
                    None
                  </button>
                  {lockedHeroes.map((h, i) =>
                    h ? (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setReinHeroSlot(i)}
                        className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                          reinHeroSlot === i
                            ? "border-border-gold/50 bg-accent/30 text-text-gold"
                            : "border-zinc-700 bg-surface text-text-secondary hover:bg-surface/70"
                        }`}
                      >
                        {h.name}
                      </button>
                    ) : null,
                  )}
                </div>
              </div>
            )}
            <div className="flex flex-wrap gap-3">
              <TxButton
                onClick={handleSend}
                disabled={
                  !isValidAddress ||
                  traveling ||
                  (reinUnits.every((n) => n === 0) && reinWeapons.every((n) => n === 0))
                }
              >
                Send Reinforcement
              </TxButton>
            </div>
          </div>
        </div>
      )}

      {/* In-Flight Reinforcements */}
      <div className="card">
        <LabelWithInfo
          as="h3"
          className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted"
          info={REINFORCEMENT_STATUS_INFO}
        >
          In-Flight Reinforcements
        </LabelWithInfo>
        {reinforcements.length === 0 ? (
          <p className="text-sm text-text-muted">No active or in-flight reinforcements.</p>
        ) : (
          <div className="space-y-3">
            {reinforcements.map((row) => {
              const status = row.account.status ?? 0;
              const totalUnits =
                (Number(row.account.unitsDef1 ?? 0n)) +
                (Number(row.account.unitsDef2 ?? 0n)) +
                (Number(row.account.unitsDef3 ?? 0n));
              const counterparty =
                row.direction === "sent" ? row.account.destination : row.account.sender;
              const arrivesAt = Number(row.account.arrivesAt ?? 0n);
              const returnAt =
                (Number(row.account.returnStartedAt ?? 0n)) +
                (row.account.returnDuration ?? 0);
              const gemsPerMinute = ge?.gameplayConfig.gemCostPerMinuteSpeedup ?? 1;
              // Seconds left on the leg in flight: outbound while Traveling,
              // return while Returning. The on-chain speedup handles both via
              // one instruction, so the sender can hurry either trip.
              const nowSec = Math.floor(Date.now() / 1000);
              const remaining =
                status === 0
                  ? Math.max(0, arrivesAt - nowSec)
                  : status === 2
                    ? Math.max(0, returnAt - nowSec)
                    : 0;
              // Hold-to-charge caps for the two speedup tiers: T1 leaves 50% of
              // time / 1x cost, T2 leaves 25% / 2x — the same formula the
              // reinforcement processor prices against, so the cap matches chain.
              const gemBalance = Number(player?.gems ?? 0n);
              const speedupTiers = [
                {
                  tier: 1,
                  label: "Hasten",
                  description: "50% time reduction",
                  maxCount: maxSpeedupCount({
                    remainingSeconds: remaining,
                    timeMultiplier: 0.5,
                    costMultiplier: 1,
                    gemsPerMinute,
                    gemBalance,
                  }),
                },
                {
                  tier: 2,
                  label: "Rush",
                  description: "75% time reduction",
                  maxCount: maxSpeedupCount({
                    remainingSeconds: remaining,
                    timeMultiplier: 0.25,
                    costMultiplier: 2,
                    gemsPerMinute,
                    gemBalance,
                  }),
                },
              ];
              const directionChip = (
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                    row.direction === "sent"
                      ? "bg-accent/40 text-text-gold"
                      : "bg-zinc-800 text-text-muted"
                  }`}
                >
                  {row.direction}
                </span>
              );
              const statusChip = (
                <span className="text-xs text-text-secondary">
                  {REINFORCEMENT_STATUS_LABEL[status] ?? `Status ${status}`}
                </span>
              );

              return (
                <div
                  key={row.pubkey.toBase58()}
                  className="rounded-lg border border-zinc-800 px-3 py-2"
                >
                  {/* Mobile: stacked header (direction+status on top, counterparty + units on labelled rows). */}
                  <div className="space-y-1 sm:hidden">
                    <div className="flex items-center justify-between">
                      {directionChip}
                      {statusChip}
                    </div>
                    <div className="flex items-baseline justify-between">
                      <span className="text-[10px] uppercase tracking-wider text-text-muted">
                        {row.direction === "sent" ? "To" : "From"}
                      </span>
                      <span className="font-mono text-sm text-text-primary">
                        <DomainName pubkey={counterparty} chars={4} />
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between">
                      <span className="text-[10px] uppercase tracking-wider text-text-muted">
                        Units
                      </span>
                      <span className="font-mono text-sm text-text-primary tabular-nums">
                        {totalUnits.toLocaleString()}
                      </span>
                    </div>
                  </div>

                  {/* Desktop: single row. */}
                  <div className="hidden items-center gap-3 sm:flex">
                    {directionChip}
                    <span className="font-mono text-sm text-text-primary">
                      <DomainName pubkey={counterparty} chars={4} />
                    </span>
                    <span className="text-xs text-text-muted">
                      {totalUnits.toLocaleString()} units
                    </span>
                    <span className="ml-auto">{statusChip}</span>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {status === 0 && arrivesAt > 0 && (
                      <GoldCountdown
                        endsAt={arrivesAt}
                        format="compact"
                        size="sm"
                        label="Arrives"
                      />
                    )}
                    {status === 2 && returnAt > 0 && (
                      <GoldCountdown
                        endsAt={returnAt}
                        format="compact"
                        size="sm"
                        label="Returns"
                      />
                    )}
                    {/* Process arrival is permissionless once travel completes */}
                    {status === 0 && (
                      <>
                        <TxButton onClick={(rp) => handleProcessArrival(row, rp)} variant="secondary">
                          Process Arrival
                        </TxButton>
                        <InfoButton>
                          Cranks an arrived reinforcement from Traveling to Active so its units start defending.
                        </InfoButton>
                      </>
                    )}
                    {/* Recall — only the sender can recall their own reinforcement */}
                    {row.direction === "sent" && (status === 0 || status === 1) && (
                      <>
                        <TxButton onClick={(rp) => handleRecall(row, rp)} variant="secondary">
                          Recall
                        </TxButton>
                        <InfoButton>
                          The sender pulls their own reinforcements back. Relieve is the receiver doing it. Both head home.
                        </InfoButton>
                      </>
                    )}
                    {/* Relieve — only the destination can send a reinforcement back */}
                    {row.direction === "received" && status === 1 && (
                      <>
                        <TxButton onClick={(rp) => handleRelieve(row, rp)} variant="secondary">
                          Relieve
                        </TxButton>
                        <InfoButton>{REINFORCEMENT_RELIEVE_INFO}</InfoButton>
                      </>
                    )}
                  </div>
                  {/* Speedup — sender hurries an in-flight reinforcement; works on
                      the outbound trip and the return leg (post-relief/recall) */}
                  {row.direction === "sent" && (status === 0 || status === 2) && remaining > 0 && (
                    <SpeedupPanel
                      visible={remaining > 0}
                      remainingSeconds={remaining}
                      tiers={speedupTiers}
                      onSpeedup={(tier, rp, count) =>
                        handleReinforcementSpeedup(row, tier, rp, count)
                      }
                      gemsPerMinute={gemsPerMinute}
                      gemBalance={gemBalance}
                      className="mt-3"
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
