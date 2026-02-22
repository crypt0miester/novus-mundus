"use client";

import { useState, useMemo } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useGameEngine } from "@/lib/hooks/useGameEngine";
import { useSubscriptionStatus } from "@/lib/hooks/useDerived";
import { useTransact } from "@/lib/hooks/useTransact";
import { GoldCountdown } from "@/components/shared/GoldCountdown";
import { PageTransition } from "@/components/shared/PageTransition";
import { DomainPicker } from "@/components/shared/DomainPicker";
import { shortenAddress } from "@/lib/utils";
import {
  deriveUserPda,
  hasCustomName,
  createSetPlayerNameInstruction,
  createUpdatePlayerNameInstruction,
  createRemovePlayerNameInstruction,
} from "@/lib/sdk";
import { useSettings, type Explorer, type ThemePreference } from "@/lib/store/settings";
import { TierSwitcher } from "@/components/layout/Sidebar";

function CopyableAddress({ label, address }: { label: string; address: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex justify-between text-sm">
      <span className="text-text-muted">{label}</span>
      <button
        onClick={handleCopy}
        className="group flex items-center gap-1.5 font-mono text-text-primary transition-colors hover:text-text-gold"
        title="Copy to clipboard"
      >
        {shortenAddress(address)}
        <span className="text-xs text-text-muted transition-colors group-hover:text-text-gold">
          {copied ? "copied" : "copy"}
        </span>
      </button>
    </div>
  );
}

const EXPLORER_OPTIONS: { value: Explorer; label: string }[] = [
  { value: "solscan", label: "Solscan" },
  { value: "explorer", label: "Explorer" },
  { value: "solanafm", label: "SolanaFM" },
];

const PRIORITY_PRESETS: { label: string; value: number }[] = [
  { label: "Normal", value: 10_000 },
  { label: "Fast", value: 100_000 },
  { label: "Turbo", value: 1_000_000 },
];

export default function SettingsPage() {
  const { publicKey, disconnect } = useWallet();
  const { data: playerData } = usePlayer();
  const { data: geData } = useGameEngine();
  const sub = useSubscriptionStatus();
  const transact = useTransact();
  const numberFormat = useSettings((s) => s.numberFormat);
  const animationsEnabled = useSettings((s) => s.animationsEnabled);
  const explorer = useSettings((s) => s.explorer);
  const priorityFee = useSettings((s) => s.priorityFee);
  const themePreference = useSettings((s) => s.themePreference);
  const setThemePreference = useSettings((s) => s.setThemePreference);
  const setNumberFormat = useSettings((s) => s.setNumberFormat);
  const setAnimationsEnabled = useSettings((s) => s.setAnimationsEnabled);
  const setExplorer = useSettings((s) => s.setExplorer);
  const setPriorityFee = useSettings((s) => s.setPriorityFee);

  const player = playerData?.account;
  const gameEngine = geData?.pubkey;

  const playerHasName = useMemo(() => {
    if (!player) return false;
    return hasCustomName(player);
  }, [player]);

  const currentPlayerName = useMemo(() => {
    if (!player || !playerHasName) return null;
    return player.name; // "domain.tld" format
  }, [player, playerHasName]);

  const parsedCurrentName = useMemo(() => {
    if (!currentPlayerName) return null;
    const dotIdx = currentPlayerName.indexOf(".");
    if (dotIdx === -1) return { domain: currentPlayerName, tld: "abc" };
    return { domain: currentPlayerName.slice(0, dotIdx), tld: currentPlayerName.slice(dotIdx + 1) };
  }, [currentPlayerName]);

  const userPda = useMemo(() => {
    if (!publicKey) return null;
    const [pda] = deriveUserPda(publicKey);
    return pda;
  }, [publicKey]);

  const handleNameSet = (domain: string, tld: string) => {
    if (!publicKey || !gameEngine) return;

    if (parsedCurrentName) {
      // Update: swap old domain for new
      const ix = createUpdatePlayerNameInstruction({
        owner: publicKey,
        gameEngine,
        tld,
        domainName: domain,
        oldTld: parsedCurrentName.tld,
        oldDomainName: parsedCurrentName.domain,
      });
      transact.mutate({
        instructions: [ix],
        successMessage: "Name updated",
        invalidateKeys: [["player"], ["owned-domains"]],
      });
    } else {
      // First time set
      const ix = createSetPlayerNameInstruction({
        owner: publicKey,
        gameEngine,
        tld,
        domainName: domain,
      });
      transact.mutate({
        instructions: [ix],
        successMessage: "Name set",
        invalidateKeys: [["player"], ["owned-domains"]],
      });
    }
  };

  const handleNameRemove = () => {
    if (!publicKey || !gameEngine || !parsedCurrentName) return;
    const ix = createRemovePlayerNameInstruction({
      owner: publicKey,
      gameEngine,
      tld: parsedCurrentName.tld,
      domainName: parsedCurrentName.domain,
    });
    transact.mutate({
      instructions: [ix],
      successMessage: "Name removed",
      invalidateKeys: [["player"], ["owned-domains"]],
    });
  };

  const solCostEstimate = (priorityFee * 400_000) / 1e15;

  return (
    <PageTransition>
      <div className="flex h-full flex-col gap-3">
        <h1 className="tier-title font-display text-2xl font-bold tracking-wide">SETTINGS</h1>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto lg:grid-cols-2 lg:overflow-hidden">
          {/* Left column: Account + Subscription */}
          <div className="flex flex-col gap-3 lg:overflow-y-auto">
            <div className="card accent-border">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">Account</h3>
              <div className="space-y-2">
                {publicKey && <CopyableAddress label="Wallet" address={publicKey.toBase58()} />}
                {!publicKey && (
                  <div className="flex justify-between text-sm">
                    <span className="text-text-muted">Wallet</span>
                    <span className="text-text-secondary">Not connected</span>
                  </div>
                )}
                {userPda && <CopyableAddress label="User Account" address={userPda.toBase58()} />}
                {playerData?.pubkey && <CopyableAddress label="Player Account" address={playerData.pubkey.toBase58()} />}
                {player && (
                  <>
                    <div className="flex justify-between text-sm">
                      <span className="text-text-muted">Player Name</span>
                      <span className="text-text-primary">{player.name || "Unnamed"}</span>
                    </div>
                    <DomainPicker
                      currentName={currentPlayerName}
                      isPending={transact.isPending}
                      onSet={handleNameSet}
                      onRemove={handleNameRemove}
                      label="player account"
                    />
                    <div className="flex justify-between text-sm">
                      <span className="text-text-muted">Level</span>
                      <span className="text-text-gold">{player.level}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-text-muted">City</span>
                      <span className="text-text-primary">City {player.currentCity}</span>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="card">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">Subscription</h3>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-text-muted">Tier</span>
                  <span className="text-text-gold">{sub.tierName}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-text-muted">Status</span>
                  <span className={sub.active ? "text-green-400" : "text-zinc-500"}>
                    {sub.active ? "Active" : "Inactive"}
                  </span>
                </div>
                {sub.active && sub.expiresAt > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-text-muted">Expires</span>
                    <GoldCountdown endsAt={sub.expiresAt} format="full" size="sm" />
                  </div>
                )}
              </div>
            </div>

            {/* Danger Zone */}
            <div className="card border-red-900/50">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-red-400">Danger Zone</h3>
              <button
                onClick={() => disconnect()}
                className="rounded-lg border border-red-800 bg-red-900/20 px-4 py-2 text-sm font-medium text-red-400 transition-all hover:bg-red-900/40"
              >
                Disconnect Wallet
              </button>
            </div>
          </div>

          {/* Right column: Display, Theme, Explorer, Transaction */}
          <div className="flex flex-col gap-3 lg:overflow-y-auto">
            <div className="card">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">Display</h3>
          <div className="space-y-4">
            <div className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
              <div>
                <span className="text-text-primary">Number Format</span>
                <p className="text-xs text-text-muted">How large numbers are displayed</p>
              </div>
              <div className="flex rounded-lg border border-zinc-800">
                {(["compact", "full"] as const).map((fmt) => (
                  <button
                    key={fmt}
                    onClick={() => setNumberFormat(fmt)}
                    className={`px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                      numberFormat === fmt
                        ? "bg-amber-900/30 text-text-gold"
                        : "text-text-muted hover:text-text-primary"
                    }`}
                  >
                    {fmt === "compact" ? "1.2K" : "1,200"}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
              <div>
                <span className="text-text-primary">Animations</span>
                <p className="text-xs text-text-muted">Page transitions and number rolling</p>
              </div>
              <button
                onClick={() => setAnimationsEnabled(!animationsEnabled)}
                className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                  animationsEnabled ? "bg-amber-600" : "bg-zinc-700"
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                    animationsEnabled ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
          </div>
        </div>

        {/* Theme */}
        <div className="card">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
            Theme
          </h3>
          <div className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
            <div>
              <span className="text-text-primary">Appearance</span>
              <p className="text-xs text-text-muted">Paper uses a light parchment background</p>
            </div>
            <div className="flex rounded-lg border border-zinc-800">
              {(["paper", "auto", "dark"] as ThemePreference[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setThemePreference(t)}
                  className={`px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                    themePreference === t
                      ? "bg-amber-900/30 text-text-gold"
                      : "text-text-muted hover:text-text-primary"
                  }`}
                >
                  {t === "auto" ? "Auto" : t === "paper" ? "Paper" : "Dark"}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Explorer */}
        <div className="card">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
            Explorer
          </h3>
          <div className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
            <div>
              <span className="text-text-primary">Transaction Explorer</span>
              <p className="text-xs text-text-muted">Where transaction links open</p>
            </div>
            <div className="flex rounded-lg border border-zinc-800">
              {EXPLORER_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setExplorer(opt.value)}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                    explorer === opt.value
                      ? "bg-amber-900/30 text-text-gold"
                      : "text-text-muted hover:text-text-primary"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Transaction */}
        <div className="card">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
            Transaction
          </h3>
          <div className="space-y-3">
            <div className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
              <div>
                <span className="text-text-primary">Priority Fee</span>
                <p className="text-xs text-text-muted">Higher fees help transactions land faster</p>
              </div>
              <div className="flex rounded-lg border border-zinc-800">
                {PRIORITY_PRESETS.map((preset) => (
                  <button
                    key={preset.value}
                    onClick={() => setPriorityFee(preset.value)}
                    className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                      priorityFee === preset.value
                        ? "bg-amber-900/30 text-text-gold"
                        : "text-text-muted hover:text-text-primary"
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-text-muted">Estimated cost per tx</span>
              <span className="font-mono text-text-primary">
                {solCostEstimate < 0.000001
                  ? "< 0.000001"
                  : solCostEstimate.toFixed(6)}{" "}
                SOL
              </span>
            </div>
          </div>
        </div>

        {/* DEV: Tier Preview */}
        {process.env.NODE_ENV === "development" && (
          <div className="card">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">Dev Tools</h3>
            <TierSwitcher />
          </div>
        )}
          </div>
        </div>
      </div>
    </PageTransition>
  );
}
