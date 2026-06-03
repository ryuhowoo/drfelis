"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PromotionNote } from "@/lib/types";

const CAUSE_TAGS = [
  "광고 증액",
  "인플루언서",
  "경쟁사 품절",
  "시즌 특수",
  "신제품 효과",
  "가격 매력",
  "재고 이슈",
  "외부 트래픽",
];

export default function Notes({
  promotionId,
  notes,
  suggested,
}: {
  promotionId: string;
  notes: PromotionNote[];
  suggested: string[];
}) {
  const router = useRouter();
  const [question, setQuestion] = useState<string>(suggested[0] ?? "");
  const [answer, setAnswer] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  function toggle(tag: string) {
    setTags((t) => (t.includes(tag) ? t.filter((x) => x !== tag) : [...t, tag]));
  }

  async function submit() {
    if (!answer.trim()) return;
    setSaving(true);
    await fetch(`/api/promotions/${promotionId}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, answer, cause_tags: tags }),
    });
    setAnswer("");
    setTags([]);
    setSaving(false);
    router.refresh();
  }

  return (
    <div>
      {suggested.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {suggested.map((q) => (
            <button
              key={q}
              onClick={() => setQuestion(q)}
              className={`rounded-full border px-3 py-1 text-xs transition ${
                question === q
                  ? "border-neutral-900 bg-neutral-900 text-white"
                  : "border-neutral-300 text-neutral-600 hover:bg-neutral-50"
              }`}
            >
              {q}
            </button>
          ))}
        </div>
      )}

      <input
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder="이 성과의 원인을 묻는 질문"
        className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
      />
      <textarea
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        placeholder="원인·가설을 기록하세요. (다음 예측의 근거로 축적됩니다)"
        rows={2}
        className="mt-2 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
      />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {CAUSE_TAGS.map((tag) => (
          <button
            key={tag}
            onClick={() => toggle(tag)}
            className={`rounded-full border px-2.5 py-1 text-xs transition ${
              tags.includes(tag)
                ? "border-neutral-700 bg-neutral-100 text-neutral-800"
                : "border-neutral-200 text-neutral-500 hover:bg-neutral-50"
            }`}
          >
            {tag}
          </button>
        ))}
      </div>
      <button
        onClick={submit}
        disabled={saving || !answer.trim()}
        className="mt-3 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
      >
        {saving ? "저장 중…" : "메모 추가"}
      </button>

      <ul className="mt-5 space-y-3">
        {notes.map((n) => (
          <li
            key={n.id}
            className="rounded-lg border border-neutral-100 bg-neutral-50 p-3"
          >
            {n.question && (
              <div className="text-xs font-medium text-neutral-500">
                Q. {n.question}
              </div>
            )}
            <div className="mt-0.5 text-sm text-neutral-800">{n.answer}</div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {(n.cause_tags ?? []).map((t) => (
                <span
                  key={t}
                  className="rounded-full bg-white px-2 py-0.5 text-xs text-neutral-500 ring-1 ring-neutral-200"
                >
                  {t}
                </span>
              ))}
              <span className="ml-auto text-xs text-neutral-400">
                {n.author} · {new Date(n.created_at).toLocaleDateString("ko-KR")}
              </span>
            </div>
          </li>
        ))}
        {notes.length === 0 && (
          <li className="text-sm text-neutral-400">
            아직 기록된 원인 메모가 없습니다.
          </li>
        )}
      </ul>
    </div>
  );
}
