"use client";

import { useState, useMemo, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useOwnedDomains } from "@/lib/hooks/useOwnedDomains";
import { useDomainCheck } from "@/lib/hooks/useDomainCheck";

// Types

interface DomainPickerProps {
  /** Current domain name if set (e.g., "myname.abc"). Null = no name set. */
  currentName: string | null;
  /** Whether a transaction is in-flight */
  isPending: boolean;
  /** Called when user confirms set/update. Receives (domainName, tld). */
  onSet: (domain: string, tld: string) => void;
  /** Called when user confirms remove. Only shown when currentName is set. */
  onRemove: () => void;
  /** Context label for transfer warnings */
  label?: string;
}

type ValidationStatus =
  | { type: "idle" }
  | { type: "checking" }
  | { type: "owned" }
  | { type: "not-owned" }
  | { type: "not-registered" }
  | { type: "invalid"; reason: string }
  | { type: "error" };

// Helpers

const DOMAIN_RE = /^[a-z0-9-]+$/;

function parseDomainTld(fullName: string): { domain: string; tld: string } | null {
  const dot = fullName.indexOf(".");
  if (dot === -1) return null;
  return { domain: fullName.slice(0, dot), tld: fullName.slice(dot + 1) };
}

function validate(input: string): { type: "invalid"; reason: string } | null {
  if (input.length === 0) return null;
  if (input.length < 1) return { type: "invalid", reason: "Too short" };
  if (input.length > 32) return { type: "invalid", reason: "Max 32 characters" };
  if (!DOMAIN_RE.test(input)) return { type: "invalid", reason: "Letters, numbers, hyphens only" };
  return null;
}

// Component

export function DomainPicker({
  currentName,
  isPending,
  onSet,
  onRemove,
  label = "account",
}: DomainPickerProps) {
  const { publicKey } = useWallet();
  const { data: ownedDomains, isLoading: domainsLoading } = useOwnedDomains(publicKey);

  const [input, setInput] = useState("");
  const [tld] = useState("abc");
  const [debounced, setDebounced] = useState("");

  // Debounce input for API check
  useEffect(() => {
    if (!input.trim()) {
      setDebounced("");
      return;
    }
    const t = setTimeout(() => setDebounced(input.trim().toLowerCase()), 500);
    return () => clearTimeout(t);
  }, [input]);

  const fullDomain = debounced ? `${debounced}.${tld}` : null;
  const { data: checkResult, isFetching: isChecking } = useDomainCheck(fullDomain);

  // Parse owned domains — filter to current TLD only
  const walletDomains = useMemo(() => {
    if (!ownedDomains) return [];
    return (ownedDomains as { nameAccount: unknown; domain: string }[])
      .filter((d) => d.domain.endsWith(`.${tld}`))
      .map((d) => {
        const parsed = parseDomainTld(d.domain);
        return parsed ? { full: d.domain, ...parsed } : null;
      })
      .filter(Boolean) as { full: string; domain: string; tld: string }[];
  }, [ownedDomains, tld]);

  // Determine validation status
  const status: ValidationStatus = useMemo(() => {
    const trimmed = input.trim().toLowerCase();
    if (!trimmed) return { type: "idle" };

    const formatError = validate(trimmed);
    if (formatError) return formatError;

    // Check if it's one of the user's owned domains
    if (walletDomains.some((d) => d.domain === trimmed)) {
      return { type: "owned" };
    }

    // If API check is in progress
    if (isChecking || trimmed !== debounced) return { type: "checking" };

    // API returned a result
    if (checkResult) {
      if (checkResult.exists) {
        // Domain exists but user doesn't own it (not in wallet list)
        return { type: "not-owned" };
      }
      return { type: "not-registered" };
    }

    return { type: "idle" };
  }, [input, debounced, isChecking, checkResult, walletDomains]);

  const canSubmit = !isPending && input.trim().length > 0 && status.type === "owned";

  const isUpdate = !!currentName;
  const parsed = currentName ? parseDomainTld(currentName) : null;

  const handleSelect = (domain: string) => {
    setInput(domain);
  };

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSet(input.trim().toLowerCase(), tld);
    setInput("");
  };

  return (
    <div className="space-y-3 rounded-lg border border-zinc-800 p-3">
      {/* Current name + remove */}
      {currentName && parsed && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-text-muted">
            Current: <span className="text-text-gold">{currentName}</span>
          </span>
          <button
            onClick={onRemove}
            disabled={isPending}
            className="rounded-lg border border-red-800 bg-red-900/20 px-3 py-1 text-xs font-medium text-red-400 transition-all hover:bg-red-900/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Remove Name
          </button>
        </div>
      )}

      {/* Owned domains chips */}
      {walletDomains.length > 0 && (
        <div>
          <div className="mb-1.5 text-[10px] font-medium uppercase text-text-muted">
            Your domains
          </div>
          <div className="flex flex-wrap gap-1.5">
            {walletDomains.map((d) => (
              <button
                key={d.full}
                onClick={() => handleSelect(d.domain)}
                className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-all ${
                  input.trim().toLowerCase() === d.domain
                    ? "border-border-gold bg-accent/30 text-text-gold"
                    : "border-zinc-700 text-text-secondary hover:border-zinc-600 hover:text-text-primary"
                }`}
              >
                {d.full}
              </button>
            ))}
          </div>
        </div>
      )}

      {walletDomains.length === 0 && !domainsLoading && publicKey && (
        <div className="text-xs text-text-muted">
          No .{tld} domains in your wallet.{" "}
          <a
            href="https://alldomains.id"
            target="_blank"
            rel="noopener noreferrer"
            className="text-text-gold hover:underline"
          >
            Get one
          </a>
        </div>
      )}

      {domainsLoading && <div className="text-xs text-text-muted">Loading your domains...</div>}

      {/* Manual input */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
            placeholder={isUpdate ? "new domain" : "domain name"}
            className={`w-full rounded-lg border bg-surface-base px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none ${
              status.type === "owned"
                ? "border-green-700 focus:border-green-600"
                : status.type === "invalid" || status.type === "not-owned"
                  ? "border-red-800 focus:border-red-700"
                  : status.type === "not-registered"
                    ? "border-border-gold focus:border-border-gold"
                    : "border-zinc-800 focus:border-border-gold"
            }`}
          />
          {/* Status icon */}
          {input.trim() && (
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs">
              {status.type === "checking" && (
                <span className="text-text-muted animate-pulse">...</span>
              )}
              {status.type === "owned" && <span className="text-green-400">&#10003;</span>}
              {status.type === "not-owned" && <span className="text-red-400">&#10007;</span>}
              {status.type === "not-registered" && <span className="text-text-gold">?</span>}
              {status.type === "invalid" && <span className="text-red-400">!</span>}
            </span>
          )}
        </div>
        <span className="flex items-center text-sm text-text-muted">.{tld}</span>
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isUpdate ? "Update" : "Set Name"}
        </button>
      </div>

      {/* Validation message */}
      {input.trim() && status.type !== "idle" && status.type !== "checking" && (
        <div
          className={`text-[11px] ${
            status.type === "owned"
              ? "text-green-400"
              : status.type === "not-owned"
                ? "text-red-400"
                : status.type === "not-registered"
                  ? "text-text-gold"
                  : status.type === "invalid"
                    ? "text-red-400"
                    : "text-text-muted"
          }`}
        >
          {status.type === "owned" && "You own this domain"}
          {status.type === "not-owned" && "This domain is owned by someone else"}
          {status.type === "not-registered" && (
            <>
              Domain not registered.{" "}
              <a
                href={`https://alldomains.id/search/${input.trim()}`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-text-primary"
              >
                Register it
              </a>
            </>
          )}
          {status.type === "invalid" && status.reason}
        </div>
      )}

      {/* Transfer warning */}
      {canSubmit && (
        <div className="text-[10px] text-text-muted">
          {isUpdate
            ? `This will return ${currentName} to your wallet and transfer ${input.trim()}.${tld} to your ${label}.`
            : `This will transfer ${input.trim()}.${tld} from your wallet to your ${label}.`}
        </div>
      )}
    </div>
  );
}
