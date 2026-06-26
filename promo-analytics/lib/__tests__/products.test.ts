import { describe, it, expect } from "vitest";
import { productKind, isComponentName } from "../products";

describe("productKind — 이름 접두로 종류 판별", () => {
  it("판매 상품군", () => {
    expect(productKind("(제품) 데일리 솔루션 퍼펙트 연어 150g")).toBe("제품");
    expect(productKind("(세트) 1+1 포캣파우더")).toBe("세트");
    expect(productKind("(상품) 스네이크 낚시대 - 1p")).toBe("상품");
  });
  it("구성품군", () => {
    expect(productKind("(원재료) 포캣츄 연어 14g")).toBe("원재료");
    expect(productKind("(부재료) 단상자")).toBe("부재료");
    expect(productKind("(부자재) 브랜드 택배박스 2호")).toBe("부자재");
  });
  it("접두 없음/널은 기타", () => {
    expect(productKind("펠리스샌드 마스터 4.3kg")).toBe("기타");
    expect(productKind(null)).toBe("기타");
    expect(productKind("")).toBe("기타");
  });
  it("isComponentName 은 구성품군만 true", () => {
    expect(isComponentName("(부자재) 택배박스")).toBe(true);
    expect(isComponentName("(제품) 연어")).toBe(false);
    expect(isComponentName("펠리스샌드")).toBe(false);
  });
});
