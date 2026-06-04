import { createClient } from "@/lib/supabase/server";
import { loadOptions } from "@/lib/options";
import Recommend from "./Recommend";

export const dynamic = "force-dynamic";

export default async function PrescribePage() {
  const supabase = await createClient();
  const options = await loadOptions(supabase);
  return <Recommend options={options} />;
}
