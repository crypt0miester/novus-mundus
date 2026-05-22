"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
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
  if (!gate.available) return <ComingSoonCard />;
  return <LockedCard missing={gate.missing} />;
}

function ComingSoonCard() {
  return (
    <div className="rounded-lg border border-dashed border-border-gold/40 bg-surface-raised/60 p-6 text-center">
      <div className="mb-3 text-2xl text-text-gold">&#8987;</div>
      <p className="mb-1 text-[0.65rem] uppercase tracking-[0.18em] text-text-gold">Coming soon</p>
      <h3 className="font-display text-lg font-semibold text-text-secondary">
        The road is being charted
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-text-muted">
        This way is not yet open. Return when the path is laid.
      </p>
    </div>
  );
}

function LockedCard({ missing }: { missing: MissingRequirement[] }) {
  return (
    <div className="rounded-lg border border-border-gold/40 bg-surface-raised p-6 text-center">
      <div className="mb-3 text-2xl text-text-muted">&#9906;</div>
      <p className="mb-1 text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">The Cairn</p>
      <div className="mb-4 space-y-2">
        {missing.map((m) => (
          <p key={m.label} className="text-sm leading-relaxed text-text-secondary">
            {m.narrative}
          </p>
        ))}
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {missing.map((m) => (
          <Link
            key={m.label}
            href={m.href}
            className="inline-flex items-center gap-1 rounded-md border border-border-gold/50 bg-accent/20 px-3 py-1.5 text-xs font-medium text-text-gold transition-colors hover:bg-accent/40"
          >
            {m.label}
            <ChevronRight className="h-3.5 w-3.5" />
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
