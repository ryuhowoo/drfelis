import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runPriceMasterSync } from "@/lib/priceMasterSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 품목/가격 마스터 — Google Sheets '웹에 게시(CSV)' 동기화 엔드포인트.
//   GET  : Vercel Cron(일 1회). Authorization: Bearer <CRON_SECRET> 검증 → 서비스 역할로 동기화.
//   POST : UI '지금 동기화'. 로그인 세션으로 동기화. body.csv_url 주면 그 URL 사용(저장값 무시).

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const supabase = createAdminClient();
    const out = await runPriceMasterSync(supabase);
    return NextResponse.json({ ok: true, ...out });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let csvUrl: string | undefined;
  try {
    const body = (await req.json()) as { csv_url?: string };
    csvUrl = body.csv_url?.trim() || undefined;
  } catch {
    /* body 없음 — 저장된 URL 사용 */
  }
  try {
    const out = await runPriceMasterSync(supabase, csvUrl ? { csvUrl } : undefined);
    return NextResponse.json({ ok: true, ...out });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
