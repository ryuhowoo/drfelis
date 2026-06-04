import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const TABLES = ["benefit_types", "seasonalities", "purposes"] as const;
type Kind = (typeof TABLES)[number];

function validKind(k: unknown): k is Kind {
  return typeof k === "string" && (TABLES as readonly string[]).includes(k);
}

export async function GET() {
  const supabase = await createClient();
  const [bt, ss, pp] = await Promise.all([
    supabase.from("benefit_types").select("id, name, sort").order("sort"),
    supabase.from("seasonalities").select("id, name, sort").order("sort"),
    supabase.from("purposes").select("id, name, sort").order("sort"),
  ]);
  return NextResponse.json({
    benefit_types: bt.data ?? [],
    seasonalities: ss.data ?? [],
    purposes: pp.data ?? [],
  });
}

export async function POST(req: Request) {
  try {
    const { kind, name } = await req.json();
    if (!validKind(kind) || !name?.trim())
      return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });
    const supabase = await createClient();
    const { data: max } = await supabase
      .from(kind)
      .select("sort")
      .order("sort", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { error } = await supabase
      .from(kind)
      .insert({ name: name.trim(), sort: (max?.sort ?? 0) + 1 });
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "실패" },
      { status: 500 },
    );
  }
}

export async function PATCH(req: Request) {
  try {
    const { kind, id, name } = await req.json();
    if (!validKind(kind) || !id || !name?.trim())
      return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });
    const supabase = await createClient();
    const { error } = await supabase.from(kind).update({ name: name.trim() }).eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "실패" },
      { status: 500 },
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const { kind, id } = await req.json();
    if (!validKind(kind) || !id)
      return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });
    const supabase = await createClient();
    const { error } = await supabase.from(kind).delete().eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "실패" },
      { status: 500 },
    );
  }
}
