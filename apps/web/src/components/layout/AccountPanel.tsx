"use client";

import { useEffect, useMemo, useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { Copy, Check, Coins, Repeat, LogOut, Wallet, type LucideIcon } from "lucide-react";
import { useWalletModal } from "@/components/shared/wallet-adapter";
import { WorldClock } from "@/components/shared/WorldClock";
import { useDomainName } from "@/lib/hooks/useDomainName";
import { shortenAddress, cn } from "@/lib/utils";

// The account view inside the drawer, opened from the rail's wallet icon. On
// desktop the wallet's actions are destructured out of BaseWalletMultiButton's
// dropdown into flat rows laid directly in the sidebar (copy / airdrop / change /
// disconnect), so nothing opens a menu off the rail's edge. Mobile keeps the
// dropdown (LeftPanelMobile's WalletMultiButton). The day/night WorldClock and
// the resource footer (rendered by SideDrawer below this) round out the panel.
export function AccountPanel() {
  const { setVisible } = useWalletModal();
  const { connected, connecting, disconnect, publicKey } = useWallet();
  const { connection } = useConnection();
  const domain = useDomainName(publicKey);
  const base58 = useMemo(() => publicKey?.toBase58(), [publicKey]);

  const [balance, setBalance] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [airdropping, setAirdropping] = useState(false);

  // SOL balance, kept live (same source BaseWalletMultiButton's dropdown used).
  useEffect(() => {
    if (!publicKey || !connection) return;
    let cancelled = false;
    const load = async () => {
      try {
        const lamports = await connection.getBalance(publicKey, "confirmed");
        if (!cancelled) setBalance((Number(lamports) / Number(LAMPORTS_PER_SOL)).toFixed(3));
      } catch {
        if (!cancelled) setBalance(null);
      }
    };
    load();
    const id = connection.onAccountChange(publicKey, (info) => {
      if (!cancelled) setBalance((Number(info.lamports) / Number(LAMPORTS_PER_SOL)).toFixed(3));
    });
    return () => {
      cancelled = true;
      connection.removeAccountChangeListener(id);
    };
  }, [publicKey, connection]);

  const copy = () => {
    if (!base58) return;
    navigator.clipboard.writeText(base58);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const changeWallet = () => {
    localStorage.removeItem("walletName");
    disconnect?.();
    setVisible(true);
  };

  const airdrop = async () => {
    if (!publicKey || airdropping) return;
    setAirdropping(true);
    try {
      const sig = await connection.requestAirdrop(publicKey, LAMPORTS_PER_SOL);
      await connection.confirmTransaction(sig, "confirmed");
    } catch {
      // airdrop fails off a dev/local cluster; nothing to surface here
    } finally {
      setAirdropping(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 px-3 py-2">
      <Group label="Wallet">
        {connected && base58 ? (
          <div className="flex flex-col gap-1">
            {/* Identity + balance */}
            <div className="rounded-lg border border-border-default bg-surface-raised px-3 py-2">
              <div className="truncate text-sm font-semibold text-text-primary">
                {domain ?? shortenAddress(base58)}
              </div>
              <div className="font-mono text-[11px] text-text-muted">
                {balance != null ? `${balance} SOL` : shortenAddress(base58)}
              </div>
            </div>
            {/* Flat actions, destructured from the dropdown */}
            <ActionRow icon={copied ? Check : Copy} label={copied ? "Copied" : "Copy address"} onClick={copy} />
            <ActionRow icon={Coins} label={airdropping ? "Airdropping..." : "Airdrop 1 SOL"} onClick={airdrop} />
            <ActionRow icon={Repeat} label="Change wallet" onClick={changeWallet} />
            <ActionRow icon={LogOut} label="Disconnect" onClick={() => disconnect?.()} danger />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setVisible(true)}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-border-default bg-surface-raised px-3 py-2 text-sm font-semibold text-text-secondary transition-colors hover:bg-surface-overlay hover:text-text-primary"
          >
            <Wallet className="h-4 w-4" aria-hidden />
            {connecting ? "Connecting..." : "Connect wallet"}
          </button>
        )}
      </Group>

      <Group label="World">
        <WorldClock />
      </Group>
    </div>
  );
}

function ActionRow({
  icon: Icon,
  label,
  onClick,
  danger,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
        danger
          ? "text-danger hover:bg-surface-raised"
          : "text-text-secondary hover:bg-surface-raised hover:text-text-primary",
      )}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      <span className="truncate">{label}</span>
    </button>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
        {label}
      </span>
      {children}
    </div>
  );
}
