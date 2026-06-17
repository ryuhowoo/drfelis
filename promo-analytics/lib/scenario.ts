// PR7: 시뮬레이터 시나리오 — 공유 가능한 URL 인코딩 + 기준 대비 차이.
// 순수 헬퍼(테스트 대상). React/DOM 의존 없음.

export type SimSpec = {
  promoType: string;
  season: string;
  purpose: string;
  discount: number; // %
  days: number;
};

export type SavedScenario = SimSpec & { id: string; name: string };

export type ScenarioMetrics = {
  ratio: number | null; // 평소 대비 배수
  uplift: number; // 예상 총 증분
  contribution: number; // 예상 공헌이익
};

const clampNum = (v: number, lo: number, hi: number, dflt: number): number =>
  Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt;

// 사람이 읽는 시나리오 라벨 (조건 요약)
export function scenarioLabel(s: SimSpec): string {
  return (
    `${s.promoType || "전체"} ${s.discount}%·${s.days}일` +
    (s.season ? `·${s.season}` : "") +
    (s.purpose ? `·${s.purpose}` : "")
  );
}

// 시나리오 목록 → URL 토큰 (각 필드 encodeURIComponent, ~ 구분, ; 연결)
export function encodeScenarios(list: SavedScenario[]): string {
  return list
    .map((s) =>
      [s.name, s.promoType, s.season, s.purpose, String(s.discount), String(s.days)]
        // encodeURIComponent는 ~를 그대로 두므로 구분자 충돌 방지 위해 추가 이스케이프
        .map((x) => encodeURIComponent(x ?? "").replace(/~/g, "%7E"))
        .join("~"),
    )
    .join(";");
}

// URL 토큰 → 시나리오 목록 (잘못된 값은 안전 기본값으로 보정)
export function decodeScenarios(raw: string | null | undefined): SavedScenario[] {
  if (!raw) return [];
  return raw
    .split(";")
    .filter(Boolean)
    .map((chunk, i) => {
      const parts = chunk.split("~").map((x) => {
        try {
          return decodeURIComponent(x ?? "");
        } catch {
          return "";
        }
      });
      const [name, promoType, season, purpose, discount, days] = parts;
      return {
        id: `s${i}-${Date.now().toString(36)}`,
        name: name || `시나리오 ${i + 1}`,
        promoType: promoType || "",
        season: season || "",
        purpose: purpose || "",
        discount: clampNum(Number(discount), 0, 70, 40),
        days: clampNum(Number(days), 1, 31, 4),
      };
    });
}

// 기준값 대비 상대 차이(비율). 기준이 0/비유한이면 null.
export function diffPct(base: number, val: number): number | null {
  if (!Number.isFinite(base) || base === 0) return null;
  return (val - base) / Math.abs(base);
}

// 시뮬레이터 조건 → 플랜 시드 쿼리스트링 (라이브러리로 이어가기용)
export function specToSeedQuery(s: SimSpec): string {
  const sp = new URLSearchParams();
  sp.set("plan_seed", "1");
  if (s.promoType) sp.set("promo", s.promoType);
  if (s.season) sp.set("season", s.season);
  if (s.purpose) sp.set("purpose", s.purpose);
  sp.set("discount", String(s.discount));
  sp.set("days", String(s.days));
  return sp.toString();
}

// 플랜 시드 쿼리 파싱 (라이브러리 배너 표시용). plan_seed가 없으면 null.
export function parseSeedQuery(search: string): (SimSpec & { active: boolean }) | null {
  const sp = new URLSearchParams(search);
  if (sp.get("plan_seed") !== "1") return null;
  return {
    active: true,
    promoType: sp.get("promo") ?? "",
    season: sp.get("season") ?? "",
    purpose: sp.get("purpose") ?? "",
    discount: clampNum(Number(sp.get("discount")), 0, 70, 40),
    days: clampNum(Number(sp.get("days")), 1, 31, 4),
  };
}
