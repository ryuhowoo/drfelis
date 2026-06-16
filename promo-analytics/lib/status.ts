// PR1: 앱 전역 의미 상태 토큰 — 색상만이 아니라 라벨·힌트를 함께 제공(접근성).
// 화면별로 Tailwind 색을 직접 쓰지 말고 여기 tone을 통해 일관 적용.

export type Tone =
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "subscription"
  | "brand"
  | "neutral";

// soft = 옅은 배경+진한 텍스트(배지/칩), solid = 채움(강조)
export const TONE_CLASSES: Record<Tone, { soft: string; solid: string; text: string }> = {
  success: { soft: "bg-success-soft text-success", solid: "bg-success text-white", text: "text-success" },
  warning: { soft: "bg-warning-soft text-warning", solid: "bg-warning text-white", text: "text-warning" },
  danger: { soft: "bg-danger-soft text-danger", solid: "bg-danger text-white", text: "text-danger" },
  info: { soft: "bg-info-soft text-info", solid: "bg-info text-white", text: "text-info" },
  subscription: {
    soft: "bg-subscription-soft text-subscription",
    solid: "bg-subscription text-white",
    text: "text-subscription",
  },
  brand: { soft: "bg-brand-50 text-brand-700", solid: "bg-brand-500 text-white", text: "text-brand-700" },
  neutral: { soft: "bg-soft text-ink-3", solid: "bg-ink-3 text-white", text: "text-ink-3" },
};

// 매칭 신뢰도 — 앱 전체에서 일관 사용 (지시서 §3)
export type MatchSource = "routed" | "recommended" | "manual" | "sku" | "none";
export const MATCH_STATUS: Record<MatchSource, { label: string; tone: Tone; hint: string }> = {
  routed: { label: "정확 매칭", tone: "success", hint: "구성·개입수(묶음)가 정확히 일치합니다." },
  recommended: { label: "추천 매칭", tone: "info", hint: "이름 유사도 기반 추천 — 확인 후 확정하세요." },
  manual: { label: "수동 매칭", tone: "brand", hint: "사용자가 직접 지정한 매핑입니다." },
  sku: { label: "SKU 폴백", tone: "info", hint: "개입수가 맞지 않아 SKU 실적으로 폴백했습니다." },
  none: { label: "미매칭", tone: "neutral", hint: "아직 매칭되지 않았습니다." },
};

// 캠페인 생애주기 단계 상태 (지시서 P0-1)
export type WorkflowStatus = "complete" | "current" | "warning" | "blocked" | "pending";
export const WORKFLOW_TONE: Record<WorkflowStatus, Tone> = {
  complete: "success",
  current: "brand",
  warning: "warning",
  blocked: "danger",
  pending: "neutral",
};
