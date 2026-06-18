import { describe, it, expect } from "vitest";
import { deriveWorkflow, deriveActions, type WorkflowInput } from "@/lib/campaign-workflow";

const base: WorkflowInput = {
  hasPlan: false,
  planConfirmed: false,
  hasActuals: false,
  unmatchedCount: 0,
  expectedContribution: 1000,
  hasBaseline: true,
  notesCount: 0,
  isEnded: false,
};

function step(input: WorkflowInput, id: string) {
  return deriveWorkflow(input).find((s) => s.id === id)!;
}

describe("deriveWorkflow", () => {
  it("플랜 없음 → '플랜 작성'이 current", () => {
    const s = step(base, "plan");
    expect(s.status).toBe("current");
  });
  it("draft 플랜 → '플랜 확정'이 warning", () => {
    const s = step({ ...base, hasPlan: true }, "confirm");
    expect(s.status).toBe("warning");
  });
  it("확정 + 성과 없음 → '성과 업로드'가 current (진행 중)", () => {
    const s = step({ ...base, hasPlan: true, planConfirmed: true }, "link");
    expect(s.status).toBe("current");
  });
  it("확정 + 종료 + 성과 없음 → '성과 업로드'가 warning", () => {
    const s = step({ ...base, hasPlan: true, planConfirmed: true, isEnded: true }, "link");
    expect(s.status).toBe("warning");
  });
  it("성과 있음 + 미매칭 존재 → '매칭 검증'이 warning", () => {
    const s = step(
      { ...base, hasPlan: true, planConfirmed: true, hasActuals: true, unmatchedCount: 3 },
      "match",
    );
    expect(s.status).toBe("warning");
  });
  it("성과 있음 + 매칭 정상 → '매칭 검증' complete, '결과 검토' current", () => {
    const w = deriveWorkflow({
      ...base, hasPlan: true, planConfirmed: true, hasActuals: true, unmatchedCount: 0,
    });
    expect(w.find((s) => s.id === "match")!.status).toBe("complete");
    expect(w.find((s) => s.id === "review")!.status).toBe("current");
  });
  it("정확히 하나의 활성(current) 단계만 존재", () => {
    const w = deriveWorkflow({ ...base, hasPlan: true });
    expect(w.filter((s) => s.status === "current").length).toBeLessThanOrEqual(1);
  });
});

describe("deriveActions", () => {
  it("성과 0이면 '미매칭' 조치는 안 뜬다", () => {
    const acts = deriveActions(
      { ...base, hasPlan: true, planConfirmed: true, hasActuals: false, unmatchedCount: 5 },
      { promotionId: "p1" },
    );
    expect(acts.some((a) => a.id === "unmatched")).toBe(false);
  });
  it("성과 있고 기대공헌 0 이하면 danger 조치 노출", () => {
    const acts = deriveActions(
      { ...base, hasPlan: true, planConfirmed: true, hasActuals: true, expectedContribution: -100 },
      { promotionId: "p1" },
    );
    expect(acts.some((a) => a.id === "contrib" && a.tone === "danger")).toBe(true);
  });
  it("문제 없으면 조치 비어있음", () => {
    const acts = deriveActions(
      { ...base, hasPlan: true, planConfirmed: true, hasActuals: true, unmatchedCount: 0 },
      { promotionId: "p1" },
    );
    expect(acts.length).toBe(0);
  });
});
