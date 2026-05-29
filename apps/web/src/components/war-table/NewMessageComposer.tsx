"use client";

// NewMessageComposer lets a player pick a DM recipient and route to
// /messages/<playerPda>. It is mounted from the inbox header "New message"
// button as a controlled overlay: a BottomSheet on mobile and an inline
// anchored panel on desktop. Two recipient paths share one input:
//   1. Search known players (otherPlayers minus self), matched by domain,
//      PlayerAccount PDA base58, or owner wallet base58.
//   2. Paste a base58 WALLET, derive its PlayerAccount PDA, and route to it.
// A pasted value that is itself a known otherPlayers PDA routes directly.

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useShallow } from "zustand/react/shallow";
import { PublicKey } from "@solana/web3.js";
import { Search, MessageSquare, AlertCircle, X } from "lucide-react";
import { derivePlayerPda } from "novus-mundus-sdk";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useAccountStore } from "@/lib/store/accounts";
import { useDomainNames } from "@/lib/hooks/useDomainNames";
import { BottomSheet } from "@/components/shared/BottomSheet";
import { PlayerAvatar } from "@/components/war-table/PlayerAvatar";
import { PlayerName } from "@/components/war-table/PlayerName";
import { cn } from "@/lib/utils";

// Keep the candidate list light: render at most this many search hits.
const MAX_RESULTS = 8;
// A base58 Solana pubkey is 32-44 chars; below this a query cannot be one.
const MIN_KEY_LENGTH = 32;

interface NewMessageComposerProps {
  open: boolean;
  onClose: () => void;
}

interface Candidate {
  playerPda: string;
  walletBase58: string;
  // in-game player name (may be empty), so the search can match it directly.
  name: string;
}

export function NewMessageComposer({ open, onClose }: NewMessageComposerProps) {
  const router = useRouter();
  const client = useNovusMundusClient();
  const gameEngine = client.gameEngine;

  const [query, setQuery] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Reset the input and any error each time the composer is reopened so a
  // stale query never lingers between sessions.
  useEffect(() => {
    if (open) {
      setQuery("");
      setPasteError(null);
    }
  }, [open]);

  // Snapshot only the slices we need so unrelated WS ticks do not re-run the
  // candidate filter on every player move.
  const { otherPlayers, myPlayerPda } = useAccountStore(
    useShallow((s) => ({
      otherPlayers: s.otherPlayers,
      myPlayerPda: s.myPlayerPda,
    })),
  );

  // All known players except the connected one. Branch explicitly on the
  // self key rather than shimming a default.
  const allCandidates = useMemo<Candidate[]>(() => {
    const out: Candidate[] = [];
    for (const [pda, entry] of otherPlayers) {
      if (myPlayerPda !== null && pda === myPlayerPda) continue;
      out.push({
        playerPda: pda,
        walletBase58: entry.account.owner.toBase58(),
        name: entry.account.name,
      });
    }
    return out;
  }, [otherPlayers, myPlayerPda]);

  // Warm domains for the full candidate set so a query can match against the
  // resolved domain string, not just the raw addresses.
  const candidatePdas = useMemo(() => allCandidates.map((c) => c.playerPda), [allCandidates]);
  const domains = useDomainNames(candidatePdas);

  const results = useMemo<Candidate[]>(() => {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return allCandidates.slice(0, MAX_RESULTS);
    const matched: Candidate[] = [];
    for (const c of allCandidates) {
      const domain = domains.get(c.playerPda);
      const inDomain = domain ? domain.toLowerCase().includes(q) : false;
      const inName = c.name ? c.name.toLowerCase().includes(q) : false;
      const inPda = c.playerPda.toLowerCase().includes(q);
      const inWallet = c.walletBase58.toLowerCase().includes(q);
      if (inDomain || inName || inPda || inWallet) {
        matched.push(c);
        if (matched.length >= MAX_RESULTS) break;
      }
    }
    return matched;
  }, [query, allCandidates, domains]);

  // A pasted value long enough to be a base58 key. If it already names a known
  // player PDA we route to it directly; otherwise we treat it as a wallet and
  // derive its PlayerAccount PDA. Surfaced as a confirmation row below.
  const pasted = useMemo(() => {
    const raw = query.trim();
    if (raw.length < MIN_KEY_LENGTH) return null;

    // A pasted PDA can only be honored if it matches a known player; we cannot
    // derive a wallet from a PDA. Route known PDAs straight through.
    if (otherPlayers.has(raw) && raw !== myPlayerPda) {
      return { playerPda: raw, isKnown: true } as const;
    }

    if (!gameEngine) return null;
    let wallet: PublicKey;
    try {
      wallet = new PublicKey(raw);
    } catch {
      return null;
    }
    const [pda] = derivePlayerPda(gameEngine, wallet);
    const playerPda = pda.toBase58();
    if (playerPda === myPlayerPda) return null;
    return { playerPda, isKnown: otherPlayers.has(playerPda) } as const;
  }, [query, otherPlayers, myPlayerPda, gameEngine]);

  // Whether to surface the paste confirmation row: only when the pasted key is
  // a valid recipient that is not already shown in the search results.
  const showPasted =
    pasted !== null && !results.some((r) => r.playerPda === pasted.playerPda);

  function routeTo(playerPda: string) {
    router.push(`/messages/${playerPda}`);
    onClose();
  }

  function onSubmit() {
    setPasteError(null);
    const raw = query.trim();
    if (raw.length === 0) return;

    if (pasted) {
      routeTo(pasted.playerPda);
      return;
    }

    // A non-empty query that is long enough to be a key but did not parse
    // means an invalid address; anything shorter is just a search with no hit.
    if (raw.length >= MIN_KEY_LENGTH) {
      setPasteError("That does not look like a valid wallet address.");
      return;
    }
    if (results.length > 0) routeTo(results[0].playerPda);
  }

  const body = (
    <div className="flex flex-col gap-3">
      <label className="relative block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPasteError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onSubmit();
            }
          }}
          placeholder="Search by name, domain, or paste a wallet"
          className={cn(
            "w-full rounded-full border border-border-default bg-surface py-2.5 pl-9 pr-3",
            "text-sm text-text-primary placeholder:text-text-muted",
            // No accent border on focus; keep outline-none so the default blue
            // browser ring never shows. (Matches ThreadRenderer.)
            "focus:outline-none",
          )}
        />
      </label>

      {pasteError && (
        <p className="flex items-center gap-1.5 text-xs text-danger">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {pasteError}
        </p>
      )}

      <div className="space-y-1">
        {showPasted && pasted && (
          <RecipientRow
            playerPda={pasted.playerPda}
            onSelect={() => routeTo(pasted.playerPda)}
            hint={pasted.isKnown ? undefined : "Pasted wallet"}
          />
        )}

        {results.map((c) => (
          <RecipientRow
            key={c.playerPda}
            playerPda={c.playerPda}
            onSelect={() => routeTo(c.playerPda)}
          />
        ))}

        {results.length === 0 && !showPasted && (
          <p className="px-1 py-2 text-xs text-text-muted">
            {query.trim()
              ? "No players match that search."
              : "No players to message yet."}
          </p>
        )}
      </div>
    </div>
  );

  return (
    <>
      <BottomSheet open={open} onClose={onClose} title="New message">
        {body}
      </BottomSheet>

      {open && (
        <div className="hidden lg:block">
          <div
            className="fixed inset-0 z-50 bg-black/40"
            onClick={onClose}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="New message"
            className="fixed left-1/2 top-24 z-50 w-full max-w-md -translate-x-1/2 rounded-2xl border border-border-default bg-surface-raised p-4 shadow-2xl shadow-black/40"
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-text-primary">New message</h3>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="flex h-7 w-7 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-surface-overlay hover:text-text-primary"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {body}
          </div>
        </div>
      )}
    </>
  );
}

function RecipientRow({
  playerPda,
  onSelect,
  hint,
}: {
  playerPda: string;
  onSelect: () => void;
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors",
        "hover:bg-surface-overlay",
      )}
    >
      <PlayerAvatar playerPda={playerPda} size={36} />
      <div className="min-w-0 flex-1">
        <PlayerName
          playerPda={playerPda}
          className="block truncate text-sm font-semibold text-text-primary"
        />
        {hint && <span className="text-[10px] text-text-muted">{hint}</span>}
      </div>
      <MessageSquare className="h-4 w-4 shrink-0 text-text-muted" />
    </button>
  );
}
