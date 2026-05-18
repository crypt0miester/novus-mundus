/**
 * Flash Sale Data — predefined flash sales for `novus init shop`
 */

export interface FlashSaleData {
  itemId: number;
  isBundle: boolean;
  discountBps: number;       // max 5000 (50%)
  durationSecs: number;
  maxStock: number;
  autoActivate: boolean;     // start immediately on create
}

export const FLASH_SALES: FlashSaleData[] = [];
