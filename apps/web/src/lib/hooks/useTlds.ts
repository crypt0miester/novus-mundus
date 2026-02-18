"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchAllTlds } from "@/lib/domains";
import type { TldInfo } from "@/lib/domains";

/**
 * Fetch all available TLDs from AllDomains API.
 * GET /api/all-tlds?chain=solana
 *
 * Cached for 10 minutes — TLDs almost never change.
 */
export function useTlds() {
  return useQuery<TldInfo[]>({
    queryKey: ["all-tlds"],
    queryFn: fetchAllTlds,
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
  });
}
