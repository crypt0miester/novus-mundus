"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[novus-mundus:global]", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1.5rem",
          padding: "1rem",
          margin: 0,
          background: "#0A0E14",
          color: "#fafafa",
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
          textAlign: "center",
        }}
      >
        <img
          src="/img/logo/logo-gold.svg"
          alt="Novus Mundus"
          width={96}
          height={96}
          style={{ opacity: 0.9 }}
        />

        <p
          style={{
            fontSize: "0.75rem",
            letterSpacing: "0.4em",
            textTransform: "uppercase",
            color: "#52525b",
            margin: 0,
          }}
        >
          Catastrophic · The Keep Burns
        </p>

        <h1
          style={{
            fontFamily: "Cinzel, ui-serif, Georgia, serif",
            fontSize: "clamp(2.25rem, 6vw, 3.5rem)",
            letterSpacing: "0.05em",
            fontWeight: 700,
            color: "#C9A961",
            margin: 0,
          }}
        >
          THE KEEP IS DARK
        </h1>

        <p
          style={{
            maxWidth: "32rem",
            color: "#a1a1aa",
            fontSize: "1rem",
            lineHeight: 1.6,
            margin: 0,
          }}
        >
          The realm could not recover. The chroniclers have been notified.
        </p>

        {error?.digest && (
          <p style={{ fontSize: "0.75rem", color: "#52525b", margin: 0 }}>sigil · {error.digest}</p>
        )}

        <button
          onClick={reset}
          style={{
            padding: "0.75rem 2rem",
            borderRadius: "0.5rem",
            border: "1px solid #92400e",
            background: "#18181b",
            color: "#C9A961",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
