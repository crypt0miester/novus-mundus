"use client";

import { useState, useMemo, useEffect } from "react";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useCastle } from "@/lib/hooks/useCastle";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useWallet } from "@solana/wallet-adapter-react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { GoldNumber } from "@/components/shared/GoldNumber";
import { GoldCountdown } from "@/components/shared/GoldCountdown";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { DomainName } from "@/components/shared/DomainName";
import { GameInfoPanel } from "@/components/shared/GameInfoPanel";
import { InfoGrid } from "@/components/shared/InfoGrid";
import { useGameEngine } from "@/lib/hooks/useGameEngine";
import { bpsToPercent, formatTime } from "@/lib/utils";
import {
  deriveCastlePda,
  derivePlayerPda,
  deriveGarrisonPda,
  deriveCourtPda,
  createClaimVacantCastleInstruction,
  createJoinGarrisonInstruction,
  createLeaveGarrisonInstruction,
  createAppointCourtInstruction,
  createDismissCourtInstruction,
  createResignCourtInstruction,
  createInitiateUpgradeInstruction,
  createCancelUpgradeInstruction,
  createCompleteUpgradeInstruction,
  createRelieveGarrisonInstruction,
  createClaimGarrisonLootInstruction,
  createAttackCastleInstruction,
  parseCourtPosition,
  parseGarrisonContribution,
  parsePlayer,
  AccountKey,
  NOVUS_PROGRAM_ID,
  isNullPubkey,
  type CourtPositionAccount,
  type GarrisonContributionAccount,
} from "@/lib/sdk";
import bs58 from "bs58";

const CASTLE_TIERS = ["Outpost", "Keep", "Stronghold", "Fortress", "Citadel"];
const CASTLE_STATUS = ["Vacant", "Contest", "Protected", "Vulnerable", "Transitioning"];
const COURT_POSITIONS = ["Advisor", "Scholar", "Guardian", "Treasurer", "Marshal"];
const UPGRADE_TYPES = [
  { value: 1, label: "Fortification" },
  { value: 2, label: "Treasury" },
  { value: 3, label: "Chambers" },
  { value: 4, label: "Watchtower" },
  { value: 5, label: "Armory" },
];

export function CastleTab() {
  const { data: playerData } = usePlayer();
  const { data: geData } = useGameEngine();
  const player = playerData?.account;
  const cityId = player?.currentCity ?? 0;

  const [castleId, setCastleId] = useState(0);
  const { data: castleData } = useCastle(cityId, castleId);
  const client = useNovusMundusClient();
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const transact = useTransact();

  const castle = castleData?.account;
  const castlePda = castleData?.pubkey ?? null;

  const [appointPosition, setAppointPosition] = useState(0);
  const [appointeeAddress, setAppointeeAddress] = useState("");
  const [resignPosition, setResignPosition] = useState(0);
  const [upgradeType, setUpgradeType] = useState(1);
  const [driveBy, setDriveBy] = useState(false);

  // Court roster — court positions are enumerable: 5 fixed slots per castle.
  // Each entry carries the holder's player PDA + resolved owner wallet.
  const [courtRoster, setCourtRoster] = useState<
    { position: number; account: CourtPositionAccount; ownerWallet: PublicKey | null }[]
  >([]);
  // Garrison roster — fetched via getProgramAccounts filtered on the castle pubkey.
  const [garrisonRoster, setGarrisonRoster] = useState<
    { account: GarrisonContributionAccount; ownerWallet: PublicKey | null }[]
  >([]);

  // Resolve player-PDA → owner wallet for a batch of player PDAs.
  const resolveWallets = async (playerPdas: PublicKey[]): Promise<Map<string, PublicKey>> => {
    const out = new Map<string, PublicKey>();
    if (playerPdas.length === 0) return out;
    const infos = await connection.getMultipleAccountsInfo(playerPdas);
    for (let i = 0; i < infos.length; i++) {
      const info = infos[i];
      if (!info) continue;
      const parsed = parsePlayer(info);
      if (parsed) out.set(playerPdas[i].toBase58(), parsed.owner);
    }
    return out;
  };

  // Fetch court roster: derive all 5 court PDAs, fetch + parse, resolve holder wallets.
  useEffect(() => {
    if (!castlePda) {
      setCourtRoster([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const courtPdas = [0, 1, 2, 3, 4].map((i) => deriveCourtPda(castlePda, i)[0]);
      const infos = await connection.getMultipleAccountsInfo(courtPdas);
      const occupied: { position: number; account: CourtPositionAccount }[] = [];
      for (let i = 0; i < infos.length; i++) {
        const info = infos[i];
        if (!info) continue;
        const parsed = parseCourtPosition(info);
        if (parsed) occupied.push({ position: i, account: parsed });
      }
      const wallets = await resolveWallets(occupied.map((c) => c.account.holder));
      if (cancelled) return;
      setCourtRoster(
        occupied.map((c) => ({
          position: c.position,
          account: c.account,
          ownerWallet: wallets.get(c.account.holder.toBase58()) ?? null,
        }))
      );
    })().catch(() => {
      if (!cancelled) setCourtRoster([]);
    });
    return () => {
      cancelled = true;
    };
  }, [castlePda?.toBase58(), connection, transact.isPending]);

  // Fetch garrison roster via getProgramAccounts filtered on castle pubkey.
  useEffect(() => {
    if (!castlePda) {
      setGarrisonRoster([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const keyByte = bs58.encode(Buffer.from([AccountKey.CastleGarrison]));
      const accounts = await connection.getProgramAccounts(NOVUS_PROGRAM_ID, {
        filters: [
          { memcmp: { offset: 0, bytes: keyByte } },
          // castle pubkey is the first field after the 1-byte account_key
          { memcmp: { offset: 1, bytes: castlePda.toBase58() } },
        ],
      });
      const parsedList: GarrisonContributionAccount[] = [];
      for (const { account } of accounts) {
        const parsed = parseGarrisonContribution(account);
        if (parsed) parsedList.push(parsed);
      }
      const wallets = await resolveWallets(parsedList.map((g) => g.contributor));
      if (cancelled) return;
      setGarrisonRoster(
        parsedList.map((g) => ({
          account: g,
          ownerWallet: wallets.get(g.contributor.toBase58()) ?? null,
        }))
      );
    })().catch(() => {
      if (!cancelled) setGarrisonRoster([]);
    });
    return () => {
      cancelled = true;
    };
  }, [castlePda?.toBase58(), connection, transact.isPending]);

  const isKing = useMemo(() => {
    if (!castle || !publicKey || !castle.hasKing) return false;
    return castle.king.equals(publicKey);
  }, [castle, publicKey]);

  const hasUpgradeInProgress = useMemo(() => {
    if (!castle) return false;
    return castle.upgradeType > 0;
  }, [castle]);

  // Check team prerequisite
  const teamKey = player?.team;
  const hasTeam = !!teamKey && teamKey.toBase58() !== "11111111111111111111111111111111";

  const handleClaimVacant = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const [playerPda] = derivePlayerPda(ge, publicKey);
    const [castlePda] = deriveCastlePda(ge, cityId, castleId);
    const ix = createClaimVacantCastleInstruction({
      player: playerPda,
      castle: castlePda,
      gameEngine: ge,
      owner: publicKey,
    });
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["castle"], ["player"]],
      successMessage: "Castle claimed!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleJoinGarrison = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const [playerPda] = derivePlayerPda(ge, publicKey);
    const [castlePda] = deriveCastlePda(ge, cityId, castleId);
    const [garrisonPda] = deriveGarrisonPda(castlePda, playerPda);
    const ix = createJoinGarrisonInstruction(
      {
        player: playerPda,
        castle: castlePda,
        garrison: garrisonPda,
        gameEngine: ge,
        owner: publicKey,
      },
      { units: 10 }
    );
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["castle"], ["player"]],
      successMessage: "Joined garrison!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleLeaveGarrison = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const [playerPda] = derivePlayerPda(ge, publicKey);
    const [castlePda] = deriveCastlePda(ge, cityId, castleId);
    const [garrisonPda] = deriveGarrisonPda(castlePda, playerPda);
    const ix = createLeaveGarrisonInstruction({
      player: playerPda,
      castle: castlePda,
      garrison: garrisonPda,
      gameEngine: ge,
      owner: publicKey,
    });
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["castle"], ["player"]],
      successMessage: "Left garrison.",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleAppointCourt = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const appointeePubkey = new PublicKey(appointeeAddress.trim());
    const ix = createAppointCourtInstruction(
      {
        king: publicKey,
        appointee: appointeePubkey,
        gameEngine: ge,
        cityId,
        castleId,
      },
      { position: appointPosition }
    );
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["castle"], ["player"]],
      successMessage: "Court member appointed!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleDismissCourt = async (
    position: number,
    dismissedWallet: PublicKey,
    reportPhase: (p: TxPhase) => void,
  ) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const ix = createDismissCourtInstruction(
      {
        king: publicKey,
        dismissed: dismissedWallet,
        gameEngine: ge,
        cityId,
        castleId,
      },
      { position }
    );
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["castle"], ["player"]],
      successMessage: "Court member dismissed!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleResignCourt = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const ix = createResignCourtInstruction(
      {
        courtMember: publicKey,
        gameEngine: ge,
        cityId,
        castleId,
      },
      { position: resignPosition }
    );
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["castle"], ["player"]],
      successMessage: "Resigned from court.",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleInitiateUpgrade = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const ix = createInitiateUpgradeInstruction(
      {
        king: publicKey,
        gameEngine: ge,
        cityId,
        castleId,
      },
      { upgradeType }
    );
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["castle"], ["player"]],
      successMessage: "Upgrade initiated!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleCancelUpgrade = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const ix = createCancelUpgradeInstruction({
      king: publicKey,
      gameEngine: ge,
      cityId,
      castleId,
    });
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["castle"], ["player"]],
      successMessage: "Upgrade cancelled.",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleCompleteUpgrade = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const ix = createCompleteUpgradeInstruction({
      payer: publicKey,
      gameEngine: ge,
      cityId,
      castleId,
    });
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["castle"]],
      successMessage: "Upgrade completed!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleRelieveGarrison = async (
    memberWallet: PublicKey,
    reportPhase: (p: TxPhase) => void,
  ) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const ix = createRelieveGarrisonInstruction({
      king: publicKey,
      garrisonMember: memberWallet,
      gameEngine: ge,
      cityId,
      castleId,
    });
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["castle"], ["player"]],
      successMessage: "Garrison member relieved.",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleClaimGarrisonLoot = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const ix = createClaimGarrisonLootInstruction({
      owner: publicKey,
      gameEngine: ge,
      cityId,
      castleId,
    });
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["castle"], ["player"]],
      successMessage: "Garrison loot claimed!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleAttackCastle = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const ix = createAttackCastleInstruction(
      {
        attacker: publicKey,
        gameEngine: ge,
        cityId,
        castleId,
      },
      { driveBy }
    );
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["castle"], ["player"]],
      successMessage: driveBy ? "Drive-by attack launched!" : "Castle attacked!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  if (!hasTeam) {
    return (
      <div className="card text-center">
        <p className="text-text-muted">You need to join a team before you can interact with castles.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Castle selector */}
      <div className="flex gap-1 rounded-lg bg-surface p-1">
        {[0, 1, 2].map((id) => (
          <button
            key={id}
            onClick={() => setCastleId(id)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              castleId === id
                ? "bg-surface-raised text-text-gold"
                : "text-text-muted hover:text-text-secondary"
            }`}
          >
            Castle {id}
          </button>
        ))}
      </div>

      {/* Castle Info */}
      {castle ? (
        <>
          <div className="card accent-border">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <div>
                <div className="text-xs text-text-muted">Tier</div>
                <div className="text-sm font-semibold text-text-gold">
                  {CASTLE_TIERS[castle.tier ?? 0]}
                </div>
              </div>
              <div>
                <div className="text-xs text-text-muted">Status</div>
                <div className="text-sm font-semibold text-text-primary">
                  {CASTLE_STATUS[castle.status ?? 0]}
                </div>
              </div>
              <div>
                <div className="text-xs text-text-muted">Garrison</div>
                <GoldNumber value={castle.garrisonCount ?? 0} size="sm" />
              </div>
              <div>
                <div className="text-xs text-text-muted">Total Rewards</div>
                <GoldNumber
                  value={castle.totalRewardsDistributed?.toNumber?.() ?? 0}
                  prefix="$ "
                  size="sm"
                />
              </div>
            </div>
            {castle.hasKing && (
              <div className="mt-3 border-t border-zinc-800 pt-3">
                <div className="text-xs text-text-muted">King</div>
                <div className="text-sm text-text-primary">
                  <DomainName pubkey={castle.king} chars={6} />
                </div>
              </div>
            )}
          </div>

          {/* Court Positions */}
          <div className="card">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
              Court Positions ({castle.courtCount ?? 0} / {castle.maxCourt ?? 5})
            </h3>
            <div className="grid gap-2 md:grid-cols-5">
              {COURT_POSITIONS.map((pos, i) => {
                const member = courtRoster.find((c) => c.position === i);
                return (
                  <div key={pos} className="rounded-lg border border-zinc-800 p-3 text-center">
                    <div className="text-xs text-text-muted">{pos}</div>
                    {member ? (
                      <div className="mt-1 text-xs text-text-primary">
                        <DomainName pubkey={member.account.holder} chars={4} />
                      </div>
                    ) : (
                      <div className="mt-1 text-xs text-text-secondary">Vacant</div>
                    )}
                    {isKing && member && member.ownerWallet && (
                      <TxButton
                        onClick={(rp) => handleDismissCourt(i, member.ownerWallet!, rp)}
                        variant="danger"
                      >
                        Dismiss
                      </TxButton>
                    )}
                  </div>
                );
              })}
            </div>

            {isKing && (
              <div className="mt-4 space-y-2">
                <h4 className="text-xs font-semibold text-text-muted">Appoint Court Member</h4>
                <div className="flex flex-wrap gap-2">
                  <select
                    value={appointPosition}
                    onChange={(e) => setAppointPosition(Number(e.target.value))}
                    className="rounded-lg border border-zinc-800 bg-surface px-3 py-2 text-sm text-text-primary"
                  >
                    {COURT_POSITIONS.map((pos, i) => (
                      <option key={pos} value={i}>{pos}</option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={appointeeAddress}
                    onChange={(e) => setAppointeeAddress(e.target.value)}
                    placeholder="Appointee wallet address"
                    className="flex-1 rounded-lg border border-zinc-800 bg-surface px-3 py-2 text-sm text-text-primary placeholder-text-muted"
                  />
                  <TxButton onClick={handleAppointCourt}>Appoint</TxButton>
                </div>
              </div>
            )}

            {!isKing && castle.hasKing && (
              <div className="mt-4 space-y-2">
                <h4 className="text-xs font-semibold text-text-muted">Resign from Court</h4>
                <div className="flex gap-2">
                  <select
                    value={resignPosition}
                    onChange={(e) => setResignPosition(Number(e.target.value))}
                    className="rounded-lg border border-zinc-800 bg-surface px-3 py-2 text-sm text-text-primary"
                  >
                    {COURT_POSITIONS.map((pos, i) => (
                      <option key={pos} value={i}>{pos}</option>
                    ))}
                  </select>
                  <TxButton onClick={handleResignCourt} variant="danger">Resign</TxButton>
                </div>
              </div>
            )}
          </div>

          {/* Castle Upgrade (King only) */}
          {isKing && (
            <div className="card">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
                Castle Upgrades
              </h3>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
                <div>
                  <div className="text-xs text-text-muted">Fortification</div>
                  <div className="text-sm font-semibold text-text-primary">Lv {castle.fortificationLevel ?? 0}</div>
                </div>
                <div>
                  <div className="text-xs text-text-muted">Treasury</div>
                  <div className="text-sm font-semibold text-text-primary">Lv {castle.treasuryLevel ?? 0}</div>
                </div>
                <div>
                  <div className="text-xs text-text-muted">Chambers</div>
                  <div className="text-sm font-semibold text-text-primary">Lv {castle.chambersLevel ?? 0}</div>
                </div>
                <div>
                  <div className="text-xs text-text-muted">Watchtower</div>
                  <div className="text-sm font-semibold text-text-primary">Lv {castle.watchtowerLevel ?? 0}</div>
                </div>
                <div>
                  <div className="text-xs text-text-muted">Armory</div>
                  <div className="text-sm font-semibold text-text-primary">Lv {castle.armoryLevel ?? 0}</div>
                </div>
              </div>

              {hasUpgradeInProgress ? (
                <div className="mt-4 space-y-2">
                  <div className="flex items-center justify-between rounded-lg border border-zinc-800 px-3 py-2">
                    <span className="text-xs text-text-muted">
                      Upgrading: {UPGRADE_TYPES.find((u) => u.value === castle.upgradeType)?.label ?? "Unknown"}
                      {" to Lv "}{castle.upgradeTargetLevel ?? "?"}
                    </span>
                    <GoldCountdown
                      endsAt={castle.upgradeEndAt?.toNumber?.() ?? 0}
                      format="full"
                      label="Completes"
                    />
                  </div>
                  <div className="flex gap-2">
                    <TxButton onClick={handleCancelUpgrade} variant="danger">Cancel Upgrade</TxButton>
                    <TxButton onClick={handleCompleteUpgrade} variant="secondary">Complete Upgrade</TxButton>
                  </div>
                </div>
              ) : (
                <div className="mt-4 flex gap-2">
                  <select
                    value={upgradeType}
                    onChange={(e) => setUpgradeType(Number(e.target.value))}
                    className="rounded-lg border border-zinc-800 bg-surface px-3 py-2 text-sm text-text-primary"
                  >
                    {UPGRADE_TYPES.map((u) => (
                      <option key={u.value} value={u.value}>{u.label}</option>
                    ))}
                  </select>
                  <TxButton onClick={handleInitiateUpgrade}>Initiate Upgrade</TxButton>
                </div>
              )}
            </div>
          )}

          {/* Garrison Actions */}
          <div className="card">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
              Garrison Actions
            </h3>
            <div className="flex flex-wrap gap-3">
              <TxButton onClick={handleJoinGarrison} variant="secondary">
                Join Garrison
              </TxButton>
              <TxButton onClick={handleLeaveGarrison} variant="danger">
                Leave Garrison
              </TxButton>
              <TxButton onClick={handleClaimGarrisonLoot} variant="secondary">
                Claim Garrison Loot
              </TxButton>
            </div>

            {/* Garrison roster */}
            <div className="mt-4 space-y-2">
              <h4 className="text-xs font-semibold text-text-muted">
                Garrison Members ({garrisonRoster.length})
              </h4>
              {garrisonRoster.length === 0 ? (
                <p className="text-xs text-text-muted">No garrison members.</p>
              ) : (
                <div className="space-y-2">
                  {garrisonRoster.map((g) => {
                    const totalUnits =
                      (g.account.du1?.toNumber?.() ?? 0) +
                      (g.account.du2?.toNumber?.() ?? 0) +
                      (g.account.du3?.toNumber?.() ?? 0);
                    return (
                      <div
                        key={g.account.contributor.toBase58()}
                        className="flex items-center justify-between rounded-lg border border-zinc-800 px-3 py-2"
                      >
                        <div className="flex items-center gap-3">
                          <span className="font-mono text-sm text-text-primary">
                            <DomainName pubkey={g.account.contributor} chars={4} />
                          </span>
                          <span className="text-xs text-text-muted">{totalUnits} units</span>
                        </div>
                        {isKing && g.ownerWallet && (
                          <TxButton
                            onClick={(rp) => handleRelieveGarrison(g.ownerWallet!, rp)}
                            variant="danger"
                          >
                            Relieve
                          </TxButton>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-3">
            {castle.status === 0 && (
              <TxButton onClick={handleClaimVacant}>Claim Castle</TxButton>
            )}
            <div className="flex items-center gap-2">
              <TxButton onClick={handleAttackCastle} variant="danger">
                Attack Castle
              </TxButton>
              <button
                onClick={() => setDriveBy(!driveBy)}
                className={`rounded-lg px-3 py-2 text-sm ${
                  driveBy ? "bg-amber-900/30 text-text-gold" : "text-text-muted"
                }`}
              >
                Drive-by
              </button>
            </div>
          </div>
        </>
      ) : (
        <div className="card text-center">
          <p className="text-text-muted">No castle found at this location.</p>
        </div>
      )}

      {/* Game Parameters */}
      {geData?.account && (() => {
        const cc = geData.account.castleConfig;
        return (
          <GameInfoPanel>
            <InfoGrid items={[
              { label: "King NOVI/Day", value: cc.kingNoviPerDay.toNumber().toLocaleString(), highlight: true },
              { label: "King Cash/Day", value: cc.kingCashPerDay.toNumber().toLocaleString() },
              { label: "Court NOVI/Day", value: cc.courtNoviPerDay.toNumber().toLocaleString() },
              { label: "Court Cash/Day", value: cc.courtCashPerDay.toNumber().toLocaleString() },
              { label: "Member NOVI/Day", value: cc.memberNoviPerDay.toNumber().toLocaleString() },
              { label: "Member Cash/Day", value: cc.memberCashPerDay.toNumber().toLocaleString() },
              { label: "King Loot Cut", value: bpsToPercent(cc.kingLootCutBps) },
              { label: "Protection", value: formatTime(cc.protectionDuration.toNumber(), "compact") },
              { label: "Garrison T0", value: cc.garrisonCapByTier[0]?.toString() ?? "—" },
              { label: "Garrison T1", value: cc.garrisonCapByTier[1]?.toString() ?? "—" },
              { label: "Garrison T2", value: cc.garrisonCapByTier[2]?.toString() ?? "—" },
              { label: "Max Fortification", value: cc.maxFortificationLevel.toString() },
            ]} />
          </GameInfoPanel>
        );
      })()}
    </div>
  );
}
