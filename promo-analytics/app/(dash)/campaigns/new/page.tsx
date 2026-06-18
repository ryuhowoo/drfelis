import { createClient } from "@/lib/supabase/server";
import { loadCases } from "@/lib/cases";
import { loadOptions } from "@/lib/options";
import NewCampaignForm from "./NewCampaignForm";

export const dynamic = "force-dynamic";

// 서버: 예측에 쓸 과거 사례 + 옵션 마스터를 로드해 작성 폼에 전달.
export default async function NewCampaignPage() {
  const supabase = await createClient();
  const [cases, options] = await Promise.all([
    loadCases(supabase),
    loadOptions(supabase),
  ]);
  return <NewCampaignForm cases={cases} options={options} />;
}
