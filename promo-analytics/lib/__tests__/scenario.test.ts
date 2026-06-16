import { describe, it, expect } from "vitest";
import {
  scenarioLabel,
  encodeScenarios,
  decodeScenarios,
  diffPct,
  specToSeedQuery,
  parseSeedQuery,
  type SavedScenario,
} from "@/lib/scenario";

describe("scenario url encode/decode", () => {
  const list: SavedScenario[] = [
    { id: "a", name: "기본", promoType: "할인", season: "여름", purpose: "재고소진", discount: 40, days: 4 },
    { id: "b", name: "공격적 시나리오", promoType: "쿠폰", season: "", purpose: "", discount: 60, days: 7 },
  ];

  it("라운드트립 — 값 복원(id/name 제외 동일)", () => {
    const restored = decodeScenarios(encodeScenarios(list));
    expect(restored).toHaveLength(2);
    expect(restored[0]).toMatchObject({
      name: "기본", promoType: "할인", season: "여름", purpose: "재고소진", discount: 40, days: 4,
    });
    expect(restored[1]).toMatchObject({ name: "공격적 시나리오", promoType: "쿠폰", discount: 60, days: 7 });
  });

  it("특수문자(~;)가 라벨에 있어도 안전", () => {
    const tricky: SavedScenario[] = [
      { id: "x", name: "A~B;C", promoType: "할인", season: "", purpose: "", discount: 10, days: 2 },
    ];
    expect(decodeScenarios(encodeScenarios(tricky))[0].name).toBe("A~B;C");
  });

  it("빈/널 입력은 빈 배열", () => {
    expect(decodeScenarios("")).toEqual([]);
    expect(decodeScenarios(null)).toEqual([]);
  });

  it("범위 밖 숫자는 안전 기본값으로 보정", () => {
    const r = decodeScenarios("이상치~할인~~~999~99");
    expect(r[0].discount).toBe(70); // 0~70 클램프
    expect(r[0].days).toBe(31); // 1~31 클램프
  });
});

describe("scenarioLabel", () => {
  it("조건 요약 문자열", () => {
    expect(scenarioLabel({ promoType: "할인", season: "여름", purpose: "세일즈", discount: 40, days: 4 }))
      .toBe("할인 40%·4일·여름·세일즈");
    expect(scenarioLabel({ promoType: "", season: "", purpose: "", discount: 0, days: 1 }))
      .toBe("전체 0%·1일");
  });
});

describe("diffPct", () => {
  it("상대 차이", () => {
    expect(diffPct(100, 120)).toBeCloseTo(0.2);
    expect(diffPct(100, 80)).toBeCloseTo(-0.2);
  });
  it("기준 0/비유한이면 null", () => {
    expect(diffPct(0, 10)).toBeNull();
    expect(diffPct(NaN, 10)).toBeNull();
  });
});

describe("plan seed query", () => {
  it("specToSeedQuery → parseSeedQuery 라운드트립", () => {
    const q = specToSeedQuery({ promoType: "할인", season: "여름", purpose: "재고소진", discount: 35, days: 5 });
    const parsed = parseSeedQuery(q);
    expect(parsed).toMatchObject({ active: true, promoType: "할인", season: "여름", purpose: "재고소진", discount: 35, days: 5 });
  });
  it("plan_seed 없으면 null", () => {
    expect(parseSeedQuery("foo=bar")).toBeNull();
  });
});
