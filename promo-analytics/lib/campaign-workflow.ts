// PR2: 캠페인 생애주기 상태 머신 + 조치 도출 (순수 함수 — 테스트 대상).
// 새 모델(한 캠페인=플랜+성과): 데이터 준비 → 플랜 작성 → 플랜 확정 → 성과 업로드 →
// 매칭 검증 → 결과 검토 → 회고. '실적 연결'(옛 교차연결)은 제거 — 성과는 이 캠페인에 직접 올린다.
import type { WorkflowStatus } from "@/lib/status";

export type StepId = "data" | "plan" | "confirm" | "link" | "match" | "review" | "retro";

export type WorkflowInput = {
  hasPlan: boolean;
  planConfirmed: boolean;
  hasActuals: boolean; // 이 캠페인에 성과(실적 매출) 데이터가 실제로 있는지
  unmatchedCount: number; // 미매칭 SKU 수 (성과가 있을 때만 의미)
  expectedContribution: number | null;
  hasBaseline: boolean;
  notesCount: number;
  isEnded: boolean; // 캠페인 종료일 경과
};

export type WorkflowStep = {
  id: StepId;
  label: string;
  status: WorkflowStatus;
  description: string;
  view?: string; // 상세 탭으로 이동
  actionLabel?: string;
};

const ORDER: { id: StepId; label: string; view?: string }[] = [
  { id: "data", label: "데이터 준비", view: "overview" },
  { id: "plan", label: "플랜 작성" },
  { id: "confirm", label: "플랜 확정" },
  { id: "link", label: "성과 업로드", view: "overview" },
  { id: "match", label: "매칭 검증", view: "skus" },
  { id: "review", label: "결과 검토", view: "overview" },
  { id: "retro", label: "회고", view: "sources" },
];

export function deriveWorkflow(i: WorkflowInput): WorkflowStep[] {
  const done: Record<StepId, boolean> = {
    data: i.hasBaseline,
    plan: i.hasPlan,
    confirm: i.planConfirmed,
    link: i.hasActuals,
    match: i.hasActuals && i.unmatchedCount === 0,
    review: i.notesCount > 0, // 검토는 회고로 완료 처리
    retro: i.notesCount > 0,
  };

  // 활성(current) 단계 = 완료되지 않은 첫 단계. 그 앞 단계가 안 되어 있으면 blocked.
  let currentAssigned = false;

  return ORDER.map((s, idx) => {
    const prev = ORDER[idx - 1];
    const prevDone = idx === 0 ? true : done[prev.id];
    let status: WorkflowStatus;
    let description = "";
    let actionLabel: string | undefined;

    if (done[s.id]) {
      status = "complete";
      description = COMPLETE_DESC[s.id];
    } else if (!currentAssigned) {
      currentAssigned = true;
      // 활성 단계 — 문제성이면 warning/blocked, 아니면 current
      if (s.id === "data") {
        status = "warning";
        description = "baseline이 얕습니다 — 일별 매출 추이가 쌓일수록 증분이 정확해집니다(차단 아님).";
        actionLabel = "데이터 업로드";
      } else if (s.id === "confirm" && i.hasPlan) {
        status = "warning";
        description = "draft 플랜입니다. 확정해야 달성률 집계에 포함됩니다.";
        actionLabel = "플랜 확정";
      } else if (s.id === "link" && !prevDone) {
        status = "blocked";
        description = "플랜을 먼저 확정하세요.";
      } else if (s.id === "link") {
        // 성과 업로드 대기 — 종료된 캠페인이면 더 강하게(warning)
        status = i.isEnded ? "warning" : "current";
        description = i.isEnded
          ? "캠페인이 끝났습니다. 동기간 성과 시트를 올리면 달성률이 채워집니다."
          : "캠페인 종료 후 성과 시트를 올리면 옵션/SKU 달성률이 자동 분류됩니다.";
        actionLabel = "성과 올리기";
      } else if (s.id === "match" && i.hasActuals && i.unmatchedCount > 0) {
        status = "warning";
        description = `미매칭 SKU ${i.unmatchedCount}개 — 보정이 필요합니다.`;
        actionLabel = "매칭 보정";
      } else if (!prevDone) {
        status = "blocked";
        description = "이전 단계를 먼저 완료하세요.";
      } else {
        status = "current";
        description = CURRENT_DESC[s.id];
        actionLabel = CURRENT_ACTION[s.id];
      }
    } else {
      status = "pending";
      description = "";
    }
    return { id: s.id, label: s.label, status, description, view: s.view, actionLabel };
  });
}

const COMPLETE_DESC: Record<StepId, string> = {
  data: "측정 데이터 준비됨",
  plan: "플랜 작성됨",
  confirm: "플랜 확정됨",
  link: "성과 업로드됨",
  match: "모든 SKU 매칭 정상",
  review: "결과 검토 완료",
  retro: "회고 메모 작성됨",
};
const CURRENT_DESC: Record<StepId, string> = {
  data: "측정 데이터 확인",
  plan: "옵션·예상 세트수로 플랜을 작성하세요.",
  confirm: "플랜을 확정하세요.",
  link: "성과 시트를 올리세요.",
  match: "SKU·옵션 매칭을 검증하세요.",
  review: "달성 결과를 검토하세요.",
  retro: "성과 원인·회고를 남기세요.",
};
const CURRENT_ACTION: Record<StepId, string> = {
  data: "데이터 보기",
  plan: "플랜 만들기",
  confirm: "플랜 확정",
  link: "성과 올리기",
  match: "매칭 검증",
  review: "결과 보기",
  retro: "회고 작성",
};

// ── 즉시 조치 (Layer B) — 문제 있는 것만 ──────────────────────────
export type Tone2 = "warning" | "danger" | "info";
export type ActionItem = {
  id: string;
  tone: Tone2;
  title: string;
  body?: string;
  actionLabel?: string;
  view?: string;
  href?: string;
  hash?: string; // 같은 탭 내 특정 패널로 스크롤 (예: #sku-match)
};

export function deriveActions(
  i: WorkflowInput,
  ctx: { promotionId: string },
): ActionItem[] {
  const a: ActionItem[] = [];
  if (!i.hasPlan) {
    a.push({ id: "no-plan", tone: "info", title: "플랜이 없습니다", body: "옵션·예상 세트수로 예상 성과를 미리 계산하세요.", actionLabel: "플랜 만들기", href: `/promotions/${ctx.promotionId}/plan` });
  } else if (!i.planConfirmed) {
    a.push({ id: "draft", tone: "warning", title: "draft 플랜 — 확정 필요", body: "확정해야 달성률 집계·홈 페이싱 알림에 포함됩니다.", actionLabel: "플랜 편집", href: `/promotions/${ctx.promotionId}/plan` });
  }
  // 성과 매칭 보정은 '성과가 실제로 있을 때만' 노출 (성과 0인데 미매칭 노티 X)
  if (i.hasActuals && i.unmatchedCount > 0) {
    a.push({ id: "unmatched", tone: "warning", title: `미매칭 SKU ${i.unmatchedCount}개`, body: "자동 매칭이 빗나간 항목을 보정하세요.", actionLabel: "매칭 보정", view: "skus", hash: "sku-match" });
  }
  if (i.hasActuals && i.expectedContribution != null && i.expectedContribution <= 0) {
    a.push({ id: "contrib", tone: "danger", title: "기대 공헌이익이 0 이하", body: "플랜의 원가·옵션 단가 적재를 확인하세요.", actionLabel: "플랜 확인", href: `/promotions/${ctx.promotionId}/plan` });
  }
  return a;
}

