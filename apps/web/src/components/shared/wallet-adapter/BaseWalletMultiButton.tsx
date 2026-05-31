"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useConnection } from "@solana/wallet-adapter-react";
import { WalletReadyState } from "@solana/wallet-adapter-base";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { useEffect, useMemo, useRef, useState } from "react";

import { BaseWalletConnectionButton } from "./BaseWalletConnectionButton";
import type { ButtonProps } from "./Button";
import { useWalletModal } from "./useWalletModal";

type Props = ButtonProps & {
  labels: {
    "copy-address": string;
    copied: string;
    "change-wallet": string;
    disconnect: string;
    "no-wallet": string;
    connecting: string;
  };
};

export function BaseWalletMultiButton({ children, labels, ...props }: Props) {
  const { setVisible: setModalVisible } = useWalletModal();
  const { wallet, connected, disconnect, publicKey, connecting } = useWallet();
  const { connection } = useConnection();

  const [menuOpen, setMenuOpen] = useState(false);
  const [balance, setBalance] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [airdropping, setAirdropping] = useState(false);
  const ref = useRef<HTMLUListElement>(null);
  const base58 = useMemo(() => publicKey?.toBase58(), [publicKey]);

  // Derive button state
  const buttonState = useMemo(() => {
    if (connecting) return "connecting" as const;
    if (connected) return "connected" as const;
    if (wallet) return "has-wallet" as const;
    return "no-wallet" as const;
  }, [connecting, connected, wallet]);

  // Fetch SOL balance
  useEffect(() => {
    if (!publicKey || !connection) return;

    let cancelled = false;

    const loadBalance = async () => {
      try {
        const lamports = await connection.getBalance(publicKey, "confirmed");
        if (!cancelled) {
          setBalance((Number(lamports) / Number(LAMPORTS_PER_SOL)).toFixed(4));
        }
      } catch {
        if (!cancelled) setBalance(null);
      }
    };

    loadBalance();
    const id = connection.onAccountChange(publicKey, (info) => {
      if (!cancelled) {
        setBalance((Number(info.lamports) / Number(LAMPORTS_PER_SOL)).toFixed(4));
      }
    });

    return () => {
      cancelled = true;
      connection.removeAccountChangeListener(id);
    };
  }, [publicKey, connection]);

  // Close dropdown on outside click
  useEffect(() => {
    const listener = (event: MouseEvent | TouchEvent) => {
      const node = ref.current;
      if (!node || node.contains(event.target as Node)) return;
      setMenuOpen(false);
    };

    document.addEventListener("mousedown", listener);
    document.addEventListener("touchstart", listener, { passive: true });
    return () => {
      document.removeEventListener("mousedown", listener);
      document.removeEventListener("touchstart", listener);
    };
  }, []);

  const resetWalletSelection = () => {
    localStorage.removeItem("walletName");
    if (disconnect) disconnect();
    setModalVisible(true);
  };

  const handleCopy = () => {
    if (base58) {
      navigator.clipboard.writeText(base58);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  const handleAirdrop = async () => {
    if (!publicKey || airdropping) return;
    setAirdropping(true);
    try {
      const sig = await connection.requestAirdrop(publicKey, LAMPORTS_PER_SOL);
      await connection.confirmTransaction(sig, "confirmed");
    } catch {
      // airdrop may fail on non-local clusters
    } finally {
      setAirdropping(false);
    }
  };

  const content = useMemo(() => {
    if (children) return children;
    if (connecting) return labels.connecting;
    if (publicKey) {
      const addr = publicKey.toBase58();
      return (
        <span>
          {addr.slice(0, 4)}..{addr.slice(-4)}
        </span>
      );
    }
    return labels["no-wallet"];
  }, [children, labels, publicKey, connecting]);

  return (
    <div className="relative">
      <BaseWalletConnectionButton
        {...props}
        aria-expanded={menuOpen}
        style={{
          pointerEvents: menuOpen ? "none" : "auto",
          ...props.style,
        }}
        onClick={() => {
          switch (buttonState) {
            case "no-wallet":
              setModalVisible(true);
              break;
            case "has-wallet":
              if (wallet?.readyState === WalletReadyState.NotDetected) {
                resetWalletSelection();
                break;
              }
              // Try to connect
              setModalVisible(true);
              break;
            case "connected":
              setMenuOpen(true);
              break;
          }
        }}
        walletIcon={connected ? wallet?.adapter.icon : ""}
        walletName={wallet?.adapter.name}
      >
        {content}
      </BaseWalletConnectionButton>

      {/* Dropdown */}
      {menuOpen && (
        <ul
          ref={ref}
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 min-w-[200px] overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl"
        >
          {/* Balance */}
          {balance != null && (
            <li className="px-3 py-2 text-center text-xs text-zinc-400">{balance} SOL</li>
          )}

          {/* Divider */}
          <li className="mx-2 border-t border-zinc-800" />

          {/* Copy address */}
          <li
            role="menuitem"
            tabIndex={0}
            className="cursor-pointer px-3 py-2 text-sm text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white list-none"
            onClick={handleCopy}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") handleCopy();
            }}
          >
            {copied ? labels.copied : labels["copy-address"]}
          </li>

          {/* Airdrop */}
          <li
            role="menuitem"
            tabIndex={0}
            className="cursor-pointer px-3 py-2 text-sm text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
            onClick={handleAirdrop}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") handleAirdrop();
            }}
          >
            {airdropping ? "Airdropping..." : "Airdrop 1 SOL"}
          </li>

          {/* Change wallet */}
          <li
            role="menuitem"
            tabIndex={0}
            className="cursor-pointer px-3 py-2 text-sm text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
            onClick={resetWalletSelection}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") resetWalletSelection();
            }}
          >
            {labels["change-wallet"]}
          </li>

          {/* Disconnect */}
          {disconnect && (
            <li
              role="menuitem"
              tabIndex={0}
              className="cursor-pointer px-3 py-2 text-sm text-red-400 transition-colors hover:bg-zinc-800 hover:text-red-300"
              onClick={() => {
                disconnect();
                setMenuOpen(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  disconnect();
                  setMenuOpen(false);
                }
              }}
            >
              {labels.disconnect}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
