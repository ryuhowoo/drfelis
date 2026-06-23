import { describe, it, expect } from "vitest";
import { sortRows } from "../table-sort";

type Row = { name: string; rev: number | null };
const rows: Row[] = [
  { name: "가", rev: 100 },
  { name: "나", rev: null },
  { name: "다", rev: 50 },
  { name: "라", rev: 300 },
];

describe("sortRows", () => {
  it("숫자 내림차순 — null은 바닥", () => {
    const r = sortRows(rows, "rev", "desc").map((x) => x.rev);
    expect(r).toEqual([300, 100, 50, null]);
  });
  it("숫자 오름차순 — null은 여전히 바닥", () => {
    const r = sortRows(rows, "rev", "asc").map((x) => x.rev);
    expect(r).toEqual([50, 100, 300, null]);
  });
  it("문자열 ko 로캘 정렬", () => {
    const r = sortRows(rows, "name", "asc").map((x) => x.name);
    expect(r).toEqual(["가", "나", "다", "라"]);
  });
  it("key=null이면 원본 순서 유지", () => {
    expect(sortRows(rows, null, "desc")).toBe(rows);
  });
  it("원본 배열을 변형하지 않음", () => {
    const before = rows.map((x) => x.rev);
    sortRows(rows, "rev", "asc");
    expect(rows.map((x) => x.rev)).toEqual(before);
  });
});
