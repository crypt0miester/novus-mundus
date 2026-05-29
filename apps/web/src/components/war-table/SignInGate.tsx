"use client";

// SignInGate: the full-panel gate ThreadRenderer shows for an encrypted thread
// when the viewer has no SIWS session. A signed-out viewer cannot decrypt
// anything, so rather than a list of lock icons (which imply content is one tap
// away and invite repeated taps) this is one centered panel with a single
// action. The unread peek strip already conveys "there are messages".
//
// Presentational only: the sign-in handshake, loading, and error live in the
// parent (ThreadRenderer), routed through the deduped ensureSession so a gate
// click and a Send can never double-prompt.

import { Lock, LoaderCircle } from "lucide-react";

interface SignInGateProps {
  title: string;
  signingIn: boolean;
  error: string | null;
  onSignIn: () => void;
}

export function SignInGate({ title, signingIn, error, onSignIn }: SignInGateProps) {
  return (
    <div className="flex min-h-48 flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-border-default bg-surface/60 px-6 py-8 text-center">
      <Lock className="h-6 w-6 text-text-muted" aria-hidden />
      <div className="space-y-1">
        <p className="text-sm font-semibold text-text-primary">{title}</p>
        <p className="text-xs text-text-muted">
          Messages are end-to-end encrypted. Sign in to read and reply.
        </p>
      </div>
      <button
        type="button"
        onClick={onSignIn}
        disabled={signingIn}
        className="inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-surface transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
      >
        {signingIn ? (
          <>
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
            Signing in
          </>
        ) : (
          "Sign in to read"
        )}
      </button>
      {error ? <p className="max-w-xs text-xs text-danger">{error}</p> : null}
    </div>
  );
}
