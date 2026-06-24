"use client";

import { useRef, useState } from "react";
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
  const [question, setQuestion] = useState<string>("");
  const [answer, setAnswer] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const answerRef = useRef<HTMLTextAreaElement>(null);

  function toggle(tag: string) {
    setTags((t) => (t.includes(tag) ? t.filter((x) => x !== tag) : [...t, tag]));
  }
  // 제안 클릭 → 주제로 설정하고 바로 답변창에 포커스
  function pickQuestion(q: string) {
    setQuestion((cur) => (cur === q ? "" : q));
    setTimeout(() => answerRef.current?.focus(), 0);
  }

  async function submit() {
    if (!answer.trim() || saving) return;
    setSaving(true);
    await fetch(`/api/promotions/${promotionId}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, answer, cause_tags: tags }),
    });
    setAnswer("");
    setTags([]);
    setQuestion("");
    setSaving(false);
    router.refresh();
  }

  return (
    <div>
      {/* 작성 카드 */}
      <div className="rounded-2xl card-soft p-4">
        {suggested.length > 0 && (
          <>
            <div className="mb-1.5 text-[11px] text-ink-4">이런 걸 기록해보세요 — 누르면 답변창으로</div>
            <div className="mb-3 flex flex-wrap gap-2">
              {suggested.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => pickQuestion(q)}
                  className={`rounded-full border px-3 py-1 text-xs transition ${
                    question === q
                      ? "border-brand-500 bg-brand-50 text-brand-700"
                      : "border-line text-ink-3 hover:bg-soft"
                  }`}
                >
                  {q}
                </button>
              ))}
            </div>
          </>
        )}

        {question && (
          <div className="mb-2 flex items-start gap-2 rounded-xl bg-brand-50/70 px-3 py-2 text-xs text-brand-800">
            <span className="mt-0.5 shrink-0 font-semibold">Q.</span>
            <span className="min-w-0 flex-1">{question}</span>
            <button type="button" onClick={() => setQuestion("")} className="shrink-0 text-brand-600 hover:underline">
              지우기
            </button>
          </div>
        )}

        <textarea
          ref={answerRef}
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
          }}
          placeholder="무엇이 이 성과를 만들었나요? 원인·가설을 적어두면 다음 예측의 근거가 됩니다."
          rows={3}
          className="w-full rounded-xl border border-line bg-card px-3 py-2 text-sm text-ink outline-none focus:border-brand-400"
        />

        <div className="mt-2 flex flex-wrap gap-1.5">
          {CAUSE_TAGS.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => toggle(tag)}
              className={`rounded-full border px-2.5 py-1 text-xs transition ${
                tags.includes(tag)
                  ? "border-brand-400 bg-brand-50 text-brand-700"
                  : "border-line text-ink-4 hover:bg-soft"
              }`}
            >
              {tag}
            </button>
          ))}
        </div>

        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={submit}
            disabled={saving || !answer.trim()}
            className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
          >
            {saving ? "저장 중…" : "기록 추가"}
          </button>
          <span className="text-[11px] text-ink-4">⌘/Ctrl + Enter</span>
        </div>
      </div>

      {/* 기록 목록 */}
      <ul className="mt-4 space-y-2.5">
        {notes.map((n) => (
          <li key={n.id} className="rounded-xl border border-line bg-soft/50 p-3">
            {n.question && <div className="text-xs font-medium text-ink-4">Q. {n.question}</div>}
            <div className="mt-0.5 text-sm text-ink-2">{n.answer}</div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {(n.cause_tags ?? []).map((t) => (
                <span key={t} className="rounded-full bg-card px-2 py-0.5 text-xs text-ink-4 ring-1 ring-line">
                  {t}
                </span>
              ))}
              <span className="ml-auto text-xs text-ink-4">
                {n.author} · {new Date(n.created_at).toLocaleDateString("ko-KR")}
              </span>
            </div>
          </li>
        ))}
        {notes.length === 0 && (
          <li className="py-2 text-sm text-ink-4">아직 기록된 원인 메모가 없습니다.</li>
        )}
      </ul>
    </div>
  );
}
