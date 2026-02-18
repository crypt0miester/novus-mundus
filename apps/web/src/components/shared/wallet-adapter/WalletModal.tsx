import type { WalletName } from "@solana/wallet-adapter-base";
import { WalletReadyState } from "@solana/wallet-adapter-base";
import type { Wallet } from "@solana/wallet-adapter-react";
import { useWallet } from "@solana/wallet-adapter-react";
import type { FC, MouseEvent } from "react";
import React, {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { useWalletModal } from "./useWalletModal";
import { WalletIcon } from "./WalletIcon";
import { WalletListItem } from "./WalletListItem";

// Wallet download URLs
const WALLET_DOWNLOAD_URLS: Record<string, string> = {
  backpack: "https://backpack.app/download",
  "coinbase wallet": "https://www.coinbase.com/wallet/downloads",
  phantom: "https://phantom.app/download",
  solflare: "https://solflare.com/download",
};

function isSafariIOSMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

export interface WalletModalProps {
  className?: string;
  container?: string;
}

export const WalletModal: FC<WalletModalProps> = ({
  className = "",
  container = "body",
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const { wallets, select } = useWallet();
  const { setVisible } = useWalletModal();
  const [fadeIn, setFadeIn] = useState(false);
  const [portal, setPortal] = useState<Element | null>(null);
  const [getWalletDropdownOpen, setGetWalletDropdownOpen] = useState(false);
  const [moreWalletsOpen, setMoreWalletsOpen] = useState(false);

  // Separate installed wallets from others
  const { installedWallets, otherWallets } = useMemo(() => {
    const installed: Wallet[] = [];
    const others: Wallet[] = [];

    const seenNames = new Set<string>();

    const getDedupeKey = (name: string): string => {
      if (name.toLowerCase().includes("metamask")) return "metamask";
      return name.toLowerCase();
    };

    const isSafariMobile = isSafariIOSMobile();
    const safariMobileWalletNames = [
      "phantom",
      "solflare",
      "backpack",
      "bitget",
    ];

    for (const wallet of wallets) {
      const dedupeKey = getDedupeKey(wallet.adapter.name);
      const walletNameLower = wallet.adapter.name.toLowerCase();

      if (seenNames.has(dedupeKey)) continue;
      if (wallet.adapter.name === "Phantom Embedded") continue;

      if (
        isSafariMobile &&
        !safariMobileWalletNames.includes(walletNameLower)
      ) {
        continue;
      }

      seenNames.add(dedupeKey);

      if (wallet.readyState === WalletReadyState.Installed) {
        installed.push(wallet);
      } else {
        others.push(wallet);
      }
    }

    installed.sort((a, b) => a.adapter.name.localeCompare(b.adapter.name));
    others.sort((a, b) => a.adapter.name.localeCompare(b.adapter.name));

    return { installedWallets: installed, otherWallets: others };
  }, [wallets]);

  // Get wallet objects for the download dropdown
  const downloadWallets = useMemo(() => {
    return Object.keys(WALLET_DOWNLOAD_URLS)
      .map((name) => {
        const wallet = wallets.find(
          (w) => w.adapter.name.toLowerCase() === name,
        );
        return wallet ? { wallet, url: WALLET_DOWNLOAD_URLS[name] } : null;
      })
      .filter(Boolean) as { wallet: Wallet; url: string }[];
  }, [wallets]);

  const hideModal = useCallback(() => {
    setFadeIn(false);
    setTimeout(() => setVisible(false), 150);
  }, [setVisible]);

  const handleClose = useCallback(
    (event: MouseEvent) => {
      event.preventDefault();
      hideModal();
    },
    [hideModal],
  );

  const handleWalletClick = useCallback(
    (event: MouseEvent, walletName: WalletName) => {
      select(walletName);
      handleClose(event);
    },
    [select, handleClose],
  );

  const handleTabKey = useCallback(
    (event: KeyboardEvent) => {
      const node = ref.current;
      if (!node) return;

      const focusableElements = node.querySelectorAll("button");
      const firstElement = focusableElements[0]!;
      const lastElement = focusableElements[focusableElements.length - 1]!;

      if (event.shiftKey) {
        if (document.activeElement === firstElement) {
          lastElement.focus();
          event.preventDefault();
        }
      } else {
        if (document.activeElement === lastElement) {
          firstElement.focus();
          event.preventDefault();
        }
      }
    },
    [ref],
  );

  useLayoutEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        hideModal();
      } else if (event.key === "Tab") {
        handleTabKey(event);
      }
    };

    const { overflow } = window.getComputedStyle(document.body);
    setTimeout(() => setFadeIn(true), 0);
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown, false);

    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", handleKeyDown, false);
    };
  }, [hideModal, handleTabKey]);

  useLayoutEffect(
    () => setPortal(document.querySelector(container)),
    [container],
  );

  return (
    portal &&
    createPortal(
      <>
        {/* Custom scrollbar */}
        <style>{`
          .wallet-modal-scrollbar::-webkit-scrollbar {
            width: 3px;
          }
          .wallet-modal-scrollbar::-webkit-scrollbar-track {
            background: transparent;
          }
          .wallet-modal-scrollbar::-webkit-scrollbar-thumb {
            background: #d97706;
            border-radius: 3px;
          }
          .wallet-modal-scrollbar::-webkit-scrollbar-thumb:hover {
            background: #b45309;
          }
          .wallet-modal-scrollbar {
            scrollbar-width: thin;
            scrollbar-color: #d97706 transparent;
          }
        `}</style>
        <div
          ref={ref}
          aria-labelledby="wallet-adapter-modal-title"
          aria-modal="true"
          role="dialog"
          className={`fixed inset-0 z-50 flex items-end justify-end sm:items-center sm:justify-center bg-black/50 backdrop-blur-sm transition-opacity duration-150 ${fadeIn ? "opacity-100" : "opacity-0"} ${className}`}
          onClick={(e) => {
            if (e.target === e.currentTarget) hideModal();
          }}
        >
          <div
            className="sm:rounded-2xl rounded-t-2xl p-[2px] w-full sm:w-auto"
            style={{
              background:
                "linear-gradient(270deg, #fbbf24 0%, #92400e 100%)",
            }}
          >
            <div className="sm:w-[680px] max-w-[99vw] mx-auto overflow-hidden w-full bg-zinc-950 relative flex flex-col sm:rounded-xl rounded-t-xl max-h-[85vh]">
              {/* Header */}
              <div className="px-5 py-4 flex justify-between items-center">
                <div className="font-semibold text-lg text-white">
                  Connect a Wallet
                </div>
                <button
                  onClick={handleClose}
                  className="p-2 hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer"
                >
                  <svg
                    width="14"
                    height="14"
                    className="fill-zinc-400"
                  >
                    <path d="M14 12.461 8.3 6.772l5.234-5.233L12.006 0 6.772 5.234 1.54 0 0 1.539l5.234 5.233L0 12.006l1.539 1.528L6.772 8.3l5.69 5.7L14 12.461z" />
                  </svg>
                </button>
              </div>

              {/* Gradient Divider */}
              <div
                className="h-[2px] w-11/12 mx-auto rounded-full"
                style={{
                  background:
                    "linear-gradient(270deg, #fbbf24 0%, #92400e 100%)",
                }}
              />

              {/* Two-Column Content */}
              <div className="flex flex-col sm:flex-row flex-1 overflow-hidden sm:gap-4">
                {/* Left Column - Wallet List */}
                <div className="w-full sm:w-1/2 flex flex-col overflow-hidden sm:pl-4">
                  <div className="flex-1 overflow-y-auto px-4 py-4 sm:py-4 sm:px-2 sm:pr-2 space-y-3 wallet-modal-scrollbar">
                    {/* Installed Wallets */}
                    {installedWallets.length > 0 && (
                      <div className="space-y-2">
                        <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wide px-1">
                          Installed
                        </div>
                        <div className="space-y-1">
                          {installedWallets.map((wallet) => (
                            <WalletListItem
                              key={wallet.adapter.name}
                              handleClick={(event) =>
                                handleWalletClick(event, wallet.adapter.name)
                              }
                              wallet={wallet}
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    {/* More Wallets - Accordion */}
                    {otherWallets.length > 0 && (
                      <div className="space-y-2">
                        {installedWallets.length > 0 && (
                          <div className="border-t border-zinc-800 pt-2" />
                        )}

                        <button
                          onClick={() => setMoreWalletsOpen(!moreWalletsOpen)}
                          className="flex items-center gap-2 text-xs font-semibold text-zinc-500 uppercase tracking-wide px-1 hover:text-zinc-300 transition-colors w-full cursor-pointer"
                        >
                          <span>
                            {installedWallets.length > 0
                              ? "More Wallets"
                              : "Available Wallets"}
                          </span>
                          <svg
                            width="10"
                            height="10"
                            viewBox="0 0 12 12"
                            fill="none"
                            className={`transition-transform duration-200 ${
                              moreWalletsOpen ? "rotate-180" : ""
                            }`}
                          >
                            <path
                              d="M2.5 4.5L6 8L9.5 4.5"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                          <span className="text-[10px] font-normal normal-case">
                            ({otherWallets.length})
                          </span>
                        </button>

                        <div
                          className={`overflow-hidden transition-all duration-200 ${
                            moreWalletsOpen
                              ? "max-h-[1000px] opacity-100"
                              : "max-h-0 opacity-0"
                          }`}
                        >
                          <div className="space-y-1">
                            {otherWallets.map((wallet) => (
                              <WalletListItem
                                key={wallet.adapter.name}
                                handleClick={(event) =>
                                  handleWalletClick(event, wallet.adapter.name)
                                }
                                wallet={wallet}
                              />
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Vertical Divider */}
                <div className="hidden sm:block w-px bg-zinc-800" />

                {/* Right Column - Info Panel */}
                <div className="hidden sm:flex sm:w-1/2 flex-col p-5 bg-zinc-900/50 overflow-y-auto wallet-modal-scrollbar">
                  <div className="space-y-5">
                    <div>
                      <h3 className="text-lg font-semibold text-white">
                        New to Solana?
                      </h3>
                      <p className="text-sm text-zinc-400 mt-1">
                        A wallet is needed to interact with the blockchain
                      </p>
                    </div>

                    {/* Download a Wallet - Accordion */}
                    <div className="border-t border-zinc-800 pt-4">
                      <button
                        onClick={() =>
                          setGetWalletDropdownOpen(!getWalletDropdownOpen)
                        }
                        className="flex items-center gap-2 text-sm text-zinc-400 hover:text-zinc-300 transition-colors cursor-pointer"
                      >
                        <span className="underline underline-offset-2">
                          Download a wallet
                        </span>
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 12 12"
                          fill="none"
                          className={`transition-transform duration-200 ${
                            getWalletDropdownOpen ? "rotate-180" : ""
                          }`}
                        >
                          <path
                            d="M2.5 4.5L6 8L9.5 4.5"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>

                      <div
                        className={`overflow-hidden transition-all duration-200 ${
                          getWalletDropdownOpen
                            ? "max-h-[200px] opacity-100 mt-3"
                            : "max-h-0 opacity-0"
                        }`}
                      >
                        <div className="space-y-1">
                          {downloadWallets.map(({ wallet, url }) => (
                            <a
                              key={wallet.adapter.name}
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-zinc-800 transition-colors text-sm text-zinc-400 hover:text-white cursor-pointer"
                            >
                              <div className="w-5 h-5 rounded overflow-hidden flex items-center justify-center">
                                <WalletIcon wallet={wallet} />
                              </div>
                              <span className="flex-1">
                                {wallet.adapter.name}
                              </span>
                              <svg
                                width="12"
                                height="12"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                className="opacity-50"
                              >
                                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                                <polyline points="15 3 21 3 21 9" />
                                <line x1="10" y1="14" x2="21" y2="3" />
                              </svg>
                            </a>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Mobile Footer */}
              <div className="sm:hidden border-t border-zinc-800 px-4 py-4 bg-zinc-900/50 space-y-3">
                <p className="text-xs text-zinc-500 text-center">
                  Download a wallet to get started
                </p>
                <div className="space-y-1">
                  {downloadWallets.map(({ wallet, url }) => (
                    <a
                      key={wallet.adapter.name}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-zinc-800 transition-colors text-sm text-zinc-400 cursor-pointer"
                    >
                      <div className="w-6 h-6 rounded overflow-hidden flex items-center justify-center">
                        <WalletIcon wallet={wallet} />
                      </div>
                      <span className="flex-1">{wallet.adapter.name}</span>
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        className="opacity-50"
                      >
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                        <polyline points="15 3 21 3 21 9" />
                        <line x1="10" y1="14" x2="21" y2="3" />
                      </svg>
                    </a>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </>,
      portal,
    )
  );
};
