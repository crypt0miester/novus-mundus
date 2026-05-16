"use client";

import { useState, useMemo, useEffect } from "react";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useTeam } from "@/lib/hooks/useTeam";
import { useTeamMembers } from "@/lib/hooks/useTeamMembers";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useWallet } from "@solana/wallet-adapter-react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useAccountStore } from "@/lib/store/accounts";
import { useTransitionStore } from "@/lib/store/transition";
import { GoldNumber } from "@/components/shared/GoldNumber";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { DomainName } from "@/components/shared/DomainName";
import { DomainPicker } from "@/components/shared/DomainPicker";
import { GameInfoPanel } from "@/components/shared/GameInfoPanel";
import { InfoGrid } from "@/components/shared/InfoGrid";
import { useGameEngine } from "@/lib/hooks/useGameEngine";
import { formatTime } from "@/lib/utils";
import {
  derivePlayerPda,
  deriveTreasuryRequestPda,
  deriveTeamInvitePda,
  isNullPubkey,
  parsePlayer,
  parseTeam,
  parseTreasuryRequest,
  parseTeamInvite,
  createTeamCreateInstruction,
  createTeamLeaveInstruction,
  createTeamDisbandInstruction,
  createTeamDepositTreasuryInstruction,
  createTeamWithdrawTreasuryInstruction,
  createTeamSetMotdInstruction,
  createTeamInviteInstruction,
  createTeamAcceptInviteInstruction,
  createTeamDeclineInviteInstruction,
  createTeamKickMemberInstruction,
  createTeamCancelInviteInstruction,
  createTeamPromoteMemberInstruction,
  createTeamDemoteMemberInstruction,
  createTeamTransferLeadershipInstruction,
  createTeamUpdateSettingsInstruction,
  createTeamTreasuryRequestWithdrawInstruction,
  createTeamTreasuryApproveRequestInstruction,
  createTeamTreasuryRejectRequestInstruction,
  createTeamTreasuryExecuteRequestInstruction,
  createTeamTreasuryCancelRequestInstruction,
  createTeamUpdateTreasurySettingsInstruction,
  createSetTeamNameInstruction,
  createUpdateTeamNameInstruction,
  createRemoveTeamNameInstruction,
  isTraveling,
} from "novus-mundus-sdk";

const RANK_LABELS: Record<number, string> = {
  0: "Leader",
  1: "Co-Leader",
  2: "Officer",
  3: "Member",
  4: "Recruit",
};

const SIDEBAR_LABELS: Record<"chat" | "treasury" | "settings", string> = {
  chat: "War-table",
  treasury: "Treasury",
  settings: "Settings",
};

export function TeamTab() {
  const { data: playerData } = usePlayer();
  const { data: geData } = useGameEngine();
  const player = playerData?.account;
  const client = useNovusMundusClient();
  const { publicKey } = useWallet();
  const transact = useTransact();

  const hasTeam = !!player?.team && !isNullPubkey(player.team);
  const teamPubkey = hasTeam ? player!.team : null;

  const { data: teamData } = useTeam(teamPubkey);
  const { data: members } = useTeamMembers(teamData?.pubkey ?? null);

  const team = teamData?.account;
  const teamId = team?.id;

  const isLeader = useMemo(() => {
    if (!publicKey || !team) return false;
    return team.leader.equals(publicKey);
  }, [publicKey, team]);

  const myRank = useMemo(() => {
    if (!publicKey || !members) return 99;
    const myPda = derivePlayerPda(client.gameEngine, publicKey)[0];
    const me = members.find((m) => m.account.player.equals(myPda));
    return me?.account.rank ?? 99;
  }, [publicKey, members, client.gameEngine]);

  const isOfficerPlus = myRank <= 2; // Leader(0), Co-Leader(1), Officer(2)

  const traveling = player ? isTraveling(player) : false;
  const otherPlayers = useAccountStore((s) => s.otherPlayers);
  const upsertOtherPlayer = useAccountStore((s) => s.upsertOtherPlayer);
  const { connection } = useConnection();

  // Batch-fetch player accounts for members missing from the Zustand cache
  useEffect(() => {
    if (!members || members.length === 0) return;
    const missing = members
      .map((m) => m.account.player)
      .filter((pda) => !otherPlayers.has(pda.toBase58()));
    if (missing.length === 0) return;

    connection.getMultipleAccountsInfo(missing).then((infos) => {
      for (let i = 0; i < infos.length; i++) {
        const info = infos[i];
        if (!info) continue;
        const parsed = parsePlayer(info);
        if (parsed) upsertOtherPlayer(missing[i], parsed);
      }
    }).catch(() => {});
  }, [members, connection]);

  // On-demand fetch: treasury requests are PDA-derivable per (team, requester).
  // The store is otherwise only seeded by the WebSocket, so a freshly loaded
  // page would show nothing — derive + fetch one request PDA per member.
  useEffect(() => {
    if (!teamData?.pubkey || !members || members.length === 0) return;
    const teamKey = teamData.pubkey;
    const requestPdas = members.map(
      (m) => deriveTreasuryRequestPda(teamKey, m.account.player)[0],
    );
    connection.getMultipleAccountsInfo(requestPdas).then((infos) => {
      const store = useAccountStore.getState();
      for (let i = 0; i < infos.length; i++) {
        const info = infos[i];
        if (!info) continue;
        const parsed = parseTreasuryRequest(info);
        if (parsed) store.upsertTreasuryRequest(requestPdas[i], parsed);
      }
    }).catch(() => {});
  }, [teamData?.pubkey?.toBase58(), members, connection, transact.isPending]);

  // On-demand fetch: incoming team invites for the current player. Invites
  // addressed to us are streamed by subscriptions.ts, but a freshly loaded
  // page has nothing until a WS event fires. The invite PDA is derivable from
  // (team, invitee player), so derive one per active team and fetch in bulk.
  useEffect(() => {
    if (!publicKey) return;
    const ge = client.gameEngine;
    const [meiPlayerPda] = derivePlayerPda(ge, publicKey);
    let cancelled = false;
    client.fetchAllTeams({ activeOnly: true }).then((teams) => {
      if (cancelled || teams.length === 0) return;
      const invitePdas = teams.map(
        (t) => deriveTeamInvitePda(t.pubkey, meiPlayerPda)[0],
      );
      return connection.getMultipleAccountsInfo(invitePdas).then((infos) => {
        if (cancelled) return;
        const store = useAccountStore.getState();
        for (let i = 0; i < infos.length; i++) {
          const info = infos[i];
          if (!info) continue;
          const parsed = parseTeamInvite(info);
          if (parsed) store.upsertTeamInvite(invitePdas[i], parsed);
        }
      });
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [publicKey?.toBase58(), client, connection, transact.isPending]);

  const [teamName, setTeamName] = useState("");
  const [depositAmount, setDepositAmount] = useState(0);
  const [withdrawAmount, setWithdrawAmount] = useState(0);
  const [motd, setMotd] = useState("");
  const [inviteAddress, setInviteAddress] = useState("");
  const [requestWithdrawAmount, setRequestWithdrawAmount] = useState(0);

  const teamInvites = useAccountStore((s) => s.teamInvites);
  const treasuryRequests = useAccountStore((s) => s.treasuryRequests);

  const isValidInviteAddress = useMemo(() => {
    if (!inviteAddress.trim()) return false;
    try {
      new PublicKey(inviteAddress.trim());
      return true;
    } catch {
      return false;
    }
  }, [inviteAddress]);

  const currentTeamDomainName = useMemo(() => {
    if (!team || !team.name || !team.name.includes(".")) return null;
    return team.name;
  }, [team]);

  const parsedTeamName = useMemo(() => {
    if (!currentTeamDomainName) return null;
    const dotIdx = currentTeamDomainName.indexOf(".");
    if (dotIdx === -1) return null;
    return { domain: currentTeamDomainName.slice(0, dotIdx), tld: currentTeamDomainName.slice(dotIdx + 1) };
  }, [currentTeamDomainName]);

  const handleCreate = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !teamName.trim()) throw new Error("Missing data");
    const ge = client.gameEngine;
    const teamIdNum = Date.now();
    const ix = createTeamCreateInstruction(
      { owner: publicKey, gameEngine: ge, teamId: teamIdNum },
      { name: teamName.trim() }
    );
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["player"], ["team"]],
      successMessage: `Team "${teamName.trim()}" created!`,
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleLeave = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !teamPubkey || !teamId || !player) throw new Error("Missing data");
    const ge = client.gameEngine;
    const ix = createTeamLeaveInstruction({
      owner: publicKey,
      gameEngine: ge,
      team: teamPubkey,
      teamId,
      slotIndex: player.teamSlotIndex,
    });
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["player"], ["team"], ["teamMembers"]],
      successMessage: "Left the team.",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleDisband = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !teamPubkey || !teamId) throw new Error("Missing data");
    const ge = client.gameEngine;
    const ix = createTeamDisbandInstruction({
      leader: publicKey,
      gameEngine: ge,
      team: teamPubkey,
      teamId,
    });
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["player"], ["team"], ["teamMembers"]],
      successMessage: "Team disbanded.",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleDeposit = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !teamPubkey || !teamId || depositAmount <= 0) throw new Error("Invalid amount");
    const ge = client.gameEngine;
    const ix = createTeamDepositTreasuryInstruction(
      { owner: publicKey, gameEngine: ge, team: teamPubkey, teamId },
      { amount: depositAmount }
    );
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["player"], ["team"]],
      successMessage: `Deposited $${depositAmount} to treasury!`,
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleWithdraw = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !teamPubkey || !teamId || !player || withdrawAmount <= 0) throw new Error("Invalid amount");
    const ge = client.gameEngine;
    const ix = createTeamWithdrawTreasuryInstruction(
      { owner: publicKey, gameEngine: ge, team: teamPubkey, teamId, slotIndex: player.teamSlotIndex },
      { amount: withdrawAmount }
    );
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["player"], ["team"]],
      successMessage: `Withdrew $${withdrawAmount} from treasury!`,
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleSetMotd = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !teamPubkey || !teamId || !player || !motd.trim()) throw new Error("Missing data");
    const ge = client.gameEngine;
    const ix = createTeamSetMotdInstruction(
      { owner: publicKey, gameEngine: ge, team: teamPubkey, teamId, slotIndex: player.teamSlotIndex },
      { motd: motd.trim() }
    );
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["team"]],
      successMessage: "MOTD updated!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleInvite = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !teamPubkey || !teamId || !player || !inviteAddress.trim()) throw new Error("Missing data");
    const ge = client.gameEngine;
    let inviteePlayerPda: PublicKey;
    try {
      const inviteeWallet = new PublicKey(inviteAddress.trim());
      [inviteePlayerPda] = derivePlayerPda(ge, inviteeWallet);
    } catch {
      throw new Error("Invalid address");
    }
    const ix = createTeamInviteInstruction({
      inviter: publicKey,
      gameEngine: ge,
      team: teamPubkey,
      teamId,
      inviterSlotIndex: player.teamSlotIndex,
      inviteePlayer: inviteePlayerPda,
    });
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["team"]],
      successMessage: "Invite sent!",
      onPhase: reportPhase,
    }).then((r) => {
      setInviteAddress("");
      return r.signature;
    });
  };

  const handleTeamNameSet = (domain: string, tld: string) => {
    if (!publicKey || !teamPubkey) return;
    const ge = client.gameEngine;

    if (parsedTeamName) {
      const ix = createUpdateTeamNameInstruction({
        leader: publicKey,
        gameEngine: ge,
        team: teamPubkey,
        tld,
        domainName: domain,
        oldTld: parsedTeamName.tld,
        oldDomainName: parsedTeamName.domain,
      });
      transact.mutate({
        instructions: [ix],
        invalidateKeys: [["team"], ["owned-domains"]],
        successMessage: "Team name updated!",
      });
    } else {
      const ix = createSetTeamNameInstruction({
        leader: publicKey,
        gameEngine: ge,
        team: teamPubkey,
        tld,
        domainName: domain,
      });
      transact.mutate({
        instructions: [ix],
        invalidateKeys: [["team"], ["owned-domains"]],
        successMessage: "Team name set!",
      });
    }
  };

  const handleTeamNameRemove = () => {
    if (!publicKey || !teamPubkey || !parsedTeamName) return;
    const ge = client.gameEngine;
    const ix = createRemoveTeamNameInstruction({
      leader: publicKey,
      gameEngine: ge,
      team: teamPubkey,
      tld: parsedTeamName.tld,
      domainName: parsedTeamName.domain,
    });
    transact.mutate({
      instructions: [ix],
      invalidateKeys: [["team"], ["owned-domains"]],
      successMessage: "Team name removed.",
    });
  };

  const handleKick = async (kickedPlayer: PublicKey, kickedSlotIndex: number, kickedOwner: PublicKey) => {
    if (!publicKey || !teamPubkey || !teamId || !player) throw new Error("Missing data");
    const ge = client.gameEngine;
    const ix = createTeamKickMemberInstruction({
      kicker: publicKey,
      gameEngine: ge,
      team: teamPubkey,
      teamId,
      kickerSlotIndex: player.teamSlotIndex,
      kickedPlayer,
      kickedSlotIndex,
      kickedOwner,
    });
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["team"], ["teamMembers"]],
      successMessage: "Member kicked.",
    }).then((r) => r.signature);
  };

  const handlePromote = async (targetSlotIndex: number, currentRank: number) => {
    if (!publicKey || !teamPubkey || !teamId || !player) throw new Error("Missing data");
    const ge = client.gameEngine;
    const newRank = Math.max(1, currentRank - 1); // promote = lower rank number (but not 0=leader)
    const ix = createTeamPromoteMemberInstruction(
      { promoter: publicKey, gameEngine: ge, team: teamPubkey, teamId, promoterSlotIndex: player.teamSlotIndex, targetSlotIndex },
      { newRank }
    );
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["team"], ["teamMembers"]],
      successMessage: `Member promoted to ${RANK_LABELS[newRank]}!`,
    }).then((r) => r.signature);
  };

  const handleDemote = async (targetSlotIndex: number, currentRank: number) => {
    if (!publicKey || !teamPubkey || !teamId || !player) throw new Error("Missing data");
    const ge = client.gameEngine;
    const newRank = Math.min(4, currentRank + 1); // demote = higher rank number
    const ix = createTeamDemoteMemberInstruction(
      { demoter: publicKey, gameEngine: ge, team: teamPubkey, teamId, demoterSlotIndex: player.teamSlotIndex, targetSlotIndex },
      { newRank }
    );
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["team"], ["teamMembers"]],
      successMessage: `Member demoted to ${RANK_LABELS[newRank]}.`,
    }).then((r) => r.signature);
  };

  const handleTransferLeadership = async (newLeaderPlayer: PublicKey, newSlotIndex: number) => {
    if (!publicKey || !teamPubkey || !teamId || !player) throw new Error("Missing data");
    const ge = client.gameEngine;
    const ix = createTeamTransferLeadershipInstruction({
      leader: publicKey, gameEngine: ge, team: teamPubkey, teamId,
      currentSlotIndex: player.teamSlotIndex, newLeaderPlayer, newSlotIndex,
    });
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["team"], ["teamMembers"], ["player"]],
      successMessage: "Leadership transferred!",
    }).then((r) => r.signature);
  };

  const handleCancelInvite = async (inviteePlayer: PublicKey) => {
    if (!publicKey || !teamPubkey || !teamId || !player) throw new Error("Missing data");
    const ge = client.gameEngine;
    const ix = createTeamCancelInviteInstruction({
      member: publicKey, gameEngine: ge, team: teamPubkey, teamId,
      memberSlotIndex: player.teamSlotIndex, inviteePlayer,
    });
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["team"]],
      successMessage: "Invite cancelled.",
    }).then((r) => r.signature);
  };

  const handleUpdateSettings = async (isPublic: boolean, minLevel: number, reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !teamPubkey || !teamId || !player) throw new Error("Missing data");
    const ge = client.gameEngine;
    const settings = isPublic ? 1 : 0; // bit 0 = PUBLIC
    const ix = createTeamUpdateSettingsInstruction(
      { member: publicKey, gameEngine: ge, team: teamPubkey, teamId, slotIndex: player.teamSlotIndex },
      { settings, minLevelToJoin: minLevel }
    );
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["team"]],
      successMessage: "Team settings updated!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleTreasuryRequestWithdraw = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !teamPubkey || !teamId || !player || requestWithdrawAmount <= 0) throw new Error("Invalid amount");
    const ge = client.gameEngine;
    const ix = createTeamTreasuryRequestWithdrawInstruction(
      { owner: publicKey, gameEngine: ge, team: teamPubkey, teamId, slotIndex: player.teamSlotIndex },
      { amount: requestWithdrawAmount }
    );
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["team"]],
      successMessage: `Withdrawal of $${requestWithdrawAmount} requested!`,
      onPhase: reportPhase,
    }).then((r) => {
      setRequestWithdrawAmount(0);
      return r.signature;
    });
  };

  const handleTreasuryApprove = async (
    requesterPlayer: PublicKey,
    requesterRefund: PublicKey,
    requesterSlotIndex: number,
  ) => {
    if (!publicKey || !teamPubkey || !teamId || !player) throw new Error("Missing data");
    const ge = client.gameEngine;
    const ix = createTeamTreasuryApproveRequestInstruction({
      approver: publicKey, gameEngine: ge, team: teamPubkey, teamId,
      approverSlotIndex: player.teamSlotIndex, requesterSlotIndex, requesterPlayer, requesterRefund,
    });
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["team"]],
      successMessage: "Request approved!",
    }).then((r) => r.signature);
  };

  const handleTreasuryReject = async (requesterPlayer: PublicKey, requesterRefund: PublicKey) => {
    if (!publicKey || !teamPubkey || !teamId || !player) throw new Error("Missing data");
    const ge = client.gameEngine;
    const ix = createTeamTreasuryRejectRequestInstruction({
      rejecter: publicKey, gameEngine: ge, team: teamPubkey, teamId,
      rejecterSlotIndex: player.teamSlotIndex, requesterPlayer, requesterRefund,
    });
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["team"]],
      successMessage: "Request rejected.",
    }).then((r) => r.signature);
  };

  const handleTreasuryExecute = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !teamPubkey || !teamId || !player) throw new Error("Missing data");
    const ge = client.gameEngine;
    const ix = createTeamTreasuryExecuteRequestInstruction({
      owner: publicKey, gameEngine: ge, team: teamPubkey, teamId, slotIndex: player.teamSlotIndex,
    });
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["team"], ["player"]],
      successMessage: "Withdrawal executed!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleTreasuryCancel = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !teamPubkey || !teamId) throw new Error("Missing data");
    const ge = client.gameEngine;
    const ix = createTeamTreasuryCancelRequestInstruction({
      owner: publicKey, gameEngine: ge, team: teamPubkey, teamId,
    });
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["team"]],
      successMessage: "Withdrawal request cancelled.",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleUpdateTreasurySettings = async (
    instantLimits: [number, number, number, number],
    dailyCaps: [number, number, number, number],
    cooldownHours: number,
    reportPhase: (p: TxPhase) => void,
  ) => {
    if (!publicKey || !teamPubkey || !teamId || !player) throw new Error("Missing data");
    const ge = client.gameEngine;
    const ix = createTeamUpdateTreasurySettingsInstruction(
      { leader: publicKey, gameEngine: ge, team: teamPubkey, teamId, slotIndex: player.teamSlotIndex },
      { instantLimits, dailyCaps, cooldownHours }
    );
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["team"]],
      successMessage: "Treasury settings updated!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const getMemberNetworth = (playerPda: PublicKey): number => {
    const entry = otherPlayers.get(playerPda.toBase58());
    return entry?.account?.networth?.toNumber?.() ?? 0;
  };

  const getMemberLevel = (playerPda: PublicKey): number => {
    const entry = otherPlayers.get(playerPda.toBase58());
    return entry?.account?.level ?? 0;
  };

  const sortedMembers = useMemo(() => {
    if (!members) return [];
    return [...members].sort((a, b) => {
      return getMemberNetworth(b.account.player) - getMemberNetworth(a.account.player);
    });
  }, [members, otherPlayers]);

  // The current player's own PlayerAccount PDA — used to detect own treasury request.
  const myPlayerPda = useMemo(() => {
    if (!publicKey) return null;
    return derivePlayerPda(client.gameEngine, publicKey)[0];
  }, [publicKey, client.gameEngine]);

  // Pending treasury withdrawal requests for this team, enriched with the
  // requester's slot index (for approve) and refund wallet (rent recipient).
  const pendingRequests = useMemo(() => {
    if (!team) return [];
    const teamKey = teamData?.pubkey?.toBase58();
    return Array.from(treasuryRequests.values())
      .filter((r) => !teamKey || r.account.team.toBase58() === teamKey)
      .map((r) => {
        const requesterPda = r.account.requester;
        const slot = members?.find((m) => m.account.player.equals(requesterPda));
        const requesterWallet =
          otherPlayers.get(requesterPda.toBase58())?.account?.owner ?? null;
        return {
          pubkey: r.pubkey,
          account: r.account,
          requesterPda,
          requesterSlotIndex: slot?.account.slotIndex ?? null,
          requesterWallet,
          isMine: myPlayerPda ? requesterPda.equals(myPlayerPda) : false,
        };
      });
  }, [treasuryRequests, team, teamData, members, otherPlayers, myPlayerPda]);

  const myRequest = useMemo(
    () => pendingRequests.find((r) => r.isMine) ?? null,
    [pendingRequests],
  );

  // Incoming team invites addressed to the current player.
  // subscriptions.ts only stores invites whose `invitee` matches us, but the
  // sent-invites UI also reads `teamInvites`, so filter explicitly here.
  const incomingInvites = useMemo(() => {
    if (!myPlayerPda) return [];
    return Array.from(teamInvites.values()).filter((inv) =>
      inv.account.invitee.equals(myPlayerPda),
    );
  }, [teamInvites, myPlayerPda]);

  // Resolve inviter player PDA → wallet for the incoming invites (rent refund).
  const [inviterWallets, setInviterWallets] = useState<Map<string, PublicKey>>(new Map());
  useEffect(() => {
    if (incomingInvites.length === 0) return;
    const inviterPdas = incomingInvites.map((inv) => inv.account.inviter);
    const missing = inviterPdas.filter((p) => !inviterWallets.has(p.toBase58()));
    if (missing.length === 0) return;
    connection.getMultipleAccountsInfo(missing).then((infos) => {
      const next = new Map(inviterWallets);
      for (let i = 0; i < infos.length; i++) {
        const info = infos[i];
        if (!info) continue;
        const parsed = parsePlayer(info);
        if (parsed) next.set(missing[i].toBase58(), parsed.owner);
      }
      setInviterWallets(next);
    }).catch(() => {});
  }, [incomingInvites, connection]);

  // Accept an incoming invite — joins the inviting team at a free slot.
  // The inviting team's account + member slots are fetched here to derive a
  // free slot index, since the current player is not yet on that team.
  const handleAcceptInvite = async (
    inviteTeam: PublicKey,
    inviterRefund: PublicKey,
    reportPhase: (p: TxPhase) => void,
  ) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const inviteTeamInfo = await connection.getAccountInfo(inviteTeam);
    if (!inviteTeamInfo) throw new Error("Inviting team not found");
    const inviteTeamAccount = parseTeam(inviteTeamInfo);
    if (!inviteTeamAccount) throw new Error("Failed to parse inviting team");

    const slots = await client.fetchTeamMembers(inviteTeam);
    const usedSlots = new Set(slots.map((s) => s.account.slotIndex));
    let freeSlot = -1;
    for (let i = 0; i < inviteTeamAccount.maxMembers; i++) {
      if (!usedSlots.has(i)) { freeSlot = i; break; }
    }
    if (freeSlot < 0) throw new Error("Team is full");

    const ix = createTeamAcceptInviteInstruction({
      owner: publicKey,
      gameEngine: ge,
      team: inviteTeam,
      teamId: inviteTeamAccount.id.toNumber(),
      slotIndex: freeSlot,
      inviteRefund: inviterRefund,
    });
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["player"], ["team"], ["teamMembers"]],
      successMessage: "Invite accepted — joined team!",
      onPhase: reportPhase,
    }).then((r) => {
      useTransitionStore.getState().triggerActBeat({ act: 3, phase: "oath" });
      return r.signature;
    });
  };

  // Decline an incoming invite.
  const handleDeclineInvite = async (
    inviteTeam: PublicKey,
    inviterRefund: PublicKey,
    reportPhase: (p: TxPhase) => void,
  ) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const ix = createTeamDeclineInviteInstruction({
      owner: publicKey,
      gameEngine: ge,
      team: inviteTeam,
      inviterRefund,
    });
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["player"]],
      successMessage: "Invite declined.",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const [sidebarSection, setSidebarSection] = useState<"chat" | "treasury" | "settings">("chat");

  return (
    <div className="flex h-full flex-col gap-3">
      {/* No Team */}
      {!hasTeam && (
        <>
          <div className="card accent-border">
            <h3 className="mb-1 text-sm font-semibold text-text-primary">
              Raise your own banner.
            </h3>
            <p className="mb-4 text-xs text-text-muted">
              Name the House and others may swear their blades to it.
            </p>
            <div className="flex items-center gap-4">
              <input
                type="text"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                placeholder="House name..."
                className="flex-1 rounded-lg border border-zinc-800 bg-surface px-3 py-2 text-sm text-text-primary placeholder-text-muted"
                maxLength={32}
              />
              <TxButton onClick={handleCreate} disabled={!teamName.trim()}>
                Raise Banner
              </TxButton>
            </div>
          </div>

          {/* Incoming Invites */}
          {incomingInvites.length > 0 && (
            <div className="card">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
                Incoming Invites
              </h3>
              <div className="space-y-2">
                {incomingInvites.map((inv) => {
                  const inviterWallet = inviterWallets.get(inv.account.inviter.toBase58());
                  return (
                    <div
                      key={inv.pubkey.toBase58()}
                      className="flex items-center justify-between rounded-lg border border-zinc-800 px-3 py-2"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-text-muted">Invited by</span>
                        <span className="font-mono text-sm text-text-primary">
                          <DomainName pubkey={inv.account.inviter} chars={4} />
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <TxButton
                          onClick={(rp) => {
                            if (!inviterWallet) throw new Error("Inviter wallet not resolved yet");
                            return handleAcceptInvite(inv.account.team, inviterWallet, rp);
                          }}
                          variant="secondary"
                        >
                          Accept
                        </TxButton>
                        <TxButton
                          onClick={(rp) => {
                            if (!inviterWallet) throw new Error("Inviter wallet not resolved yet");
                            return handleDeclineInvite(inv.account.team, inviterWallet, rp);
                          }}
                          variant="danger"
                        >
                          Decline
                        </TxButton>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* Team exists — 2-column layout */}
      {team && (
        <>
          {/* Team header */}
          <div className="card accent-border">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-lg font-semibold text-text-primary">
                  {team.name || "My Team"}
                </div>
                <div className="text-xs text-text-muted">
                  Leader: <DomainName pubkey={team.leader} chars={4} />
                </div>
              </div>
              <div className="flex items-center gap-6">
                <div className="text-right">
                  <div className="text-xs text-text-muted">Treasury</div>
                  <GoldNumber value={team.treasury.toNumber()} prefix="$ " />
                </div>
                <div className="text-right">
                  <div className="text-xs text-text-muted">Members</div>
                  <GoldNumber value={team.memberCount} suffix={`/${team.maxMembers}`} />
                  {team.memberCount >= team.maxMembers && (
                    <span className="text-xs text-amber-400">Full</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Main area: left content + right sidebar */}
          <div className="min-h-0 flex-1 grid grid-cols-1 lg:grid-cols-3 gap-3 overflow-hidden">
            {/* Left — team info, MOTD, members (scrollable) */}
            <div className="lg:col-span-2 overflow-y-auto space-y-4">
              {/* MOTD */}
              <div className="card">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Message of the Day
                </h3>
                {team.motd ? (
                  <p className="mb-3 text-sm text-text-secondary">{team.motd}</p>
                ) : (
                  <p className="mb-3 text-sm text-text-muted italic">No message set</p>
                )}
                <div className="flex items-center gap-3">
                  <input
                    type="text"
                    value={motd}
                    onChange={(e) => setMotd(e.target.value)}
                    placeholder="Set new MOTD..."
                    className="flex-1 rounded-lg border border-zinc-800 bg-surface px-3 py-2 text-sm text-text-primary placeholder-text-muted"
                    maxLength={32}
                  />
                  <TxButton onClick={handleSetMotd} variant="secondary" disabled={!motd.trim()}>
                    Set MOTD
                  </TxButton>
                </div>
              </div>

              {/* Members */}
              <div className="card">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Members
                </h3>
                <div className="space-y-2">
                  {sortedMembers.map((m) => {
                    const memberPda = m.account.player;
                    const isCurrentPlayer = publicKey
                      ? derivePlayerPda(client.gameEngine, publicKey)[0].equals(memberPda)
                      : false;

                    return (
                      <div
                        key={m.pubkey.toBase58()}
                        className="flex items-center justify-between rounded-lg border border-zinc-800 px-3 py-2"
                      >
                        <div className="flex items-center gap-3">
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                              m.account.rank === 0
                                ? "bg-amber-900/40 text-text-gold"
                                : "bg-zinc-800 text-text-muted"
                            }`}
                          >
                            {RANK_LABELS[m.account.rank] ?? `Rank ${m.account.rank}`}
                          </span>
                          <span className="font-mono text-sm text-text-primary">
                            <DomainName pubkey={memberPda} chars={4} />
                          </span>
                          {isCurrentPlayer && (
                            <span className="text-xs text-text-gold">(you)</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          {getMemberLevel(memberPda) > 0 && (
                            <span className="text-xs text-text-muted">Lv {getMemberLevel(memberPda)}</span>
                          )}
                          {getMemberNetworth(memberPda) > 0 && (
                            <GoldNumber value={getMemberNetworth(memberPda)} size="sm" />
                          )}
                          {!isCurrentPlayer && myRank < m.account.rank && (
                            <>
                              {m.account.rank > 1 && (
                                <button
                                  onClick={() => handlePromote(m.account.slotIndex, m.account.rank)}
                                  className="text-xs text-green-400 hover:text-green-300"
                                >
                                  Promote
                                </button>
                              )}
                              {m.account.rank < 4 && (
                                <button
                                  onClick={() => handleDemote(m.account.slotIndex, m.account.rank)}
                                  className="text-xs text-amber-400 hover:text-amber-300"
                                >
                                  Demote
                                </button>
                              )}
                            </>
                          )}
                          {isLeader && !isCurrentPlayer && m.account.rank !== 0 && (
                            <>
                              <button
                                onClick={() => handleTransferLeadership(memberPda, m.account.slotIndex)}
                                className="text-xs text-blue-400 hover:text-blue-300"
                              >
                                Transfer Lead
                              </button>
                              <button
                                onClick={() => handleKick(memberPda, m.account.slotIndex, memberPda)}
                                className="text-xs text-red-400 hover:text-red-300"
                              >
                                Kick
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {sortedMembers.length === 0 && (
                    <p className="text-sm text-text-muted">No members found</p>
                  )}
                </div>
              </div>

              {/* Game Parameters */}
              {geData?.account && (() => {
                const gp = geData.account.gameplayConfig;
                const tiers = geData.account.subscriptionTiers;
                return (
                  <GameInfoPanel>
                    <InfoGrid items={[
                      { label: "Team Creation Cost", value: gp.teamCreationCost.toNumber().toLocaleString(), suffix: "NOVI", highlight: true },
                      ...tiers.map((t) => ({
                        label: `${t.name} Team Size`,
                        value: t.maxTeamMembers.toString(),
                      })),
                    ]} columns={2} />
                  </GameInfoPanel>
                );
              })()}
            </div>

            {/* Right — sidebar with tabbed sections */}
            <div className="hidden lg:flex lg:flex-col overflow-y-auto">
              <div className="sticky top-0 rounded-lg border border-border-default bg-surface-raised p-4 flex-1 space-y-4">
                {/* Section tabs */}
                <div className="flex gap-1 rounded-lg bg-surface/60 p-1">
                  {(["chat", "treasury", "settings"] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => setSidebarSection(s)}
                      className={`flex-1 rounded-md px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider transition-colors ${
                        sidebarSection === s
                          ? "bg-amber-900/30 text-text-gold"
                          : "text-text-muted hover:text-text-secondary"
                      }`}
                    >
                      {SIDEBAR_LABELS[s]}
                    </button>
                  ))}
                </div>

                {/* Chat (disabled) */}
                {sidebarSection === "chat" && (
                  <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                    <div className="text-2xl text-text-muted">&#128172;</div>
                    <p className="text-sm text-text-muted">Team chat coming soon</p>
                    <p className="text-[11px] text-text-muted">Coordinate with your team in real-time</p>
                  </div>
                )}

                {/* Treasury */}
                {sidebarSection === "treasury" && (
                  <div className="space-y-4">
                    {/* Balance */}
                    <div className="rounded-lg bg-surface/60 px-3 py-2 text-center">
                      <div className="text-[10px] text-text-muted">Treasury Balance</div>
                      <GoldNumber value={team.treasury.toNumber()} prefix="$ " />
                    </div>

                    {/* Deposit / Withdraw */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          value={depositAmount}
                          onChange={(e) => setDepositAmount(Math.max(0, parseInt(e.target.value) || 0))}
                          placeholder="Amount"
                          className="w-full rounded-lg border border-zinc-800 bg-surface px-3 py-2 text-sm text-text-primary"
                        />
                      </div>
                      {depositAmount > (player?.cashOnHand?.toNumber?.() ?? 0) && depositAmount > 0 && (
                        <p className="text-xs text-red-400">Exceeds cash on hand</p>
                      )}
                      <div className="grid grid-cols-2 gap-2">
                        <TxButton onClick={handleDeposit} variant="secondary" className="text-xs" disabled={depositAmount <= 0 || depositAmount > (player?.cashOnHand?.toNumber?.() ?? 0)}>
                          Deposit
                        </TxButton>
                        <TxButton onClick={handleWithdraw} variant="secondary" className="text-xs" disabled={withdrawAmount <= 0 || withdrawAmount > (team?.treasury?.toNumber?.() ?? 0)}>
                          Withdraw
                        </TxButton>
                      </div>
                    </div>

                    {/* Request Withdrawal */}
                    <div className="border-t border-border-default pt-3 space-y-2">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                        Request Withdrawal
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          value={requestWithdrawAmount}
                          onChange={(e) => setRequestWithdrawAmount(Math.max(0, parseInt(e.target.value) || 0))}
                          placeholder="Amount"
                          className="w-full rounded-lg border border-zinc-800 bg-surface px-3 py-2 text-sm text-text-primary"
                        />
                      </div>
                      <TxButton onClick={handleTreasuryRequestWithdraw} variant="secondary" className="w-full text-xs" disabled={requestWithdrawAmount <= 0 || !!myRequest}>
                        Request
                      </TxButton>
                      {/* Execute / Cancel reflect the caller's own request state */}
                      {myRequest && (
                        <div className="grid grid-cols-2 gap-2">
                          <TxButton
                            onClick={handleTreasuryExecute}
                            variant="secondary"
                            className="text-xs"
                            disabled={myRequest.account.executableAt.toNumber() > Math.floor(Date.now() / 1000)}
                          >
                            Execute
                          </TxButton>
                          <TxButton onClick={handleTreasuryCancel} variant="danger" className="text-xs">
                            Cancel
                          </TxButton>
                        </div>
                      )}
                    </div>

                    {/* Pending Treasury Requests */}
                    <TreasuryRequestsPanel
                      requests={pendingRequests}
                      onApprove={handleTreasuryApprove}
                      onReject={handleTreasuryReject}
                    />

                    {/* Treasury Settings (Leader Only) */}
                    {isLeader && (
                      <div className="border-t border-border-default pt-3">
                        <TreasurySettingsPanel
                          team={team}
                          onSave={handleUpdateTreasurySettings}
                          compact
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* Settings */}
                {sidebarSection === "settings" && (
                  <div className="space-y-4">
                    {/* Invite */}
                    <div className="space-y-2">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                        Invite Player
                      </div>
                      <input
                        type="text"
                        value={inviteAddress}
                        onChange={(e) => setInviteAddress(e.target.value)}
                        placeholder="Wallet address..."
                        className="w-full rounded-lg border border-zinc-800 bg-surface px-3 py-2 text-sm font-mono text-text-primary placeholder-text-muted"
                      />
                      {inviteAddress.trim() && !isValidInviteAddress && (
                        <p className="text-xs text-red-400">Invalid address</p>
                      )}
                      <TxButton onClick={handleInvite} variant="secondary" className="w-full text-xs" disabled={!isValidInviteAddress || (team?.memberCount ?? 0) >= (team?.maxMembers ?? 0)}>
                        Invite
                      </TxButton>
                    </div>

                    {/* Pending Invites */}
                    {Array.from(teamInvites.values()).length > 0 && (
                      <div className="space-y-2">
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                          Pending Invites
                        </div>
                        {Array.from(teamInvites.values()).map((inv) => (
                          <div
                            key={inv.pubkey.toBase58()}
                            className="flex items-center justify-between rounded-lg border border-zinc-800 px-3 py-2"
                          >
                            <span className="font-mono text-xs text-text-primary">
                              <DomainName pubkey={inv.account.invitee} chars={4} />
                            </span>
                            <button
                              onClick={() => handleCancelInvite(inv.account.invitee)}
                              className="text-xs text-red-400 hover:text-red-300"
                            >
                              Cancel
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Team Settings */}
                    {isOfficerPlus && (
                      <div className="border-t border-border-default pt-3">
                        <TeamSettingsPanel
                          team={team}
                          onSave={handleUpdateSettings}
                          compact
                        />
                      </div>
                    )}

                    {/* Domain Name (Leader Only) */}
                    {isLeader && (
                      <div className="border-t border-border-default pt-3 space-y-2">
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                          Domain Name
                        </div>
                        <DomainPicker
                          currentName={currentTeamDomainName}
                          isPending={transact.isPending}
                          onSet={handleTeamNameSet}
                          onRemove={handleTeamNameRemove}
                          label="team"
                        />
                      </div>
                    )}

                    {/* Leave / Disband */}
                    <div className="border-t border-border-default pt-3">
                      {!isLeader && (
                        <TxButton onClick={handleLeave} variant="danger" className="w-full">
                          Leave Team
                        </TxButton>
                      )}
                      {isLeader && (
                        <TxButton onClick={handleDisband} variant="danger" className="w-full">
                          Disband Team
                        </TxButton>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Mobile: same tabbed sidebar, shown below content */}
          <div className="lg:hidden rounded-lg border border-border-default bg-surface-raised p-4 space-y-4">
            {/* Section tabs */}
            <div className="flex gap-1 rounded-lg bg-surface/60 p-1">
              {(["chat", "treasury", "settings"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setSidebarSection(s)}
                  className={`flex-1 rounded-md px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider transition-colors ${
                    sidebarSection === s
                      ? "bg-amber-900/30 text-text-gold"
                      : "text-text-muted hover:text-text-secondary"
                  }`}
                >
                  {SIDEBAR_LABELS[s]}
                </button>
              ))}
            </div>

            {/* War-table (disabled) */}
            {sidebarSection === "chat" && (
              <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                <div className="text-2xl text-text-muted">&#128737;</div>
                <p className="text-sm text-text-muted">The war-table is not yet set</p>
                <p className="text-[11px] text-text-muted">
                  A place to read the map and plan the next move with your House
                </p>
              </div>
            )}

            {/* Treasury */}
            {sidebarSection === "treasury" && (
              <div className="space-y-4">
                <div className="rounded-lg bg-surface/60 px-3 py-2 text-center">
                  <div className="text-[10px] text-text-muted">Treasury Balance</div>
                  <GoldNumber value={team.treasury.toNumber()} prefix="$ " />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={depositAmount}
                      onChange={(e) => setDepositAmount(Math.max(0, parseInt(e.target.value) || 0))}
                      placeholder="Amount"
                      className="w-full rounded-lg border border-zinc-800 bg-surface px-3 py-2 text-sm text-text-primary"
                    />
                  </div>
                  {depositAmount > (player?.cashOnHand?.toNumber?.() ?? 0) && depositAmount > 0 && (
                    <p className="text-xs text-red-400">Exceeds cash on hand</p>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <TxButton onClick={handleDeposit} variant="secondary" className="text-xs" disabled={depositAmount <= 0 || depositAmount > (player?.cashOnHand?.toNumber?.() ?? 0)}>
                      Deposit
                    </TxButton>
                    <TxButton onClick={handleWithdraw} variant="secondary" className="text-xs" disabled={withdrawAmount <= 0 || withdrawAmount > (team?.treasury?.toNumber?.() ?? 0)}>
                      Withdraw
                    </TxButton>
                  </div>
                </div>

                <div className="border-t border-border-default pt-3 space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                    Request Withdrawal
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={requestWithdrawAmount}
                      onChange={(e) => setRequestWithdrawAmount(Math.max(0, parseInt(e.target.value) || 0))}
                      placeholder="Amount"
                      className="w-full rounded-lg border border-zinc-800 bg-surface px-3 py-2 text-sm text-text-primary"
                    />
                  </div>
                  <TxButton onClick={handleTreasuryRequestWithdraw} variant="secondary" className="w-full text-xs" disabled={requestWithdrawAmount <= 0 || !!myRequest}>
                    Request
                  </TxButton>
                  {/* Execute / Cancel reflect the caller's own request state */}
                  {myRequest && (
                    <div className="grid grid-cols-2 gap-2">
                      <TxButton
                        onClick={handleTreasuryExecute}
                        variant="secondary"
                        className="text-xs"
                        disabled={myRequest.account.executableAt.toNumber() > Math.floor(Date.now() / 1000)}
                      >
                        Execute
                      </TxButton>
                      <TxButton onClick={handleTreasuryCancel} variant="danger" className="text-xs">
                        Cancel
                      </TxButton>
                    </div>
                  )}
                </div>

                {/* Pending Treasury Requests */}
                <TreasuryRequestsPanel
                  requests={pendingRequests}
                  onApprove={handleTreasuryApprove}
                  onReject={handleTreasuryReject}
                />

                {isLeader && (
                  <div className="border-t border-border-default pt-3">
                    <TreasurySettingsPanel
                      team={team}
                      onSave={handleUpdateTreasurySettings}
                      compact
                    />
                  </div>
                )}
              </div>
            )}

            {/* Settings */}
            {sidebarSection === "settings" && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                    Invite Player
                  </div>
                  <input
                    type="text"
                    value={inviteAddress}
                    onChange={(e) => setInviteAddress(e.target.value)}
                    placeholder="Wallet address..."
                    className="w-full rounded-lg border border-zinc-800 bg-surface px-3 py-2 text-sm font-mono text-text-primary placeholder-text-muted"
                  />
                  {inviteAddress.trim() && !isValidInviteAddress && (
                    <p className="text-xs text-red-400">Invalid address</p>
                  )}
                  <TxButton onClick={handleInvite} variant="secondary" className="w-full text-xs" disabled={!isValidInviteAddress || (team?.memberCount ?? 0) >= (team?.maxMembers ?? 0)}>
                    Invite
                  </TxButton>
                </div>

                {Array.from(teamInvites.values()).length > 0 && (
                  <div className="space-y-2">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                      Pending Invites
                    </div>
                    {Array.from(teamInvites.values()).map((inv) => (
                      <div
                        key={inv.pubkey.toBase58()}
                        className="flex items-center justify-between rounded-lg border border-zinc-800 px-3 py-2"
                      >
                        <span className="font-mono text-xs text-text-primary">
                          <DomainName pubkey={inv.account.invitee} chars={4} />
                        </span>
                        <button
                          onClick={() => handleCancelInvite(inv.account.invitee)}
                          className="text-xs text-red-400 hover:text-red-300"
                        >
                          Cancel
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {isOfficerPlus && (
                  <div className="border-t border-border-default pt-3">
                    <TeamSettingsPanel
                      team={team}
                      onSave={handleUpdateSettings}
                      compact
                    />
                  </div>
                )}

                {isLeader && (
                  <div className="border-t border-border-default pt-3 space-y-2">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                      Domain Name
                    </div>
                    <DomainPicker
                      currentName={currentTeamDomainName}
                      isPending={transact.isPending}
                      onSet={handleTeamNameSet}
                      onRemove={handleTeamNameRemove}
                      label="team"
                    />
                  </div>
                )}

                <div className="border-t border-border-default pt-3">
                  {!isLeader && (
                    <TxButton onClick={handleLeave} variant="danger" className="w-full">
                      Leave Team
                    </TxButton>
                  )}
                  {isLeader && (
                    <TxButton onClick={handleDisband} variant="danger" className="w-full">
                      Disband Team
                    </TxButton>
                  )}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Team Settings Sub-Panel ────────────────────────────────

function TeamSettingsPanel({
  team,
  onSave,
  compact,
}: {
  team: { settings: number; minLevelToJoin: number };
  onSave: (isPublic: boolean, minLevel: number, reportPhase: (p: TxPhase) => void) => Promise<string>;
  compact?: boolean;
}) {
  const [isPublic, setIsPublic] = useState(() => (team.settings & 1) !== 0);
  const [minLevel, setMinLevel] = useState(() => team.minLevelToJoin);

  const handleSave = async (reportPhase: (p: TxPhase) => void) => {
    return onSave(isPublic, minLevel, reportPhase);
  };

  const content = (
    <div className="space-y-3">
      {!compact && (
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
          Team Settings
        </h3>
      )}
      {compact && (
        <div className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
          Team Settings
        </div>
      )}
      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={isPublic}
          onChange={(e) => setIsPublic(e.target.checked)}
          className="rounded border-zinc-700"
        />
        <span className="text-sm text-text-primary">Public (anyone can join)</span>
      </label>
      <div className="flex items-center gap-3">
        <label className="text-sm text-text-muted">Min Level:
          <input
            type="number"
            value={minLevel}
            onChange={(e) => setMinLevel(Math.max(1, Math.min(255, parseInt(e.target.value) || 1)))}
            className="w-20 rounded-lg border border-zinc-800 bg-surface px-3 py-2 text-sm text-text-primary"
            min={1}
            max={255}
          />
        </label>
      </div>
      <TxButton onClick={handleSave} variant="secondary" className={compact ? "w-full text-xs" : ""}>
        Save Settings
      </TxButton>
    </div>
  );

  if (compact) return content;
  return <div className="card">{content}</div>;
}

// ─── Treasury Settings Sub-Panel ────────────────────────────

function TreasurySettingsPanel({
  team,
  onSave,
  compact,
}: {
  team: {
    treasuryInstantLimit: { toNumber: () => number }[];
    treasuryDailyCap: { toNumber: () => number }[];
    treasuryCooldownHours: number;
  };
  onSave: (
    instantLimits: [number, number, number, number],
    dailyCaps: [number, number, number, number],
    cooldownHours: number,
    reportPhase: (p: TxPhase) => void,
  ) => Promise<string>;
  compact?: boolean;
}) {
  const [limits, setLimits] = useState<[number, number, number, number]>(() => [
    team.treasuryInstantLimit[0]?.toNumber() ?? 0,
    team.treasuryInstantLimit[1]?.toNumber() ?? 0,
    team.treasuryInstantLimit[2]?.toNumber() ?? 0,
    team.treasuryInstantLimit[3]?.toNumber() ?? 0,
  ]);
  const [caps, setCaps] = useState<[number, number, number, number]>(() => [
    team.treasuryDailyCap[0]?.toNumber() ?? 0,
    team.treasuryDailyCap[1]?.toNumber() ?? 0,
    team.treasuryDailyCap[2]?.toNumber() ?? 0,
    team.treasuryDailyCap[3]?.toNumber() ?? 0,
  ]);
  const [cooldown, setCooldown] = useState(team.treasuryCooldownHours);

  const RANK_NAMES = ["Co-Leader", "Officer", "Member", "Recruit"];

  const handleSave = async (reportPhase: (p: TxPhase) => void) => {
    return onSave(limits, caps, cooldown, reportPhase);
  };

  const content = (
    <div className="space-y-3">
      {compact ? (
        <div className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
          Treasury Settings
        </div>
      ) : (
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
          Treasury Settings
        </h3>
      )}
      <div className="grid grid-cols-3 gap-2 text-xs text-text-muted">
        <span>Rank</span>
        <span>Instant Limit</span>
        <span>Daily Cap</span>
      </div>
      {RANK_NAMES.map((name, i) => (
        <div key={name} className="grid grid-cols-3 gap-2 items-center">
          <span className={compact ? "text-xs text-text-primary" : "text-sm text-text-primary"}>{name}</span>
          <input
            type="number"
            value={limits[i]}
            onChange={(e) => {
              const next = [...limits] as [number, number, number, number];
              next[i] = Math.max(0, parseInt(e.target.value) || 0);
              setLimits(next);
            }}
            className="rounded-lg border border-zinc-800 bg-surface px-2 py-1 text-sm text-text-primary"
          />
          <input
            type="number"
            value={caps[i]}
            onChange={(e) => {
              const next = [...caps] as [number, number, number, number];
              next[i] = Math.max(0, parseInt(e.target.value) || 0);
              setCaps(next);
            }}
            className="rounded-lg border border-zinc-800 bg-surface px-2 py-1 text-sm text-text-primary"
          />
        </div>
      ))}
      <div className="flex items-center gap-3">
        <label className="text-sm text-text-muted">Cooldown (hours):
          <input
            type="number"
            value={cooldown}
            onChange={(e) => setCooldown(Math.max(1, Math.min(72, parseInt(e.target.value) || 1)))}
            className="w-20 rounded-lg border border-zinc-800 bg-surface px-3 py-2 text-sm text-text-primary"
            min={1}
            max={72}
          />
        </label>
      </div>
      <TxButton onClick={handleSave} variant="secondary" className={compact ? "w-full text-xs" : ""}>
        Save Treasury Settings
      </TxButton>
    </div>
  );

  if (compact) return content;
  return <div className="card">{content}</div>;
}

// ─── Pending Treasury Requests Sub-Panel ────────────────────

interface TreasuryRequestRow {
  pubkey: PublicKey;
  account: { requester: PublicKey; amount: { toNumber: () => number }; executableAt: { toNumber: () => number } };
  requesterPda: PublicKey;
  requesterSlotIndex: number | null;
  requesterWallet: PublicKey | null;
  isMine: boolean;
}

function TreasuryRequestsPanel({
  requests,
  onApprove,
  onReject,
}: {
  requests: TreasuryRequestRow[];
  onApprove: (
    requesterPlayer: PublicKey,
    requesterRefund: PublicKey,
    requesterSlotIndex: number,
  ) => Promise<string>;
  onReject: (requesterPlayer: PublicKey, requesterRefund: PublicKey) => Promise<string>;
}) {
  if (requests.length === 0) {
    return (
      <div className="border-t border-border-default pt-3 space-y-2">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
          Pending Requests
        </div>
        <p className="text-xs text-text-muted">No pending withdrawal requests.</p>
      </div>
    );
  }

  const nowSec = Math.floor(Date.now() / 1000);

  return (
    <div className="border-t border-border-default pt-3 space-y-2">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
        Pending Requests
      </div>
      {requests.map((r) => {
        const executableAt = r.account.executableAt.toNumber();
        const cooldownRemaining = Math.max(0, executableAt - nowSec);
        const ready = cooldownRemaining === 0;
        return (
          <div
            key={r.pubkey.toBase58()}
            className="rounded-lg border border-zinc-800 px-3 py-2 space-y-1"
          >
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs text-text-primary">
                <DomainName pubkey={r.requesterPda} chars={4} />
                {r.isMine && <span className="ml-1 text-text-gold">(you)</span>}
              </span>
              <GoldNumber value={r.account.amount.toNumber()} prefix="$ " size="sm" />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-text-muted">
                {ready ? "Ready to execute" : `Cooldown: ${formatTime(cooldownRemaining)}`}
              </span>
              {!r.isMine && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      if (!r.requesterWallet || r.requesterSlotIndex == null) return;
                      onApprove(r.requesterPda, r.requesterWallet, r.requesterSlotIndex);
                    }}
                    disabled={!r.requesterWallet || r.requesterSlotIndex == null}
                    className="text-xs text-green-400 hover:text-green-300 disabled:opacity-40"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => {
                      if (!r.requesterWallet) return;
                      onReject(r.requesterPda, r.requesterWallet);
                    }}
                    disabled={!r.requesterWallet}
                    className="text-xs text-red-400 hover:text-red-300 disabled:opacity-40"
                  >
                    Reject
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
