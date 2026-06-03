import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseMaster } from "@/lib/parse";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "파일이 없습니다." }, { status: 400 });

    const rows = parseMaster(await file.arrayBuffer());
    if (rows.length === 0)
      return NextResponse.json({ error: "유효한 행이 없습니다." }, { status: 400 });

    const supabase = await createClient();
    // base_name 기준 upsert (원가/가격/코드 갱신)
    const { error } = await supabase
      .from("products")
      .upsert(rows, { onConflict: "base_name" });
    if (error) throw error;

    return NextResponse.json({ ok: true, count: rows.length });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "임포트 실패" },
      { status: 500 },
    );
  }
}
