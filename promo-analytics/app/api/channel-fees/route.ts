import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// 채널별 수수료 (피드백 8). GET=목록, PUT=수수료율 수정, POST=채널 추가, DELETE=채널 삭제.
export async function GET() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("channel_fees")
    .select("channel, fee_rate, sort")
    .order("sort");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ channels: data ?? [] });
}

export async function PUT(req: Request) {
  const { channel, fee_rate } = (await req.json()) as { channel?: string; fee_rate?: number };
  if (!channel) return NextResponse.json({ error: "channel 필요" }, { status: 400 });
  const rate = Math.max(0, Math.min(1, Number(fee_rate) || 0));
  const supabase = await createClient();
  const { error } = await supabase
    .from("channel_fees")
    .update({ fee_rate: rate, updated_at: new Date().toISOString() })
    .eq("channel", channel);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function POST(req: Request) {
  const { channel, fee_rate } = (await req.json()) as { channel?: string; fee_rate?: number };
  const name = (channel ?? "").trim();
  if (!name) return NextResponse.json({ error: "채널명 필요" }, { status: 400 });
  const supabase = await createClient();
  const { data: maxRow } = await supabase
    .from("channel_fees")
    .select("sort")
    .order("sort", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { error } = await supabase.from("channel_fees").insert({
    channel: name,
    fee_rate: Math.max(0, Math.min(1, Number(fee_rate) || 0)),
    sort: ((maxRow?.sort as number | undefined) ?? 0) + 1,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const { channel } = (await req.json()) as { channel?: string };
  if (!channel) return NextResponse.json({ error: "channel 필요" }, { status: 400 });
  const supabase = await createClient();
  const { error } = await supabase.from("channel_fees").delete().eq("channel", channel);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
