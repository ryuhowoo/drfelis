import { createClient } from "@supabase/supabase-js";

// 서비스 역할 클라이언트 — 사용자 세션이 없는 크론/서버 작업 전용(예: 가격 마스터 일일 동기화).
// SUPABASE_SERVICE_ROLE_KEY 는 Vercel 환경변수(서버 전용)로 설정해야 한다. 클라이언트에 노출 금지.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error("SUPABASE_SERVICE_ROLE_KEY(또는 URL) 미설정 — 서버 환경변수를 확인하세요.");
  return createClient(url, key, {
    db: { schema: "promo" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
