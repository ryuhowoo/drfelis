import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// 새 캠페인 = promotion(메타) + draft 플랜 + 목적 가중치를 한 번에 생성.
// (N5에서 '빈 draft 자동생성'을 막았던 이유는 플랜/실적 머지 충돌 — 새 모델은
//  한 캠페인=한 행사(플랜+자기 성과)라 그 충돌이 사라져 생성 플로우를 복원한다.)
type Body = {
  name: string;
  start_date: string;
  end_date: string;
  purposes: string[]; // 세일즈/브랜딩/재고소진 (1~3개)
  weights: Record<string, number>; // 목적별 1~10 정수
  // 엄선 메타(예측에 실효) — 선택. 복수 선택 지원(혜택 유형·시즌).
  promo_type?: string | null; // 레거시 단일(대표값)
  promo_types?: string[]; // 복수 선택
  season_tag?: string | null; // 레거시 단일(대표값)
  season_tags?: string[]; // 복수 선택
  channel?: string | null;
  discount_rate?: number | null; // 0~1
};

/** 복수 선택 배열을 정리 — 단일값 폴백 포함, 공백 제거·중복 제거 */
function cleanTags(arr?: string[], single?: string | null): string[] {
  const src = arr && arr.length > 0 ? arr : single ? [single] : [];
  return [...new Set(src.map((s) => (s ?? "").trim()).filter(Boolean))];
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const name = (body.name ?? "").trim();
    const { start_date, end_date } = body;
    const purposes = (body.purposes ?? []).filter(Boolean);

    if (!name) return NextResponse.json({ error: "캠페인 이름을 입력하세요." }, { status: 400 });
    if (!start_date || !end_date)
      return NextResponse.json({ error: "기간(시작·종료일)을 입력하세요." }, { status: 400 });
    if (end_date < start_date)
      return NextResponse.json({ error: "종료일이 시작일보다 빠릅니다." }, { status: 400 });
    if (purposes.length === 0)
      return NextResponse.json({ error: "목적을 1개 이상 선택하세요." }, { status: 400 });

    const supabase = await createClient();

    // 1) 프로모션 메타 — 혜택 유형·시즌은 복수 선택(배열) + 대표값(첫 항목) 동시 저장
    const promoTypes = cleanTags(body.promo_types, body.promo_type);
    const seasonTags = cleanTags(body.season_tags, body.season_tag);
    const channel = (body.channel ?? "").trim() || null;
    const dr = body.discount_rate != null && body.discount_rate > 0 ? body.discount_rate : null;
    const { data: promo, error: pErr } = await supabase
      .from("promotions")
      .insert({
        name,
        start_date,
        end_date,
        purposes,
        purpose: purposes[0], // 레거시 단일 목적 = 주목적
        promo_type: promoTypes[0] ?? null, // 레거시 단일 = 대표 혜택 유형
        promo_types: promoTypes.length > 0 ? promoTypes : null,
        season_tag: seasonTags[0] ?? null, // 레거시 단일 = 대표 시즌
        season_tags: seasonTags.length > 0 ? seasonTags : null,
        channel,
        benefits: dr != null ? { discount_rate: dr } : null,
      })
      .select("id")
      .single();
    if (pErr || !promo) throw pErr ?? new Error("캠페인 생성 실패");
    const promotionId = promo.id as string;

    // 2) draft 플랜 (v1, current)
    const { data: plan, error: plErr } = await supabase
      .from("campaign_plans")
      .insert({
        promotion_id: promotionId,
        version: 1,
        is_current: true,
        status: "draft",
      })
      .select("id")
      .single();
    if (plErr || !plan) throw plErr ?? new Error("플랜 생성 실패");

    // 3) 목적 가중치 — 1~10 정수를 합=1 로 정규화 저장 (effective_purpose_weights 기대 형식)
    const total = purposes.reduce((s, p) => s + (Number(body.weights?.[p]) || 0), 0);
    if (total > 0) {
      const rows = purposes.map((p) => ({
        promotion_id: promotionId,
        purpose: p,
        weight: (Number(body.weights?.[p]) || 0) / total,
      }));
      const { error: wErr } = await supabase
        .from("promotion_purpose_weights")
        .insert(rows);
      if (wErr) throw wErr;
    }

    return NextResponse.json({ promotion_id: promotionId, plan_id: plan.id });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "캠페인 생성 실패" },
      { status: 500 },
    );
  }
}
