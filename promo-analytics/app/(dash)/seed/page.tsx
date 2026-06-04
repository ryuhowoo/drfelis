import Link from "next/link";

export const dynamic = "force-static";

// seed 라우트는 영구 비활성화. 사용자 데이터 정리 작업(2026-06-04) 후
// 동일 데이터가 다른 source_file로 중복 적재되는 사고를 막기 위함.
// 초기 데이터는 데이터 업로드 페이지(/upload)에서 원본 파일을 직접 올린다.

export default function SeedPage() {
  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8 lg:py-7">
      <h1 className="text-xl font-semibold">초기 데이터 적재 (비활성)</h1>
      <div className="mt-4 max-w-xl rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
        seed 라우트는 영구 비활성화됐어요. 과거 동일 데이터가 다른 source 이름으로
        중복 적재돼 매출이 약 2배로 부풀려진 사고가 있었기 때문에, 안전성을 위해
        seed 경로를 닫았습니다.
      </div>
      <p className="mt-4 max-w-xl text-sm text-neutral-600">
        초기 데이터는{" "}
        <Link href="/upload" className="font-medium text-brand-600 underline">
          데이터 업로드
        </Link>{" "}
        페이지에서 원본 엑셀 파일을 직접 올려주세요. (마스터 → 일별 매출 → 캠페인 순)
      </p>
    </div>
  );
}
