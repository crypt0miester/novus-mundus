import type { PublicKey } from "@solana/web3.js";
import type { ParsedAssetV1, HeroTemplateAccount } from "novus-mundus-sdk";

export interface HeroData {
  address: PublicKey;
  asset: ParsedAssetV1;
}

export interface TemplateInfo {
  account: HeroTemplateAccount;
  minted: boolean;
}

export type Selection =
  | { type: "locked"; slot: number; hero: HeroData }
  | { type: "unlocked"; hero: HeroData }
  | { type: "template"; info: TemplateInfo }
  | null;
