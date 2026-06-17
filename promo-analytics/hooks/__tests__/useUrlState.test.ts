import { describe, it, expect } from "vitest";
import { serializeUrlState, parseUrlState } from "@/hooks/useUrlState";

describe("url state serialize/parse (round-trip)", () => {
  const defaults = { type: "", season: "", sort: "score", stage: "all", purpose: [] as string[] };

  it("빈/기본값은 query에서 생략", () => {
    expect(serializeUrlState({ ...defaults })).toBe("sort=score&stage=all");
  });

  it("배열·문자열을 직렬화", () => {
    const qs = serializeUrlState({ ...defaults, type: "할인", purpose: ["재고소진", "브랜딩"] });
    const sp = new URLSearchParams(qs);
    expect(sp.get("type")).toBe("할인");
    expect(sp.getAll("purpose")).toEqual(["재고소진", "브랜딩"]);
  });

  it("parse는 존재하는 키만 덮어쓰고 나머지는 기본값", () => {
    const parsed = parseUrlState("type=할인&purpose=재고소진&purpose=세일즈", defaults);
    expect(parsed.type).toBe("할인");
    expect(parsed.purpose).toEqual(["재고소진", "세일즈"]);
    expect(parsed.sort).toBe("score"); // 기본값 유지
    expect(parsed.season).toBe("");
  });

  it("직렬화→파싱 라운드트립 복원", () => {
    const state = { ...defaults, type: "쿠폰", stage: "linked", purpose: ["브랜딩"] };
    const restored = parseUrlState(serializeUrlState(state), defaults);
    expect(restored).toEqual(state);
  });
});
