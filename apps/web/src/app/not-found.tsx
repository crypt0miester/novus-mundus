import Link from "next/link";
import Noise from "@/components/shared/animations/Noise";

export default function NotFound() {
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

        <p className="font-mono text-xs uppercase tracking-[0.4em] text-text-muted">
          404 · Terra Incognita
        </p>

        <h1 className="tier-title mt-3 font-display text-5xl font-bold tracking-wider md:text-6xl">
          THE PATH IS LOST
        </h1>

        <p className="mt-5 max-w-md text-base text-text-secondary md:text-lg">
          You wandered past the edge of the chartered realm. No road leads back from here.
        </p>
      </div>

      <Link
        href="/"
        className="rounded-lg border border-[var(--nm-accent)] bg-[#18181b] px-8 py-3 font-semibold text-[var(--tier-accent-bright)] transition-colors hover:bg-[#1f1f23]"
      >
        Return to the realm
      </Link>
    </div>
  );
}
