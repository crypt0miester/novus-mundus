"use client";

import { useEffect } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import type { PublicKey } from "@solana/web3.js";
import {
  derivePlayerPda,
  deriveTeamInvitePda,
  deriveTreasuryRequestPda,
  parsePlayer,
  parseTeamInvite,
  parseTreasuryRequest,
  type TeamMemberSlot,
} from "novus-mundus-sdk";
import { useAccountStore } from "@/lib/store/accounts";
import { useNovusMundusClient } from "@/lib/solana/provider";

// On-demand RPC backfills for the team screen. The program-wide WS seeds these
// accounts once it has seen them, but a freshly loaded page has nothing until a
// WS event fires — so each hook derives the relevant PDAs and bulk-fetches the
// gaps, upserting into the zustand store the UI reads. Extracted from team-tab
// so the derive -> getMultipleAccountsInfo -> parse -> upsert flow lives behind
// a hook surface instead of inline effects.

type MemberEntry = { account: Pick<TeamMemberSlot, "player"> };

/**
 * Backfill PlayerCore accounts for team members missing from the zustand cache.
 * `otherPlayers` is in the dep set on purpose: if it's evicted (wallet
 * disconnect / kingdom switch / reset) while `members` stays referentially
 * stable, the effect must re-fire so the missing members get refetched —
 * otherwise the roster locks to blank "Lv 0" rows until the user navigates away.
 */
export function useTeamMemberBackfill(members: MemberEntry[] | undefined): void {
  const otherPlayers = useAccountStore((s) => s.otherPlayers);
  const upsertOtherPlayer = useAccountStore((s) => s.upsertOtherPlayer);
  const { connection } = useConnection();

  useEffect(() => {
    if (!members || members.length === 0) return;
    const missing = members
      .map((m) => m.account.player)
      .filter((pda) => !otherPlayers.has(pda.toBase58()));
    if (missing.length === 0) return;

    let cancelled = false;
    connection
      .getMultipleAccountsInfo(missing)
      .then((infos) => {
        if (cancelled) return;
        for (let i = 0; i < infos.length; i++) {
          const info = infos[i];
          if (!info) continue;
          const parsed = parsePlayer(info);
          if (parsed) upsertOtherPlayer(missing[i], parsed);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [members, connection, otherPlayers, upsertOtherPlayer]);
}

/**
 * Backfill treasury requests, one PDA per (team, requester). `refresh` (the tx
 * pending flag) re-fires the fetch around a transaction so a just-submitted
 * request appears without waiting on the WS.
 */
export function useTreasuryRequests(
  teamPubkey: PublicKey | null | undefined,
  members: MemberEntry[] | undefined,
  refresh: boolean,
): void {
  const { connection } = useConnection();

  useEffect(() => {
    if (!teamPubkey || !members || members.length === 0) return;
    const requestPdas = members.map(
      (m) => deriveTreasuryRequestPda(teamPubkey, m.account.player)[0],
    );
    connection
      .getMultipleAccountsInfo(requestPdas)
      .then((infos) => {
        const store = useAccountStore.getState();
        for (let i = 0; i < infos.length; i++) {
          const info = infos[i];
          if (!info) continue;
          const parsed = parseTreasuryRequest(info);
          if (parsed) store.upsertTreasuryRequest(requestPdas[i], parsed);
        }
      })
      .catch(() => {});
    // teamPubkey keyed by base58 (stable identity); `refresh` re-fires post-tx.
  }, [teamPubkey?.toBase58(), members, connection, refresh]);
}

/**
 * Backfill incoming team invites for the current player. The invite PDA is
 * derivable from (team, invitee), so derive one per active team and bulk-fetch.
 * `refresh` re-fires around a transaction (e.g. after accepting/declining).
 */
export function useIncomingInvites(refresh: boolean): void {
  const { publicKey } = useWallet();
  const client = useNovusMundusClient();
  const { connection } = useConnection();

  useEffect(() => {
    if (!publicKey) return;
    const [meiPlayerPda] = derivePlayerPda(client.gameEngine, publicKey);
    let cancelled = false;
    client
      .fetchAllTeams({ activeOnly: true })
      .then((teams) => {
        if (cancelled || teams.length === 0) return;
        const invitePdas = teams.map((t) => deriveTeamInvitePda(t.pubkey, meiPlayerPda)[0]);
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
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // publicKey keyed by base58 (stable identity); `refresh` re-fires post-tx.
  }, [publicKey?.toBase58(), client, connection, refresh]);
}
