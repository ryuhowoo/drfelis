"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type CardDef = {
  key: string;
  title: string;
  desc: string;
  endpoint: string;
  order: number;
};

const CARDS: CardDef[] = [
  {
    key: "master",
    title: "① 마스터 (품목코드)",
    desc: "기초상품 원가·소비자가·상시가. 가장 먼저 올리면 상품 정보가 채워집니다.",
    endpoint: "/api/import/master",
    order: 1,
  },
  {
    key: "daily",
    title: "② 일별 매출 추이",
    desc: "일자 × 기초상품 × 옵션 × 결제금액 × 수량. baseline(평소 매출)의 연료입니다.",
    endpoint: "/api/import/daily",
    order: 2,
  },
  {
    key: "promotion",
    title: "③ 프로모션 시트",
    desc: "프로모션 기간 실적(전 제품). 업로드하면 프로모션이 생성되고 상세로 이동합니다.",
    endpoint: "/api/import/promotion",
    order: 3,
  },
];

export default function UploadPage() {
  return (
    <div className="px-8 py-7">
      <h1 className="text-xl font-semibold">데이터 업로드</h1>
      <p className="mt-1 text-sm text-neutral-500">
        엑셀(.xlsx) 파일을 순서대로 올려주세요. 헤더 이름으로 자동 인식합니다.
      </p>
      <div className="mt-6 grid gap-4">
        {CARDS.map((c) => (
          <UploadCard key={c.key} def={c} />
        ))}
      </div>
    </div>
  );
}

function UploadCard({ def }: { def: CardDef }) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "error">(
    "idle",
  );
  const [message, setMessage] = useState<string>("");

  async function handleFile(file: File) {
    setStatus("loading");
    setMessage(`${file.name} 처리 중…`);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch(def.endpoint, { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "실패");

      if (def.key === "promotion" && data.promotion_id) {
        setStatus("ok");
        setMessage(`${data.name} 생성 완료 · ${data.count}행. 상세로 이동합니다…`);
        router.push(`/promotions/${data.promotion_id}/edit`);
        return;
      }
      if (def.key === "daily") {
        setStatus("ok");
        setMessage(
          `${data.count}행 적재 · 상품 ${data.products}종 · 기간 ${data.range?.from}~${data.range?.to}`,
        );
        return;
      }
      setStatus("ok");
      setMessage(`${data.count}개 품목 반영 완료`);
    } catch (e) {
      setStatus("error");
      setMessage(e instanceof Error ? e.message : "실패");
    }
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-medium">{def.title}</h2>
          <p className="mt-1 text-sm text-neutral-500">{def.desc}</p>
        </div>
        <label className="shrink-0 cursor-pointer rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-50">
          파일 선택
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      {status !== "idle" && (
        <div
          className={`mt-3 rounded-lg px-3 py-2 text-sm ${
            status === "error"
              ? "bg-red-50 text-red-700"
              : status === "ok"
                ? "bg-green-50 text-green-700"
                : "bg-neutral-100 text-neutral-600"
          }`}
        >
          {message}
        </div>
      )}
    </div>
  );
}
