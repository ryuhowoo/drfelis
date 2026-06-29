// 가격 매트릭스 계산 — 입력값은 가격(원)만, 할인율·마진율·추가구성·공헌이익은 모두 자동 산출.
// rate card 승수(mult, 기본 0.715) 기준. 시트(가격 마스터)와 동일한 식.

export const ADDON_DISCOUNT = 0.05; // 추가구성 기본 할인 5%

/** 묶음 종류 → 수량 */
export const TIER_QTY: Record<string, number> = {
  단품: 1,
  "2묶음": 2,
  "3묶음": 3,
  "4묶음": 4,
  "5묶음": 5,
  "6묶음": 6,
};
export const SALE_MODES = ["상시", "정기"] as const;
export type SaleMode = (typeof SALE_MODES)[number];
export const SANGSI_TIERS = ["단품", "2묶음", "3묶음", "4묶음", "5묶음", "6묶음"] as const;
export const JEONGGI_TIERS = ["단품", "2묶음", "4묶음"] as const; // 정기는 고정

/** 소비자가 대비 할인율 (세트가 / (소비자가×수량)). 값이 없으면 null. */
export function discountVsConsumer(setPrice: number | null, consumer: number | null, qty: number): number | null {
  if (setPrice == null || !consumer || qty <= 0) return null;
  return 1 - setPrice / (consumer * qty);
}

/** 마진율 = (상시가 − 원가) / 상시가 */
export function marginRate(regular: number | null, cost: number | null): number | null {
  if (!regular) return null;
  return (regular - (cost ?? 0)) / regular;
}

/** 추가구성 1개당 단가 = 상시가 × (1 − 추가할인). 100원 단위 내림(시트와 동일). */
export function addonUnitPrice(regular: number | null, discount = ADDON_DISCOUNT): number | null {
  if (!regular) return null;
  return Math.floor((regular * (1 - discount)) / 100) * 100;
}

/** 세트 공헌이익액 = 세트가 × mult − 원가 × 수량 */
export function contribution(setPrice: number | null, cost: number | null, qty: number, mult: number): number | null {
  if (setPrice == null) return null;
  return setPrice * mult - (cost ?? 0) * qty;
}

/** 세트 공헌이익률 = 공헌이익액 / 세트가 */
export function contributionRate(setPrice: number | null, cost: number | null, qty: number, mult: number): number | null {
  if (!setPrice) return null;
  const c = contribution(setPrice, cost, qty, mult);
  return c == null ? null : c / setPrice;
}
