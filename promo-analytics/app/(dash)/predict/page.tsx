import { createClient } from "@/lib/supabase/server";
import { loadCases } from "@/lib/cases";
import Simulator from "./Simulator";

export const dynamic = "force-dynamic";

export default async function PredictPage() {
  const supabase = await createClient();
  const cases = await loadCases(supabase);
  return <Simulator cases={cases} />;
}
