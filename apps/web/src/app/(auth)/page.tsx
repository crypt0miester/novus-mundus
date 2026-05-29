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
      <div className="flex flex-col items-center text-center">
        <img
          src="/img/logo/logo-gold.svg"
          alt="Novus Mundus"
          className="mb-6 h-24 w-24 md:h-32 md:w-32"
          width={128}
          height={128}
        />
        <h1 className="tier-title font-display text-5xl font-bold tracking-wider md:text-7xl">
          NOVUS MUNDUS
        </h1>
        <p className="mt-4 text-lg text-text-secondary">
          the old world is gone. what rises from its bones is yours to shape, or to lose.
        </p>
        <p className="mt-1 text-sm text-text-muted">on Solana.</p>
      </div>

      {/* Wallet connect */}
      <WalletMultiButton
        style={{
          background: "var(--nm-bg-raised)",
          border: "1px solid var(--tier-accent)",
          borderRadius: "0.5rem",
          fontWeight: 600,
          color: "var(--tier-accent-bright)",
          padding: "0.75rem 2rem",
        }}
      />

      <button
        onClick={() => trigger(spectateMessage(), "/world")}
        className="text-sm text-text-secondary transition-colors hover:text-text-gold lowercase"
      >
        Spectate the Realms
      </button>
    </div>
  );
}
