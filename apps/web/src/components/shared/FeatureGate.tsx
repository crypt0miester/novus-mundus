"use client";

import Link from "next/link";
import { useFeatureGate, type MissingRequirement } from "@/lib/hooks/useFeatureGate";

interface FeatureGateProps {
  feature: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export function FeatureGate({ feature, children, fallback }: FeatureGateProps) {
  const gate = useFeatureGate(feature);

  if (gate.loading) return null;
  if (gate.allowed) return <>{children}</>;
  if (fallback) return <>{fallback}</>;
  return <LockedCard missing={gate.missing} />;
}

function LockedCard({ missing }: { missing: MissingRequirement[] }) {
  return (
    <div className="rounded-lg border border-amber-900/40 bg-surface-raised p-6 text-center">
      <div className="mb-3 text-2xl text-text-muted">&#9906;</div>
      <p className="mb-1 text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">
        The Cairn
      </p>
      <div className="mb-4 space-y-2">
        {missing.map((m) => (
          <p
            key={m.label}
            className="text-sm leading-relaxed text-text-secondary"
          >
            {m.narrative}
          </p>
        ))}
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {missing.map((m) => (
          <Link
            key={m.label}
            href={m.href}
            className="rounded-md border border-amber-800/50 bg-amber-900/20 px-3 py-1.5 text-xs font-medium text-text-gold transition-colors hover:bg-amber-900/40"
          >
            {m.label} &rarr;
          </Link>
        ))}
      </div>
    </div>
  );
}

function LockedPage({ missing }: { missing: MissingRequirement[] }) {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <div className="max-w-md">
        <LockedCard missing={missing} />
      </div>
    </div>
  );
}
