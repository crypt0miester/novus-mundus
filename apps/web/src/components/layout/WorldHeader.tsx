"use client";

import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@/components/shared/wallet-adapter";

export function WorldHeader() {
  const { connected } = useWallet();

  return (
    <header className="z-40 flex h-12 items-center justify-between bg-[var(--nm-bg-bar)] px-4">
      <Link href="/world">
        <h1 className="tier-title font-display text-lg font-semibold tracking-wide">
          NOVUS MUNDUS
        </h1>
      </Link>

      <div className="flex items-center gap-3">
        {connected ? (
          <Link
            href="/dashboard"
            className="rounded-md border border-border-gold px-3 py-1 text-xs font-semibold text-text-gold transition-colors hover:bg-accent/20"
          >
            Return to Game
          </Link>
        ) : (
          <span className="rounded-md bg-zinc-800 px-2 py-1 text-xs text-text-muted">
            Spectating
          </span>
        )}
        <WalletMultiButton
          style={{
            background: "#18181b",
            border: "1px solid #92400e",
            borderRadius: "0.5rem",
            fontWeight: 600,
            color: "#fbbf24",
            padding: "0.5rem 1rem",
            fontSize: "0.75rem",
            height: "auto",
          }}
        />
      </div>
    </header>
  );
}
