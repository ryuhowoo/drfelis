import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// 이 캠페인(source)을 다른 캠페인(target)에 병합. 모든 데이터를 target 으로 이전 후
// source 캠페인 삭제. 한쪽에만 플랜이 있어야 함.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: sourceId } = await params;
    const body = (await req.json()) as { target_id?: string };
    if (!body.target_id) {
      return NextResponse.json(
        { error: "병합 대상(target_id)이 필요합니다" },
        { status: 400 },
      );
    }
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("merge_campaigns", {
      source_id: sourceId,
      target_id: body.target_id,
    });
    if (error) throw error;
    return NextResponse.json(data ?? { ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "병합 실패" },
      { status: 500 },
    );
  }
}
