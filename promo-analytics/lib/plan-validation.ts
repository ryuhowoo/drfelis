// PR5: 플랜 옵션 검증 (순수 함수 — 테스트 대상). 확정 전 오류를 발생 위치에서 잡기 위함.
export type ValItem = {
  product_id: string;
  base_name: string;
  sku_qty_per_option: number;
  unit_sale_price: number;
  cost?: number | null;
};
export type ValOption = {
  key: string;
  option_label: string;
  expected_option_qty: number;
  is_main: boolean;
  items: ValItem[];
};

export type Issue = { level: "error" | "warn"; code: string; message: string };
export type OptionValidation = { key: string; issues: Issue[] };
export type PlanValidation = {
  byOption: Record<string, Issue[]>;
  plan: Issue[];
  errorCount: number;
  warnCount: number;
};

function signature(o: ValOption): string {
  return o.items
    .map((i) => `${i.product_id}:${i.sku_qty_per_option}`)
    .sort()
    .join("|");
}

export function validatePlan(options: ValOption[], mult: number): PlanValidation {
  const byOption: Record<string, Issue[]> = {};
  let errorCount = 0;
  let warnCount = 0;
  const add = (key: string, issue: Issue) => {
    (byOption[key] ??= []).push(issue);
    if (issue.level === "error") errorCount++;
    else warnCount++;
  };

  for (const o of options) {
    if (o.items.length === 0) {
      add(o.key, { level: "error", code: "no-sku", message: "옵션에 SKU가 없습니다." });
    }
    if (o.expected_option_qty <= 0) {
      add(o.key, { level: "warn", code: "zero-qty", message: "예상 판매수가 0입니다." });
    }
    // 세트가 ≤ 원가 (마진 0 이하)
    for (const it of o.items) {
      if (it.cost != null && it.cost > 0 && it.unit_sale_price > 0 && it.unit_sale_price <= it.cost) {
        add(o.key, {
          level: "warn",
          code: "price-le-cost",
          message: `'${it.base_name}' 판매단가가 원가 이하입니다.`,
        });
      }
    }
    // 옵션 공헌이익 ≤ 0
    const contrib = o.items.reduce(
      (s, it) => s + o.expected_option_qty * it.sku_qty_per_option * (it.unit_sale_price * mult - (it.cost ?? 0)),
      0,
    );
    if (o.items.length > 0 && o.expected_option_qty > 0 && contrib <= 0) {
      add(o.key, { level: "warn", code: "contrib-le-0", message: "옵션 공헌이익이 0 이하입니다." });
    }
    // 동일 SKU 중복
    const ids = o.items.map((i) => i.product_id);
    if (new Set(ids).size < ids.length) {
      add(o.key, { level: "warn", code: "dup-sku", message: "같은 SKU가 중복 추가되었습니다." });
    }
  }

  // 동일 구성 시그니처 중복
  const sigCount = new Map<string, number>();
  for (const o of options) {
    if (o.items.length === 0) continue;
    const sig = signature(o);
    sigCount.set(sig, (sigCount.get(sig) ?? 0) + 1);
  }
  for (const o of options) {
    if (o.items.length === 0) continue;
    if ((sigCount.get(signature(o)) ?? 0) > 1) {
      add(o.key, { level: "warn", code: "dup-composition", message: "동일 구성의 옵션이 중복됩니다." });
    }
  }

  // 플랜 레벨 — 메인 지정
  // 메인 제품(퍼펙트·세븐플러스)은 맛·수량별로 옵션을 잘게 나누므로 메인 옵션 수가 많은 건
  // 정상이다. 따라서 '메인 과다' 경고는 두지 않고, 메인 미지정만 경고한다.
  const plan: Issue[] = [];
  const mainCount = options.filter((o) => o.is_main).length;
  if (options.length > 0 && mainCount === 0) {
    plan.push({ level: "warn", code: "no-main", message: "메인 제품이 지정되지 않았습니다." });
    warnCount++;
  }

  return { byOption, plan, errorCount, warnCount };
}
