"use client";

// (dash) 그룹 에러 바운더리 — RPC 타임아웃 등 일시 오류를 404/백지 대신
// 재시도 가능한 화면으로. (N6: 연동 직후 롤업 재계산이 길어질 때 대비)
export default function DashError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-md rounded-2xl card-soft p-8 text-center">
        <div className="text-base font-semibold text-ink">
          데이터를 불러오지 못했습니다
        </div>
        <p className="mt-2 text-sm leading-relaxed text-ink-3">
          업로드·연동 직후에는 분석 재계산이 잠시 걸릴 수 있습니다.
          몇 초 뒤 다시 시도해 주세요.
        </p>
        {error?.message && (
          <p className="mt-2 break-all text-[11px] text-ink-4">{error.message}</p>
        )}
        <button
          onClick={() => reset()}
          className="mt-5 rounded-full bg-brand-500 px-6 py-2.5 text-sm font-semibold text-white hover:bg-brand-600"
        >
          다시 시도
        </button>
      </div>
    </div>
  );
}
