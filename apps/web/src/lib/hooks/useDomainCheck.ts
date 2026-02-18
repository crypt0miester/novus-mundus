"use client";

import { useQuery } from "@tanstack/react-query";
import { checkDomainAvailability } from "@/lib/domains";
import type { DomainCheckResult } from "@/lib/domains";

/**
 * Check if a domain is available + get pricing.
 * Uses AllDomains API: GET /api/check-domain/{domain}
 *
 * Pass the full domain.tld string (e.g., "alice.abc").
 * Debounce the query param from the input to avoid hammering the API.
 */
export function useDomainCheck(domain: string | null | undefined) {
  const trimmed = domain?.trim().toLowerCase() || null;

  return useQuery<DomainCheckResult | null>({
    queryKey: ["domain-check", trimmed],
    queryFn: async () => {
      if (!trimmed) return null;
      return checkDomainAvailability(trimmed);
    },
    enabled: !!trimmed && trimmed.length >= 2,
    staleTime: 30_000, // 30s — availability can change
    gcTime: 60_000,
    retry: 1,
  });
}
