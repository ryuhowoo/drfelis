import { NextResponse } from "next/server";

export const runtime = "nodejs";

// 비활성화: 사용자 데이터 정리 작업(2026-06-04) 후 동일 데이터가 다른 source_file로
// 중복 적재되는 사고를 막기 위해 seed 라우트를 영구 닫는다.
// 다시 켜려면 git 히스토리에서 0d8180f 직전 버전을 복원하거나, 별도 보호 단계를 추가하라.

const DISABLED_PAYLOAD = {
  error:
    "seed 라우트는 영구 비활성화됐어요. " +
    "초기 데이터는 데이터 업로드 페이지(/upload)에서 (4).xlsx 같은 원본을 직접 올려주세요. " +
    "(과거에 seed로 적재된 데이터와 업로드 데이터가 중복으로 합산되던 사고가 있었기 때문)",
};

export function POST() {
  return NextResponse.json(DISABLED_PAYLOAD, { status: 410 });
}

export function GET() {
  return NextResponse.json(DISABLED_PAYLOAD, { status: 410 });
}
