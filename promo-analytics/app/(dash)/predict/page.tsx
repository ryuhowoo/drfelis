import { createClient } from "@/lib/supabase/server";
import { loadCases } from "@/lib/cases";
import { loadOptions } from "@/lib/options";
import Simulator from "./Simulator";

export const dynamic = "force-dynamic";

export default async function PredictPage() {
  const supabase = await createClient();
  const [cases, options] = await Promise.all([
    loadCases(supabase),
    loadOptions(supabase),
  ]);
  return <Simulator cases={cases} options={options} />;
}
