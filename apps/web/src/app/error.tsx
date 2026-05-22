"use client";

import { useEffect } from "react";
import Link from "next/link";
import Noise from "@/components/shared/animations/Noise";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[novus-mundus]", error);
  }, [error]);

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center gap-8 px-4">
      <Noise />

      <div className="flex flex-col items-center text-center">
        <img
          src="/img/logo/logo-gold.svg"
          alt="Novus Mundus"
          className="mb-6 h-20 w-20 opacity-90 md:h-24 md:w-24"
          width={96}
          height={96}
        />

        <p className="font-mono text-xs lowercase tracking-[0.4em] text-text-muted">
          500 · the forge falters
        </p>

        <h1 className="tier-title mt-3 font-display text-5xl font-bold tracking-wider md:text-6xl">
          THE REALM TREMBLES
        </h1>

        <p className="mt-5 max-w-md text-base text-text-secondary md:text-lg">
          something snapped in the works. The chroniclers have been notified.
        </p>

        {error?.digest && (
          <p className="mt-3 font-mono text-xs text-text-muted">sigil · {error.digest}</p>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          onClick={reset}
          className="rounded-lg border border-[var(--nm-accent)] bg-[#18181b] px-8 py-3 font-semibold text-[var(--tier-accent-bright)] transition-colors hover:bg-[#1f1f23]"
        >
          try again
        </button>
        <Link
          href="/"
          className="rounded-lg border border-zinc-800 bg-transparent px-8 py-3 font-semibold text-text-secondary transition-colors hover:border-zinc-700 hover:text-text-primary"
        >
          return to the realm
        </Link>
      </div>
    </div>
  );
}
