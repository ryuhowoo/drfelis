// 캠페인 시즌성 자동 추정
// 우선순위: 이름 키워드 > 시작일이 속한 시즌 윈도

const NAME_KEYWORDS: { season: string; aliases: string[] }[] = [
  { season: "한국 고양이의 날", aliases: ["한국고양이", "한국 고양이", "한고날"] },
  { season: "세계 고양이의 날",  aliases: ["세계고양이", "세계 고양이", "세고날"] },
  { season: "한가위 고양이",     aliases: ["한가위", "추석", "한고잔치"] },
  { season: "크리스마스",        aliases: ["크리스마스", "christmas", "xmas", "x-mas"] },
  { season: "블랙프라이데이",    aliases: ["블랙프라이데이", "blackfriday", "black friday", "bfcm", "11.11", "1111", "11월11일"] },
  { season: "설 연휴",           aliases: ["설날", "설 연휴", "설연휴", "구정", "신정"] },
  { season: "N주년",             aliases: ["주년", "anniversary", "anniv"] },
  { season: "신학기",            aliases: ["신학기", "개강", "입학"] },
  { season: "여름",              aliases: ["여름", "summer", "휴가", "바캉스"] },
  { season: "겨울",              aliases: ["겨울", "winter", "연말"] },
];

// 시작일 기준 시즌 윈도 (월-일 → 시즌)
// 음력 시즌(추석·설)은 매년 다르지만 근사 윈도로 잡음.
// 좁은 윈도가 넓은 윈도보다 우선하도록 windowLen 오름차순으로 자동 정렬.
type Window = { season: string; from: [number, number]; to: [number, number] };
const DATE_WINDOWS_RAW: Window[] = [
  { season: "설 연휴",           from: [1, 25],  to: [2, 15] },
  { season: "신학기",            from: [2, 25],  to: [3, 15] },
  { season: "여름",              from: [6, 15],  to: [8, 31] },
  { season: "한국 고양이의 날",  from: [9, 7],   to: [9, 12] }, // 9/9
  { season: "한가위 고양이",     from: [9, 15],  to: [10, 10] },
  { season: "블랙프라이데이",    from: [11, 20], to: [11, 30] },
  { season: "크리스마스",        from: [12, 18], to: [12, 28] },
  { season: "겨울",              from: [12, 1],  to: [1, 31] },
  { season: "세계 고양이의 날",  from: [8, 5],   to: [8, 10] }, // 8/8
];

function windowLen(w: Window): number {
  const from = w.from[0] * 100 + w.from[1];
  const to = w.to[0] * 100 + w.to[1];
  // 연도 경계(겨울 12/1 ~ 1/31)는 환산이 부정확하지만 좁은 윈도(holiday) 우선이 보장되면 충분.
  return from <= to ? to - from : 12_31 - from + to;
}
const DATE_WINDOWS: Window[] = [...DATE_WINDOWS_RAW].sort(
  (a, b) => windowLen(a) - windowLen(b),
);

// 마스터에 특정 시즌이 없을 때 폴백할 대안 시즌(완화 매칭용).
// 기본 시드에 '명절'만 있고 '한가위 고양이'·'설 연휴'는 없을 수 있어 대응.
const FALLBACK_ALIASES: Record<string, string[]> = {
  "한가위 고양이": ["명절"],
  "설 연휴":      ["명절"],
};

function normalize(s: string): string {
  return s.toLowerCase().replace(/[\s_\-·]+/g, "");
}

function inWindow(month: number, day: number, w: Window): boolean {
  const md = month * 100 + day;
  const from = w.from[0] * 100 + w.from[1];
  const to = w.to[0] * 100 + w.to[1];
  // 연도 경계(예: 겨울 12/1 ~ 1/31) 처리
  return from <= to ? md >= from && md <= to : md >= from || md <= to;
}

/**
 * 이름과 시작일로 시즌성 추정.
 * - 이름에 키워드가 있으면 1순위
 * - 날짜 윈도에 들어가면 2순위
 * - available이 주어지면 그 안에서만 선택 (정확히 일치하지 않으면 무시)
 */
export function inferSeasonality(
  name: string,
  startDate?: string | null,
  available?: string[],
): string | null {
  const n = normalize(name);

  // 1) 이름 키워드
  for (const k of NAME_KEYWORDS) {
    if (k.aliases.some((a) => n.includes(normalize(a)))) {
      const picked = pickAvailable(k.season, available);
      if (picked) return picked;
    }
  }

  // 2) 시작일 윈도
  if (startDate) {
    const m = startDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      const month = Number(m[2]);
      const day = Number(m[3]);
      for (const w of DATE_WINDOWS) {
        if (inWindow(month, day, w)) {
          const picked = pickAvailable(w.season, available);
          if (picked) return picked;
        }
      }
    }
  }

  return null;
}

// available 마스터에서 정확 매칭 → 부분 매칭 → 폴백 별칭 순으로 시도.
function pickAvailable(season: string, available?: string[]): string | null {
  if (!available || available.length === 0) return season;
  const exact = available.find((x) => x === season);
  if (exact) return exact;
  const partial = available.find(
    (x) =>
      normalize(x).includes(normalize(season)) ||
      normalize(season).includes(normalize(x)),
  );
  if (partial) return partial;
  for (const alt of FALLBACK_ALIASES[season] ?? []) {
    const altMatch = available.find((x) => x === alt);
    if (altMatch) return altMatch;
  }
  return null;
}
