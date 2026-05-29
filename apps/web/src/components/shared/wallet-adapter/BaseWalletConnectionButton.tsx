import type { WalletName } from "@solana/wallet-adapter-base";
import type React from "react";

import { Button } from "./Button";
import { WalletIcon } from "./WalletIcon";

type Props = React.ComponentProps<typeof Button> & {
  walletIcon?: string;
  walletName?: WalletName;
};

export function BaseWalletConnectionButton({ walletIcon, walletName, ...props }: Props) {
  return (
    <Button
      {...props}
      className="wallet-adapter-button-trigger text-xs md:text-sm relative group"
      startIcon={
        walletIcon && walletName ? (
          <WalletIcon
            wallet={{
              adapter: {
                icon: walletIcon,
                name: walletName,
              },
            }}
            connectionButtonClass="ml-3"
          />
        ) : undefined
      }
    />
  );
}
