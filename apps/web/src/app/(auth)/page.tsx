"use client";

import { useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@/components/shared/wallet-adapter";
import Noise from "@/components/shared/animations/Noise";
import { useTransitionStore, spectateMessage } from "@/lib/store/transition";

export default function LandingPage() {
  const { connected } = useWallet();
  const trigger = useTransitionStore((s) => s.trigger);
  const phase = useTransitionStore((s) => s.phase);

  // Cross into the realm when the wallet connects — the estate is home.
  useEffect(() => {
    if (connected && phase === "idle") {
      trigger("The road brought you here.", "/estate");
    }
  }, [connected, phase, trigger]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 px-4">
      <Noise />

      {/* Title */}
      <div className="text-center">
        <h1 className="tier-title font-display text-5xl font-bold tracking-wider md:text-7xl">
          NOVUS MUNDUS
        </h1>
        <p className="mt-4 text-lg text-text-secondary">
          The old world is gone. What rises from its bones is yours to shape — or to lose.
        </p>
        <p className="mt-1 text-sm text-text-muted">On Solana.</p>
      </div>

      {/* Wallet connect */}
      <WalletMultiButton
        style={{
          background: "#18181b",
          border: "1px solid #92400e",
          borderRadius: "0.5rem",
          fontWeight: 600,
          color: "#fbbf24",
          padding: "0.75rem 2rem",
        }}
      />

      <button
        onClick={() => trigger(spectateMessage(), "/world")}
        className="text-sm text-text-secondary transition-colors hover:text-text-gold"
      >
        Spectate the Realm as a Peasant
      </button>
    </div>
  );
}
