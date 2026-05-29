"use client";

import { useState, useMemo, useEffect } from "react";
import { MapPin } from "lucide-react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useTeam } from "@/lib/hooks/useTeam";
import { useTeamMembers } from "@/lib/hooks/useTeamMembers";
import {
  useIncomingInvites,
  useTeamMemberBackfill,
  useTreasuryRequests,
} from "@/lib/hooks/useTeamBackfills";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useWallet } from "@solana/wallet-adapter-react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useAccountStore } from "@/lib/store/accounts";
import { useTransitionStore } from "@/lib/store/transition";
import { GoldNumber } from "@/components/shared/GoldNumber";
import { GameIcon } from "@/components/shared/GameIcon";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { DomainName } from "@/components/shared/DomainName";
import { DomainPicker } from "@/components/shared/DomainPicker";
import { GameInfoPanel } from "@/components/shared/GameInfoPanel";
import { InfoGrid } from "@/components/shared/InfoGrid";
import { NumberField } from "@/components/shared/NumberField";
import { UnitGrid } from "@/components/shared/UnitGrid";
import { useGameEngine } from "@/lib/hooks/useGameEngine";
import { formatTime, shortenAddress } from "@/lib/utils";
import { useWorldPlayers } from "@/lib/hooks/world";
import { useDomainNames } from "@/lib/hooks/useDomainNames";
import { matchesPlayerQuery } from "@/lib/players";
import {
  derivePlayerPda,
  isNullPubkey,
  parsePlayer,
  parseTeam,
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
  calculateDefensivePower,
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

function formatStat(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(0)}k`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

const ACTION_TONES: Record<"primary" | "neutral" | "info" | "danger", string> = {
  primary: "border-border-gold/50 bg-accent/20 text-text-gold hover:bg-accent/40",
  neutral: "border-zinc-700 bg-surface text-text-secondary hover:bg-surface/70",
  info: "border-blue-500/40 bg-blue-500/10 text-blue-300 hover:bg-blue-500/20",
  danger: "border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20",
};

function ActionButton({
  tone,
  onClick,
  children,
  title,
}: {
  tone: keyof typeof ACTION_TONES;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${ACTION_TONES[tone]}`}
    >
      {children}
    </button>
  );
}

function Stat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className="flex flex-col items-end leading-tight">
      <span className="text-[9px] uppercase tracking-wider text-text-muted/70">{label}</span>
      <span
        className={`font-mono text-xs tabular-nums ${
          highlight ? "text-text-gold" : "text-text-secondary"
        }`}
      >
        {formatStat(value)}
      </span>
    </div>
  );
}

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
  const { connection } = useConnection();

  // On-demand RPC backfills (extracted to hooks): seed the member players,
  // treasury requests, and incoming invites the WS hasn't delivered to a
  // freshly loaded page. The tx-pending flag re-fires the request/invite
  // fetches around a transaction.
  useTeamMemberBackfill(members);
  useTreasuryRequests(teamData?.pubkey, members, transact.isPending);
  useIncomingInvites(transact.isPending);

  const [teamName, setTeamName] = useState("");
  const [depositAmount, setDepositAmount] = useState(0);
  const [withdrawAmount, setWithdrawAmount] = useState(0);
  const [motd, setMotd] = useState("");
  const [requestWithdrawAmount, setRequestWithdrawAmount] = useState(0);
  const [expandedSlot, setExpandedSlot] = useState<number | null>(null);

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Reinforce lives on /map now (RightPanel composer). Forward through the
  // map's deep-link entry so the action lands where every other entity
  // action does instead of a separate /team sub-route. We also pass city/
  // lat/long/player so the map drills into the recipient's city and pre-
  // selects them on the disc — landing on a blank realm and immediately
  // opening the composer is disorienting.
  const navigateToReinforce = (
    targetWallet: PublicKey | null,
    targetPlayerPda: PublicKey,
    cityId: number,
    lat: number,
    long: number,
  ) => {
    if (!targetWallet) return;
    const params = new URLSearchParams();
    params.set("openPanel", "reinforce-composer");
    params.set("targetWallet", targetWallet.toBase58());
    params.set("city", String(cityId));
    params.set("lat", String(lat));
    params.set("long", String(long));
    params.set("player", targetPlayerPda.toBase58());
    router.push(`/map?${params.toString()}`);
  };

  const navigateToMap = (cityId: number, lat: number, long: number, playerPda: PublicKey) => {
    const params = new URLSearchParams();
    params.set("city", String(cityId));
    params.set("lat", String(lat));
    params.set("long", String(long));
    params.set("player", playerPda.toBase58());
    router.push(`/map?${params.toString()}`);
  };

  const teamInvites = useAccountStore((s) => s.teamInvites);
  const treasuryRequests = useAccountStore((s) => s.treasuryRequests);

  // Player PDAs this team has already invited — excluded from the picker.
  const myTeamInvitePdas = useMemo(() => {
    const set = new Set<string>();
    if (!teamPubkey) return set;
    for (const inv of teamInvites.values()) {
      if (inv.account.team.equals(teamPubkey)) {
        set.add(inv.account.invitee.toBase58());
      }
    }
    return set;
  }, [teamInvites, teamPubkey]);

  const currentTeamDomainName = useMemo(() => {
    if (!team?.name?.includes(".")) return null;
    return team.name;
  }, [team]);

  const parsedTeamName = useMemo(() => {
    if (!currentTeamDomainName) return null;
    const dotIdx = currentTeamDomainName.indexOf(".");
    if (dotIdx === -1) return null;
    return {
      domain: currentTeamDomainName.slice(0, dotIdx),
      tld: currentTeamDomainName.slice(dotIdx + 1),
    };
  }, [currentTeamDomainName]);

  const handleCreate = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !teamName.trim()) throw new Error("Missing data");
    const ge = client.gameEngine;
    const teamIdNum = Date.now();
    const ix = createTeamCreateInstruction(
      { owner: publicKey, gameEngine: ge, teamId: teamIdNum },
      { name: teamName.trim() },
    );
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"], ["team"]],
        successMessage: `Team "${teamName.trim()}" created!`,
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
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
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"], ["team"], ["teamMembers"]],
        successMessage: "Left the team.",
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
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
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"], ["team"], ["teamMembers"]],
        successMessage: "Team disbanded.",
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  const handleDeposit = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !teamPubkey || !teamId || depositAmount <= 0)
      throw new Error("Invalid amount");
    const ge = client.gameEngine;
    const ix = createTeamDepositTreasuryInstruction(
      { owner: publicKey, gameEngine: ge, team: teamPubkey, teamId },
      { amount: depositAmount },
    );
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"], ["team"]],
        successMessage: `Deposited $${depositAmount} to treasury!`,
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  const handleWithdraw = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !teamPubkey || !teamId || !player || withdrawAmount <= 0)
      throw new Error("Invalid amount");
    const ge = client.gameEngine;
    const ix = createTeamWithdrawTreasuryInstruction(
      {
        owner: publicKey,
        gameEngine: ge,
        team: teamPubkey,
        teamId,
        slotIndex: player.teamSlotIndex,
      },
      { amount: withdrawAmount },
    );
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"], ["team"]],
        successMessage: `Withdrew $${withdrawAmount} from treasury!`,
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  const handleSetMotd = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !teamPubkey || !teamId || !player || !motd.trim())
      throw new Error("Missing data");
    const ge = client.gameEngine;
    const ix = createTeamSetMotdInstruction(
      {
        owner: publicKey,
        gameEngine: ge,
        team: teamPubkey,
        teamId,
        slotIndex: player.teamSlotIndex,
      },
      { motd: motd.trim() },
    );
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["team"]],
        successMessage: "MOTD updated!",
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  const handleInvite = async (inviteeWallet: PublicKey, reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !teamPubkey || !teamId || !player) throw new Error("Missing data");
    const ge = client.gameEngine;
    const [inviteePlayerPda] = derivePlayerPda(ge, inviteeWallet);
    const ix = createTeamInviteInstruction({
      inviter: publicKey,
      gameEngine: ge,
      team: teamPubkey,
      teamId,
      inviterSlotIndex: player.teamSlotIndex,
      inviteePlayer: inviteePlayerPda,
    });
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["team"]],
        successMessage: "Invite sent!",
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
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

  const handleKick = async (
    kickedPlayer: PublicKey,
    kickedSlotIndex: number,
    kickedOwner: PublicKey,
  ) => {
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
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["team"], ["teamMembers"]],
        successMessage: "Member kicked.",
      })
      .then((r) => r.signature);
  };

  const handlePromote = async (targetSlotIndex: number, currentRank: number) => {
    if (!publicKey || !teamPubkey || !teamId || !player) throw new Error("Missing data");
    const ge = client.gameEngine;
    const newRank = Math.max(1, currentRank - 1); // promote = lower rank number (but not 0=leader)
    const ix = createTeamPromoteMemberInstruction(
      {
        promoter: publicKey,
        gameEngine: ge,
        team: teamPubkey,
        teamId,
        promoterSlotIndex: player.teamSlotIndex,
        targetSlotIndex,
      },
      { newRank },
    );
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["team"], ["teamMembers"]],
        successMessage: `Member promoted to ${RANK_LABELS[newRank]}!`,
      })
      .then((r) => r.signature);
  };

  const handleDemote = async (targetSlotIndex: number, currentRank: number) => {
    if (!publicKey || !teamPubkey || !teamId || !player) throw new Error("Missing data");
    const ge = client.gameEngine;
    const newRank = Math.min(4, currentRank + 1); // demote = higher rank number
    const ix = createTeamDemoteMemberInstruction(
      {
        demoter: publicKey,
        gameEngine: ge,
        team: teamPubkey,
        teamId,
        demoterSlotIndex: player.teamSlotIndex,
        targetSlotIndex,
      },
      { newRank },
    );
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["team"], ["teamMembers"]],
        successMessage: `Member demoted to ${RANK_LABELS[newRank]}.`,
      })
      .then((r) => r.signature);
  };

  const handleTransferLeadership = async (newLeaderPlayer: PublicKey, newSlotIndex: number) => {
    if (!publicKey || !teamPubkey || !teamId || !player) throw new Error("Missing data");
    const ge = client.gameEngine;
    const ix = createTeamTransferLeadershipInstruction({
      leader: publicKey,
      gameEngine: ge,
      team: teamPubkey,
      teamId,
      currentSlotIndex: player.teamSlotIndex,
      newLeaderPlayer,
      newSlotIndex,
    });
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["team"], ["teamMembers"], ["player"]],
        successMessage: "Leadership transferred!",
      })
      .then((r) => r.signature);
  };

  const handleCancelInvite = async (inviteePlayer: PublicKey) => {
    if (!publicKey || !teamPubkey || !teamId || !player) throw new Error("Missing data");
    const ge = client.gameEngine;
    const ix = createTeamCancelInviteInstruction({
      member: publicKey,
      gameEngine: ge,
      team: teamPubkey,
      teamId,
      memberSlotIndex: player.teamSlotIndex,
      inviteePlayer,
    });
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["team"]],
        successMessage: "Invite cancelled.",
      })
      .then((r) => r.signature);
  };

  const handleUpdateSettings = async (
    isPublic: boolean,
    minLevel: number,
    reportPhase: (p: TxPhase) => void,
  ) => {
    if (!publicKey || !teamPubkey || !teamId || !player) throw new Error("Missing data");
    const ge = client.gameEngine;
    const settings = isPublic ? 1 : 0; // bit 0 = PUBLIC
    const ix = createTeamUpdateSettingsInstruction(
      {
        member: publicKey,
        gameEngine: ge,
        team: teamPubkey,
        teamId,
        slotIndex: player.teamSlotIndex,
      },
      { settings, minLevelToJoin: minLevel },
    );
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["team"]],
        successMessage: "Team settings updated!",
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  const handleTreasuryRequestWithdraw = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !teamPubkey || !teamId || !player || requestWithdrawAmount <= 0)
      throw new Error("Invalid amount");
    const ge = client.gameEngine;
    const ix = createTeamTreasuryRequestWithdrawInstruction(
      {
        owner: publicKey,
        gameEngine: ge,
        team: teamPubkey,
        teamId,
        slotIndex: player.teamSlotIndex,
      },
      { amount: requestWithdrawAmount },
    );
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["team"]],
        successMessage: `Withdrawal of $${requestWithdrawAmount} requested!`,
        onPhase: reportPhase,
      })
      .then((r) => {
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
      approver: publicKey,
      gameEngine: ge,
      team: teamPubkey,
      teamId,
      approverSlotIndex: player.teamSlotIndex,
      requesterSlotIndex,
      requesterPlayer,
      requesterRefund,
    });
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["team"]],
        successMessage: "Request approved!",
      })
      .then((r) => r.signature);
  };

  const handleTreasuryReject = async (requesterPlayer: PublicKey, requesterRefund: PublicKey) => {
    if (!publicKey || !teamPubkey || !teamId || !player) throw new Error("Missing data");
    const ge = client.gameEngine;
    const ix = createTeamTreasuryRejectRequestInstruction({
      rejecter: publicKey,
      gameEngine: ge,
      team: teamPubkey,
      teamId,
      rejecterSlotIndex: player.teamSlotIndex,
      requesterPlayer,
      requesterRefund,
    });
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["team"]],
        successMessage: "Request rejected.",
      })
      .then((r) => r.signature);
  };

  const handleTreasuryExecute = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !teamPubkey || !teamId || !player) throw new Error("Missing data");
    const ge = client.gameEngine;
    const ix = createTeamTreasuryExecuteRequestInstruction({
      owner: publicKey,
      gameEngine: ge,
      team: teamPubkey,
      teamId,
      slotIndex: player.teamSlotIndex,
    });
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["team"], ["player"]],
        successMessage: "Withdrawal executed!",
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  const handleTreasuryCancel = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !teamPubkey || !teamId) throw new Error("Missing data");
    const ge = client.gameEngine;
    const ix = createTeamTreasuryCancelRequestInstruction({
      owner: publicKey,
      gameEngine: ge,
      team: teamPubkey,
      teamId,
    });
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["team"]],
        successMessage: "Withdrawal request cancelled.",
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
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
      {
        leader: publicKey,
        gameEngine: ge,
        team: teamPubkey,
        teamId,
        slotIndex: player.teamSlotIndex,
      },
      { instantLimits, dailyCaps, cooldownHours },
    );
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["team"]],
        successMessage: "Treasury settings updated!",
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  const getMemberAccount = (playerPda: PublicKey) =>
    otherPlayers.get(playerPda.toBase58())?.account ?? null;

  const getMemberNetworth = (playerPda: PublicKey): number =>
    getMemberAccount(playerPda)?.networth?.toNumber?.() ?? 0;

  const getMemberLevel = (playerPda: PublicKey): number => getMemberAccount(playerPda)?.level ?? 0;

  const getMemberName = (playerPda: PublicKey): string =>
    getMemberAccount(playerPda)?.name?.trim() || "";

  const getMemberPower = (playerPda: PublicKey): number => {
    const p = getMemberAccount(playerPda);
    if (!p) return 0;
    return calculateDefensivePower(
      p.defensiveUnit1.toNumber(),
      p.defensiveUnit2.toNumber(),
      p.defensiveUnit3.toNumber(),
    );
  };

  const getMemberDefensiveUnits = (playerPda: PublicKey): number => {
    const p = getMemberAccount(playerPda);
    if (!p) return 0;
    return p.defensiveUnit1.toNumber() + p.defensiveUnit2.toNumber() + p.defensiveUnit3.toNumber();
  };

  const getMemberOffensiveUnits = (playerPda: PublicKey): number => {
    const p = getMemberAccount(playerPda);
    if (!p) return 0;
    return p.operativeUnit1.toNumber() + p.operativeUnit2.toNumber() + p.operativeUnit3.toNumber();
  };

  const getMemberReinforcements = (playerPda: PublicKey): number => {
    const p = getMemberAccount(playerPda);
    if (!p) return 0;
    return (
      p.reinforcementDef1.toNumber() +
      p.reinforcementDef2.toNumber() +
      p.reinforcementDef3.toNumber()
    );
  };

  // Outstanding invites this team has sent — shown under the members list so
  // leaders see who's been asked and can cancel.
  const pendingInvites = useMemo(() => {
    if (!teamPubkey) return [];
    return Array.from(teamInvites.values()).filter((inv) => inv.account.team.equals(teamPubkey));
  }, [teamInvites, teamPubkey]);

  // Sort by combat power desc, with networth and slotIndex as stable tiebreakers
  // so equal-power members don't reshuffle every render.
  const sortedMembers = useMemo(() => {
    if (!members) return [];
    return [...members].sort((a, b) => {
      const pa = getMemberPower(a.account.player);
      const pb = getMemberPower(b.account.player);
      if (pa !== pb) return pb - pa;
      const na = getMemberNetworth(a.account.player);
      const nb = getMemberNetworth(b.account.player);
      if (na !== nb) return nb - na;
      return a.account.slotIndex - b.account.slotIndex;
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
        const requesterWallet = otherPlayers.get(requesterPda.toBase58())?.account?.owner ?? null;
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

  const myRequest = useMemo(() => pendingRequests.find((r) => r.isMine) ?? null, [pendingRequests]);

  // Incoming team invites addressed to the current player.
  // subscriptions.ts only stores invites whose `invitee` matches us, but the
  // sent-invites UI also reads `teamInvites`, so filter explicitly here.
  const incomingInvites = useMemo(() => {
    if (!myPlayerPda) return [];
    return Array.from(teamInvites.values()).filter((inv) =>
      inv.account.invitee.equals(myPlayerPda),
    );
  }, [teamInvites, myPlayerPda]);

  // Resolve inviter player PDA to wallet for the incoming invites (rent refund).
  const [inviterWallets, setInviterWallets] = useState<Map<string, PublicKey>>(new Map());
  useEffect(() => {
    if (incomingInvites.length === 0) return;
    const inviterPdas = incomingInvites.map((inv) => inv.account.inviter);
    const missing = inviterPdas.filter((p) => !inviterWallets.has(p.toBase58()));
    if (missing.length === 0) return;
    connection
      .getMultipleAccountsInfo(missing)
      .then((infos) => {
        const next = new Map(inviterWallets);
        for (let i = 0; i < infos.length; i++) {
          const info = infos[i];
          if (!info) continue;
          const parsed = parsePlayer(info);
          if (parsed) next.set(missing[i].toBase58(), parsed.owner);
        }
        setInviterWallets(next);
      })
      .catch(() => {});
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
      if (!usedSlots.has(i)) {
        freeSlot = i;
        break;
      }
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
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"], ["team"], ["teamMembers"]],
        successMessage: "Invite accepted — joined team!",
        onPhase: reportPhase,
      })
      .then((r) => {
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
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"]],
        successMessage: "Invite declined.",
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  const [sidebarSection, setSidebarSection] = useState<"chat" | "treasury" | "settings">("chat");

  return (
    <div className="flex h-full flex-col gap-3">
      {/* No Team */}
      {!hasTeam && (
        <>
          <div className="card accent-border">
            <h3 className="mb-1 text-sm font-semibold text-text-primary">Raise your own banner.</h3>
            <p className="mb-4 text-xs text-text-muted">
              Name the House and others may swear their blades to it.
            </p>
            <div className="flex items-center gap-4 flex-col">
              <input
                type="text"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                placeholder="House name..."
                className="w-full rounded-lg border border-zinc-800 bg-surface px-3 py-2 text-sm text-text-primary placeholder-text-muted"
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
                  <span className="inline-flex items-center gap-1">
                    <GameIcon id="resource-cash" size={14} />
                    <GoldNumber value={team.treasury.toNumber()} />
                  </span>
                </div>
                <div className="text-right">
                  <div className="text-xs text-text-muted">Members</div>
                  <GoldNumber value={team.memberCount} suffix={`/${team.maxMembers}`} />
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
                <div className="flex items-center gap-3 flex-col">
                  <input
                    type="text"
                    value={motd}
                    onChange={(e) => setMotd(e.target.value)}
                    placeholder="Set new MOTD..."
                    className="w-full rounded-lg border border-zinc-800 bg-surface px-3 py-2 text-sm text-text-primary placeholder-text-muted"
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
                    const memberAccount = getMemberAccount(memberPda);
                    const isCurrentPlayer = publicKey
                      ? derivePlayerPda(client.gameEngine, publicKey)[0].equals(memberPda)
                      : false;
                    const displayName = getMemberName(memberPda);
                    const level = getMemberLevel(memberPda);
                    const power = getMemberPower(memberPda);
                    const du = getMemberDefensiveUnits(memberPda);
                    const op = getMemberOffensiveUnits(memberPda);
                    const reinf = getMemberReinforcements(memberPda);
                    const isExpanded = expandedSlot === m.account.slotIndex;

                    const canPromote =
                      !isCurrentPlayer && myRank < m.account.rank && m.account.rank > 1;
                    const canDemote =
                      !isCurrentPlayer && myRank < m.account.rank && m.account.rank < 4;
                    const canKick = isLeader && !isCurrentPlayer && m.account.rank !== 0;
                    const canTransfer = isLeader && !isCurrentPlayer && m.account.rank !== 0;
                    const canReinforce = !isCurrentPlayer && !!memberAccount?.owner;

                    return (
                      <div
                        key={m.pubkey.toBase58()}
                        className={`rounded-lg border transition-colors ${
                          isExpanded
                            ? "border-border-gold/50 bg-surface/30"
                            : "border-zinc-800 hover:border-zinc-700"
                        }`}
                      >
                        {/* Collapsed header — full row is a tap target */}
                        <button
                          type="button"
                          onClick={() => setExpandedSlot(isExpanded ? null : m.account.slotIndex)}
                          className="flex w-full flex-col gap-2 px-3 py-2 text-left sm:flex-row sm:items-center sm:justify-between sm:gap-3"
                          aria-expanded={isExpanded}
                        >
                          {/* Identity */}
                          <div className="flex min-w-0 flex-1 items-center gap-2">
                            <div className="flex min-w-0 flex-col">
                              <div className="flex flex-wrap items-center gap-2">
                                {displayName ? (
                                  <span className="truncate text-sm text-text-primary">
                                    {displayName}
                                  </span>
                                ) : (
                                  <span className="font-mono text-sm text-text-primary">
                                    <DomainName pubkey={memberPda} chars={4} />
                                  </span>
                                )}
                                {level > 0 && (
                                  <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-semibold text-text-muted">
                                    Lv {level}
                                  </span>
                                )}
                                <span
                                  className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                                    m.account.rank === 0
                                      ? "bg-accent/40 text-text-gold"
                                      : "bg-zinc-800 text-text-muted"
                                  }`}
                                >
                                  {RANK_LABELS[m.account.rank] ?? `Rank ${m.account.rank}`}
                                </span>
                                {isCurrentPlayer && (
                                  <span className="text-xs text-text-gold">(you)</span>
                                )}
                              </div>
                              {displayName && (
                                <span className="font-mono text-[10px] text-text-muted">
                                  <DomainName pubkey={memberPda} chars={4} />
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Stats — always visible, wraps on mobile */}
                          <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-[11px] text-text-muted">
                            <Stat label="PWR" value={power} highlight />
                            <Stat label="DU" value={du} />
                            <Stat label="OP" value={op} />
                            <Stat label="REINF" value={reinf} />
                            <span
                              className={`ml-1 text-text-muted transition-transform ${
                                isExpanded ? "rotate-180" : ""
                              }`}
                              aria-hidden
                            >
                              &#9662;
                            </span>
                          </div>
                        </button>

                        {/* Expanded body — unit breakdown + actions */}
                        {isExpanded && memberAccount && (
                          <div className="space-y-3 border-t border-zinc-800 px-3 py-3">
                            <UnitGrid
                              defense={[
                                memberAccount.defensiveUnit1.toNumber(),
                                memberAccount.defensiveUnit2.toNumber(),
                                memberAccount.defensiveUnit3.toNumber(),
                              ]}
                              offense={[
                                memberAccount.operativeUnit1.toNumber(),
                                memberAccount.operativeUnit2.toNumber(),
                                memberAccount.operativeUnit3.toNumber(),
                              ]}
                            />

                            {reinf > 0 && (
                              <div className="rounded-md border border-zinc-800 px-3 py-2">
                                <div className="mb-1 text-[10px] uppercase tracking-wider text-text-muted">
                                  Reinforcements held
                                </div>
                                <div className="grid grid-cols-3 gap-2 text-xs">
                                  <span>
                                    <span className="text-text-muted">T1 </span>
                                    <span className="game-num">
                                      {memberAccount.reinforcementDef1.toNumber().toLocaleString()}
                                    </span>
                                  </span>
                                  <span>
                                    <span className="text-text-muted">T2 </span>
                                    <span className="game-num">
                                      {memberAccount.reinforcementDef2.toNumber().toLocaleString()}
                                    </span>
                                  </span>
                                  <span>
                                    <span className="text-text-muted">T3 </span>
                                    <span className="game-num">
                                      {memberAccount.reinforcementDef3.toNumber().toLocaleString()}
                                    </span>
                                  </span>
                                </div>
                              </div>
                            )}

                            <div className="flex flex-wrap gap-2 border-t border-zinc-800 pt-3">
                              <ActionButton
                                tone="neutral"
                                onClick={() =>
                                  navigateToMap(
                                    memberAccount.currentCity,
                                    memberAccount.currentLat,
                                    memberAccount.currentLong,
                                    memberPda,
                                  )
                                }
                                title="Locate"
                              >
                                <MapPin className="h-3.5 w-3.5" />
                                <span className="hidden sm:inline">Locate</span>
                              </ActionButton>
                              {canReinforce && (
                                <ActionButton
                                  tone="primary"
                                  onClick={() =>
                                    navigateToReinforce(
                                      memberAccount.owner,
                                      memberPda,
                                      memberAccount.currentCity,
                                      memberAccount.currentLat,
                                      memberAccount.currentLong,
                                    )
                                  }
                                >
                                  Reinforce
                                </ActionButton>
                              )}
                              {canPromote && (
                                <ActionButton
                                  tone="primary"
                                  onClick={() => handlePromote(m.account.slotIndex, m.account.rank)}
                                >
                                  Promote
                                </ActionButton>
                              )}
                              {canDemote && (
                                <ActionButton
                                  tone="neutral"
                                  onClick={() => handleDemote(m.account.slotIndex, m.account.rank)}
                                >
                                  Demote
                                </ActionButton>
                              )}
                              {canTransfer && (
                                <ActionButton
                                  tone="info"
                                  onClick={() =>
                                    handleTransferLeadership(memberPda, m.account.slotIndex)
                                  }
                                >
                                  Transfer Lead
                                </ActionButton>
                              )}
                              {canKick && (
                                <ActionButton
                                  tone="danger"
                                  onClick={() =>
                                    handleKick(memberPda, m.account.slotIndex, memberPda)
                                  }
                                >
                                  Kick
                                </ActionButton>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {sortedMembers.length === 0 && (
                    <p className="text-sm text-text-muted">No members found</p>
                  )}
                </div>

                {/* Pending invites (visible to leader/officers who can cancel). */}
                {pendingInvites.length > 0 && (
                  <div className="mt-4 space-y-2">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                      Pending Invites ({pendingInvites.length})
                    </div>
                    {pendingInvites.map((inv) => (
                      <div
                        key={inv.pubkey.toBase58()}
                        className="flex items-center justify-between rounded-lg border border-dashed border-zinc-800 px-3 py-2"
                      >
                        <div className="flex items-center gap-2">
                          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-text-muted">
                            Invited
                          </span>
                          <span className="font-mono text-xs text-text-primary">
                            <DomainName pubkey={inv.account.invitee} chars={4} />
                          </span>
                        </div>
                        {isOfficerPlus && (
                          <button
                            onClick={() => handleCancelInvite(inv.account.invitee)}
                            className="text-xs text-red-400 hover:text-red-300"
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Game Parameters */}
              {geData?.account &&
                (() => {
                  const gp = geData.account.gameplayConfig;
                  const tiers = geData.account.subscriptionTiers;
                  return (
                    <GameInfoPanel>
                      <InfoGrid
                        items={[
                          {
                            label: "Team Creation Cost",
                            value: gp.teamCreationCost.toNumber().toLocaleString(),
                            suffix: "NOVI",
                            highlight: true,
                          },
                          ...tiers.map((t) => ({
                            label: `${t.name} Team Size`,
                            value: t.maxTeamMembers.toString(),
                          })),
                        ]}
                        columns={2}
                      />
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
                          ? "bg-accent/30 text-text-gold"
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
                    <p className="text-[11px] text-text-muted">
                      Coordinate with your team in real-time
                    </p>
                  </div>
                )}

                {/* Treasury */}
                {sidebarSection === "treasury" && (
                  <div className="space-y-4">
                    {/* Balance */}
                    <div className="rounded-lg bg-surface/60 px-3 py-2 text-center">
                      <div className="text-[10px] text-text-muted">Treasury Balance</div>
                      <span className="inline-flex items-center gap-1">
                        <GameIcon id="resource-cash" size={14} />
                        <GoldNumber value={team.treasury.toNumber()} />
                      </span>
                    </div>

                    {/* Deposit / Withdraw */}
                    <div className="space-y-2">
                      <NumberField
                        label="Amount"
                        value={depositAmount}
                        onChange={setDepositAmount}
                        min={0}
                        max={player?.cashOnHand?.toNumber?.() ?? 0}
                      />
                      {depositAmount > (player?.cashOnHand?.toNumber?.() ?? 0) &&
                        depositAmount > 0 && (
                          <p className="text-xs text-red-400">Exceeds cash on hand</p>
                        )}
                      <div className="grid grid-cols-2 gap-2">
                        <TxButton
                          onClick={handleDeposit}
                          variant="secondary"
                          className="text-xs"
                          disabled={
                            depositAmount <= 0 ||
                            depositAmount > (player?.cashOnHand?.toNumber?.() ?? 0)
                          }
                        >
                          Deposit
                        </TxButton>
                        <TxButton
                          onClick={handleWithdraw}
                          variant="secondary"
                          className="text-xs"
                          disabled={
                            withdrawAmount <= 0 ||
                            withdrawAmount > (team?.treasury?.toNumber?.() ?? 0)
                          }
                        >
                          Withdraw
                        </TxButton>
                      </div>
                    </div>

                    {/* Request Withdrawal */}
                    <div className="border-t border-border-default pt-3 space-y-2">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                        Request Withdrawal
                      </div>
                      <NumberField
                        label="Amount"
                        value={requestWithdrawAmount}
                        onChange={setRequestWithdrawAmount}
                        min={0}
                        max={team.treasury.toNumber()}
                      />
                      <TxButton
                        onClick={handleTreasuryRequestWithdraw}
                        variant="secondary"
                        className="w-full text-xs"
                        disabled={requestWithdrawAmount <= 0 || !!myRequest}
                      >
                        Request
                      </TxButton>
                      {/* Execute / Cancel reflect the caller's own request state */}
                      {myRequest && (
                        <div className="grid grid-cols-2 gap-2">
                          <TxButton
                            onClick={handleTreasuryExecute}
                            variant="secondary"
                            className="text-xs"
                            disabled={
                              myRequest.account.executableAt.toNumber() >
                              Math.floor(Date.now() / 1000)
                            }
                          >
                            Execute
                          </TxButton>
                          <TxButton
                            onClick={handleTreasuryCancel}
                            variant="danger"
                            className="text-xs"
                          >
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
                    <InvitePlayerPanel
                      teamFull={(team?.memberCount ?? 0) >= (team?.maxMembers ?? 0)}
                      invitedPdas={myTeamInvitePdas}
                      gameEngine={client.gameEngine}
                      selfWallet={publicKey}
                      onInvite={handleInvite}
                    />

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
                        <TeamSettingsPanel team={team} onSave={handleUpdateSettings} compact />
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
                      ? "bg-accent/30 text-text-gold"
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
                  <span className="inline-flex items-center gap-1">
                    <GameIcon id="resource-cash" size={14} />
                    <GoldNumber value={team.treasury.toNumber()} />
                  </span>
                </div>

                <div className="space-y-2">
                  <NumberField
                    label="Amount"
                    value={depositAmount}
                    onChange={setDepositAmount}
                    min={0}
                    max={player?.cashOnHand?.toNumber?.() ?? 0}
                  />
                  {depositAmount > (player?.cashOnHand?.toNumber?.() ?? 0) && depositAmount > 0 && (
                    <p className="text-xs text-red-400">Exceeds cash on hand</p>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <TxButton
                      onClick={handleDeposit}
                      variant="secondary"
                      className="text-xs"
                      disabled={
                        depositAmount <= 0 ||
                        depositAmount > (player?.cashOnHand?.toNumber?.() ?? 0)
                      }
                    >
                      Deposit
                    </TxButton>
                    <TxButton
                      onClick={handleWithdraw}
                      variant="secondary"
                      className="text-xs"
                      disabled={
                        withdrawAmount <= 0 || withdrawAmount > (team?.treasury?.toNumber?.() ?? 0)
                      }
                    >
                      Withdraw
                    </TxButton>
                  </div>
                </div>

                <div className="border-t border-border-default pt-3 space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                    Request Withdrawal
                  </div>
                  <NumberField
                    label="Amount"
                    value={requestWithdrawAmount}
                    onChange={setRequestWithdrawAmount}
                    min={0}
                    max={team.treasury.toNumber()}
                  />
                  <TxButton
                    onClick={handleTreasuryRequestWithdraw}
                    variant="secondary"
                    className="w-full text-xs"
                    disabled={requestWithdrawAmount <= 0 || !!myRequest}
                  >
                    Request
                  </TxButton>
                  {/* Execute / Cancel reflect the caller's own request state */}
                  {myRequest && (
                    <div className="grid grid-cols-2 gap-2">
                      <TxButton
                        onClick={handleTreasuryExecute}
                        variant="secondary"
                        className="text-xs"
                        disabled={
                          myRequest.account.executableAt.toNumber() > Math.floor(Date.now() / 1000)
                        }
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
                <InvitePlayerPanel
                  teamFull={(team?.memberCount ?? 0) >= (team?.maxMembers ?? 0)}
                  invitedPdas={myTeamInvitePdas}
                  gameEngine={client.gameEngine}
                  selfWallet={publicKey}
                  onInvite={handleInvite}
                />

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
                    <TeamSettingsPanel team={team} onSave={handleUpdateSettings} compact />
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

/**
 * Searchable player picker for team invites. Replaces hand-typing a 44-char
 * wallet address: filter every player by name / domain / address, one tap to
 * invite. Yourself, players already on a team, and players this team has
 * already invited are excluded; a pasted address still works for accounts not
 * yet in the directory.
 */
function InvitePlayerPanel({
  teamFull,
  invitedPdas,
  gameEngine,
  selfWallet,
  onInvite,
}: {
  teamFull: boolean;
  invitedPdas: Set<string>;
  gameEngine: PublicKey;
  selfWallet: PublicKey | null;
  onInvite: (wallet: PublicKey, reportPhase: (p: TxPhase) => void) => Promise<string>;
}) {
  const { data: players } = useWorldPlayers();
  const [query, setQuery] = useState("");

  const owners = useMemo(() => (players ?? []).map((p) => p.account.owner), [players]);
  const domains = useDomainNames(owners);
  const knownOwners = useMemo(() => new Set(owners.map((o) => o.toBase58())), [owners]);

  const candidates = useMemo(() => {
    if (!players) return [];
    const selfStr = selfWallet?.toBase58();
    const matched = players.filter((p) => {
      const addr = p.account.owner.toBase58();
      if (addr === selfStr) return false;
      if (!isNullPubkey(p.account.team)) return false;
      return matchesPlayerQuery(p.account, addr, domains.get(addr), query);
    });
    // Derive PDAs only for the few we'll show, to drop already-invited players.
    const result: typeof matched = [];
    for (const p of matched) {
      if (invitedPdas.size > 0) {
        const [pda] = derivePlayerPda(gameEngine, p.account.owner);
        if (invitedPdas.has(pda.toBase58())) continue;
      }
      result.push(p);
      if (result.length >= 8) break;
    }
    return result;
  }, [players, query, domains, invitedPdas, gameEngine, selfWallet]);

  // A pasted wallet address still works for accounts not in the directory yet.
  const pastedWallet = useMemo(() => {
    const q = query.trim();
    if (q.length < 32) return null;
    try {
      return new PublicKey(q);
    } catch {
      return null;
    }
  }, [query]);
  const showPasted = !!pastedWallet && !knownOwners.has(pastedWallet.toBase58());

  return (
    <div className="space-y-2">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
        Invite Player
      </div>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by name, domain, or address..."
        className="w-full rounded-lg border border-zinc-800 bg-surface px-3 py-2 text-sm text-text-primary placeholder-text-muted"
      />

      {teamFull ? (
        <p className="text-xs text-danger">Your House is full — free a slot before inviting.</p>
      ) : !players ? (
        <p className="text-xs text-text-muted">Loading players...</p>
      ) : (
        <div className="space-y-1">
          {candidates.map((p) => {
            const addr = p.account.owner.toBase58();
            const label = p.account.name || domains.get(addr) || shortenAddress(addr, 4);
            return (
              <div
                key={addr}
                className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800 px-3 py-1.5"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm text-text-primary">{label}</div>
                  <div className="text-[10px] text-text-muted">Lv {p.account.level}</div>
                </div>
                <TxButton
                  onClick={(rp) => onInvite(p.account.owner, rp)}
                  variant="secondary"
                  className="shrink-0 text-xs w-24"
                >
                  Invite
                </TxButton>
              </div>
            );
          })}

          {showPasted && pastedWallet && (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800 px-3 py-1.5">
              <span className="truncate font-mono text-xs text-text-primary">
                {shortenAddress(pastedWallet.toBase58(), 6)}
              </span>
              <TxButton
                onClick={(rp) => onInvite(pastedWallet, rp)}
                variant="secondary"
                className="shrink-0 text-xs"
              >
                Invite
              </TxButton>
            </div>
          )}

          {candidates.length === 0 && !showPasted && (
            <p className="text-xs text-text-muted">
              {query.trim() ? "No players match that search." : "No players available to invite."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function TeamSettingsPanel({
  team,
  onSave,
  compact,
}: {
  team: { settings: number; minLevelToJoin: number };
  onSave: (
    isPublic: boolean,
    minLevel: number,
    reportPhase: (p: TxPhase) => void,
  ) => Promise<string>;
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
      <button
        type="button"
        role="switch"
        aria-checked={isPublic}
        onClick={() => setIsPublic(!isPublic)}
        className="flex w-full items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-surface px-3 py-2 text-left transition-colors hover:border-zinc-700"
      >
        <span className="flex flex-col">
          <span className="text-sm font-medium text-text-primary">Public</span>
          <span className="text-[11px] text-text-muted">Anyone can join without an invite</span>
        </span>
        <span
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors ${
            isPublic ? "border-border-gold/60 bg-accent/50" : "border-zinc-700 bg-surface-raised"
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full shadow transition-transform ${
              isPublic ? "translate-x-6 bg-text-gold" : "translate-x-1 bg-text-muted"
            }`}
          />
        </span>
      </button>
      <NumberField label="Min Level" value={minLevel} onChange={setMinLevel} min={1} max={255} />
      <TxButton
        onClick={handleSave}
        variant="secondary"
        className={compact ? "w-full text-xs" : ""}
      >
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
    treasury: { toNumber: () => number };
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
      {RANK_NAMES.map((name, i) => (
        <div
          key={name}
          className="space-y-2 border-t border-border-default pt-2 first:border-t-0 first:pt-0"
        >
          <span
            className={
              compact
                ? "text-xs font-semibold text-text-primary"
                : "text-sm font-semibold text-text-primary"
            }
          >
            {name}
          </span>
          <NumberField
            label="Instant Limit"
            value={limits[i]}
            onChange={(next) => {
              const updated = [...limits] as [number, number, number, number];
              updated[i] = next;
              setLimits(updated);
            }}
            min={0}
            max={team.treasury.toNumber()}
          />
          <NumberField
            label="Daily Cap"
            value={caps[i]}
            onChange={(next) => {
              const updated = [...caps] as [number, number, number, number];
              updated[i] = next;
              setCaps(updated);
            }}
            min={0}
            max={team.treasury.toNumber()}
          />
        </div>
      ))}
      <NumberField
        label="Cooldown (hours)"
        value={cooldown}
        onChange={setCooldown}
        min={1}
        max={72}
      />
      <TxButton
        onClick={handleSave}
        variant="secondary"
        className={compact ? "w-full text-xs" : ""}
      >
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
  account: {
    requester: PublicKey;
    amount: { toNumber: () => number };
    executableAt: { toNumber: () => number };
  };
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
              <span className="inline-flex items-center gap-1">
                <GameIcon id="resource-cash" size={14} />
                <GoldNumber value={r.account.amount.toNumber()} size="sm" />
              </span>
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
