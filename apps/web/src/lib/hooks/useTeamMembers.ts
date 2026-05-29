"use client";

import { useEffect, useMemo } from "react";
import { useAccountStore } from "@/lib/store/accounts";
import { useNovusMundusClient } from "@/lib/solana/provider";
import type { PublicKey } from "@solana/web3.js";

export function useTeamMembers(teamPubkey: PublicKey | null | undefined) {
  const teamMembers = useAccountStore((s) => s.teamMembers);
  const loading = useAccountStore((s) => s.loading);
  const client = useNovusMundusClient();

  // On-demand fetch: seed zustand with team members
  useEffect(() => {
    if (!teamPubkey) return;

    client
      .fetchTeamMembers(teamPubkey)
      .then((results) => {
        const store = useAccountStore.getState();
        for (const m of results) {
          store.upsertTeamMember(m.pubkey, m.account);
        }
      })
      .catch(() => {});
  }, [teamPubkey?.toBase58(), client]);

  // Filter members for this team
  const data = useMemo(() => {
    if (!teamPubkey) return [];
    const teamKey = teamPubkey.toBase58();
    return Array.from(teamMembers.values()).filter((m) => m.account.team?.toBase58() === teamKey);
  }, [teamMembers, teamPubkey]);

  return {
    data,
    isLoading: loading && teamMembers.size === 0,
    isSuccess: !loading,
  };
}
