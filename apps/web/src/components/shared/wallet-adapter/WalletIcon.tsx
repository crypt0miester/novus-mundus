import type { Wallet } from "@solana/wallet-adapter-react";
import type { FC } from "react";
import Image from "next/image";

interface WalletIconProps {
  wallet: { adapter: Pick<Wallet["adapter"], "icon" | "name"> } | null;
  connectionButtonClass?: string;
}

export const WalletIcon: FC<WalletIconProps> = ({ wallet, connectionButtonClass }) => {
  if (!wallet) return null;

  if (wallet.adapter.icon.includes("wallet-white.svg")) {
    return (
      <svg
        className="h-5 w-5 text-white"
        xmlns="http://www.w3.org/2000/svg"
        width="16.364"
        height="16.364"
        viewBox="0 0 16.364 16.364"
      >
        <path
          d="M96.7,71.889H87.027l7.592-1.546.752-.153.161-.033a.729.729,0,0,1,.861.523Z"
          transform="translate(-84.211 -67.601)"
          fill="currentColor"
        />
        <path
          d="M58.816,2,50.283,3.739,56.837.094a.748.748,0,0,1,.555-.07.721.721,0,0,1,.443.329Z"
          transform="translate(-48.47 0)"
          fill="currentColor"
        />
        <path
          d="M11.776,148.886a1.4,1.4,0,0,1-1.391-1.412v-2.118a1.4,1.4,0,0,1,1.391-1.412h3.173V141.3a.7.7,0,0,0-.7-.706H.7a.681.681,0,0,0-.378.114.7.7,0,0,0-.16.145A.708.708,0,0,0,0,141.3v10.236a.7.7,0,0,0,.7.706H14.253a.7.7,0,0,0,.7-.706v-2.647Z"
          transform="translate(0 -135.876)"
          fill="currentColor"
        />
        <path
          d="M327.746,257.127h-4.02a.719.719,0,0,0-.731.706v2.118a.719.719,0,0,0,.731.706h4.02a.719.719,0,0,0,.731-.706v-2.118a.719.719,0,0,0-.731-.706"
          transform="translate(-312.113 -248.295)"
          fill="currentColor"
        />
      </svg>
    );
  }

  return (
    <Image
      className={connectionButtonClass}
      src={wallet.adapter.icon}
      width={16}
      height={16}
      alt={`${wallet.adapter.name} icon`}
      unoptimized
    />
  );
};
