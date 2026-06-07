import type { Wallet } from "@solana/wallet-adapter-react";
import type { FC, MouseEventHandler } from "react";

import { WalletIcon } from "./WalletIcon";

interface WalletListItemProps {
  handleClick: MouseEventHandler<HTMLButtonElement>;
  tabIndex?: number;
  wallet: Wallet;
}

const formatWalletName = (name: string): string => {
  if (name === "Coinbase Wallet") return "Coinbase";
  if (name === "HuobiWallet") return "Huobi";
  if (name === "Google via TipLink") return "TipLink";
  return name;
};

export const WalletListItem: FC<WalletListItemProps> = ({ handleClick, tabIndex, wallet }) => {
  const walletName = formatWalletName(wallet.adapter.name);

  return (
    <button
      onClick={handleClick}
      tabIndex={tabIndex}
      className="w-full sm:max-w-64 px-3 py-2.5 sm:px-2.5 sm:py-2.5 flex items-center justify-between bg-surface hover:bg-surface-overlay rounded-lg transition-colors group cursor-pointer"
    >
      <div className="flex items-center gap-2.5">
        <div className="w-7 h-7 rounded-md flex items-center justify-center overflow-hidden bg-surface-overlay">
          <WalletIcon wallet={wallet} />
        </div>
        <span className="font-medium text-sm text-text-primary">{walletName}</span>
      </div>
      <svg
        width="14"
        height="14"
        viewBox="0 0 20 20"
        fill="none"
        className="text-text-muted group-hover:text-text-gold transition-colors"
      >
        <path
          d="M7.5 15L12.5 10L7.5 5"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
};
