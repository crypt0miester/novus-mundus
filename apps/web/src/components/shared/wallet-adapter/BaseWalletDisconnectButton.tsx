import { useWallet } from "@solana/wallet-adapter-react";
import React, { useMemo } from "react";

import { BaseWalletConnectionButton } from "./BaseWalletConnectionButton";
import type { ButtonProps } from "./Button";

type ButtonState = "disconnecting" | "has-wallet" | "no-wallet";

type Props = ButtonProps & {
  labels: Record<ButtonState, string>;
};

export function BaseWalletDisconnectButton({
  children,
  disabled,
  labels,
  onClick,
  ...props
}: Props) {
  const { wallet, disconnect, disconnecting } = useWallet();

  const buttonState = useMemo((): ButtonState => {
    if (disconnecting) return "disconnecting";
    if (wallet) return "has-wallet";
    return "no-wallet";
  }, [disconnecting, wallet]);

  return (
    <BaseWalletConnectionButton
      {...props}
      disabled={disabled || !wallet}
      onClick={(e) => {
        if (onClick) onClick(e);
        if (e.defaultPrevented) return;
        if (disconnect) disconnect().catch(() => {});
      }}
      walletIcon={wallet?.adapter.icon}
      walletName={wallet?.adapter.name}
    >
      {children ? children : labels[buttonState]}
    </BaseWalletConnectionButton>
  );
}
