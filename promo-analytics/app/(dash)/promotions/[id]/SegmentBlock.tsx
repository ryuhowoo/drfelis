import { won, wonShort, num, pct } from "@/lib/format";
import type { SegmentSummary, SegmentRow } from "@/lib/types";

// Feature C — 세그먼트 성과(회원/비회원·회원등급·객단가/AOV). 세그먼트 실적(⑥) 업로드 시 채워짐.
// AOV=매출/결제건수, ARPPU(객단가)=매출/결제유저수 — 집계 합계에서 파생(행 단위 값은 합산 불가).
const aov = (r: { revenue: number; orders: number }) => (r.orders > 0 ? r.revenue / r.orders : null);
const arppu = (r: { revenue: number; users: number }) => (r.users > 0 ? r.revenue / r.users : null);

// 등급 라벨은 자유 텍스트라 하드코딩하지 않음 — 등장 순서대로 표시(매출 desc는 RPC가 정렬).
export default function SegmentBlock({ summary }: { summary: SegmentSummary | null }) {
  if (!summary || !summary.has_data) {
    return (
      <div className="rounded-2xl card-soft p-6 text-center">
        <p className="text-sm font-medium text-ink">세그먼트 실적이 아직 없습니다.</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-ink-4">
          <strong>데이터 업로드 → ⑥ 세그먼트 실적(회원·등급·카테고리)</strong>에서 카페24 채널별
          매출 export를 올리면 회원/비회원·등급·객단가(ARPPU)·AOV 분석이 여기 표시됩니다.
        </p>
      </div>
    );
  }

  const total = summary.total;
  const totalRev = total?.revenue ?? 0;
  const member = summary.member_split.find((m) => m.seg === "회원") ?? null;
  const guest = summary.member_split.find((m) => m.seg === "비회원") ?? null;
  const excludedRev = summary.excluded.reduce((s, e) => s + e.revenue, 0);

  return (
    <div className="space-y-6">
      {/* 회원 vs 비회원 */}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-ink-2">회원 / 비회원</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <SegCard title="회원" row={member} totalRev={totalRev} primary />
          <SegCard title="비회원" row={guest} totalRev={totalRev} />
        </div>
        <p className="mt-2 text-[11px] text-ink-4">
          AOV = 매출 / 결제건수 · ARPPU(객단가) = 매출 / 결제 유저수. Staff·동물병원(도매)은 고객 성과에서 제외됨.
        </p>
      </section>

      {/* 회원등급 코호트 */}
      {summary.grades.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-ink-2">회원등급 코호트</h2>
          <div className="overflow-x-auto rounded-2xl card-soft">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-soft/60 text-left text-xs text-ink-3">
                <tr>
                  <th className="px-3 py-2.5 font-medium">등급</th>
                  <th className="px-3 py-2.5 text-right font-medium">매출</th>
                  <th className="px-3 py-2.5 text-right font-medium">비중</th>
                  <th className="px-3 py-2.5 text-right font-medium">결제건수</th>
                  <th className="px-3 py-2.5 text-right font-medium">유저수</th>
                  <th className="px-3 py-2.5 text-right font-medium">AOV</th>
                  <th className="px-3 py-2.5 text-right font-medium">ARPPU(객단가)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/70">
                {summary.grades.map((g) => (
                  <tr key={g.grade} className="hover:bg-soft/50">
                    <td className="px-3 py-2.5 text-ink">{g.grade}</td>
                    <td className="px-3 py-2.5 text-right text-ink-2">{wonShort(g.revenue)}</td>
                    <td className="px-3 py-2.5 text-right text-ink-4">
                      {totalRev > 0 ? pct(g.revenue / totalRev) : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right text-ink-3">{num(g.orders)}</td>
                    <td className="px-3 py-2.5 text-right text-ink-3">{num(g.users)}</td>
                    <td className="px-3 py-2.5 text-right text-ink-2">{wonOrDash(aov(g))}</td>
                    <td className="px-3 py-2.5 text-right font-semibold text-ink">{wonOrDash(arppu(g))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-ink-4">
            표본이 적은 등급(유저수 적음)은 AOV·ARPPU 신뢰도가 낮습니다 — 유저수와 함께 해석하세요.
          </p>
        </section>
      )}

      {/* 일반/정기 · 카테고리 분해 */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {summary.order_types.length > 0 && (
          <section>
            <h2 className="mb-2 text-sm font-semibold text-ink-2">일반 / 정기</h2>
            <div className="rounded-2xl card-soft p-4">
              <ul className="space-y-2 text-sm">
                {summary.order_types.map((o) => (
                  <li key={o.order_type} className="flex items-center justify-between">
                    <span className="text-ink-2">{o.order_type === "subscription" ? "정기(구독)" : "일반"}</span>
                    <span className="text-ink-3">
                      <b className="text-ink-2">{wonShort(o.revenue)}</b>
                      {totalRev > 0 && <span className="ml-1.5 text-[11px] text-ink-4">{pct(o.revenue / totalRev)}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}
        {summary.categories.length > 0 && (
          <section>
            <h2 className="mb-2 text-sm font-semibold text-ink-2">카테고리별 매출</h2>
            <div className="rounded-2xl card-soft p-4">
              <ul className="space-y-2 text-sm">
                {summary.categories.map((c) => (
                  <li key={c.category} className="flex items-center justify-between">
                    <span className="truncate text-ink-2">{c.category}</span>
                    <span className="ml-2 shrink-0 text-ink-3">
                      <b className="text-ink-2">{wonShort(c.revenue)}</b>
                      {totalRev > 0 && <span className="ml-1.5 text-[11px] text-ink-4">{pct(c.revenue / totalRev)}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}
      </div>

      {excludedRev > 0 && (
        <p className="text-[11px] text-ink-4">
          제외(고객 성과에서 빠짐): {summary.excluded.map((e) => `${e.grade} ${wonShort(e.revenue)}`).join(" · ")} —
          Staff·동물병원(도매)은 객단가 왜곡 방지를 위해 합계에서 제외했습니다.
        </p>
      )}
    </div>
  );
}

function SegCard({
  title,
  row,
  totalRev,
  primary,
}: {
  title: string;
  row: (SegmentRow & { seg: string }) | null;
  totalRev: number;
  primary?: boolean;
}) {
  const rev = row?.revenue ?? 0;
  return (
    <div className={`rounded-2xl border p-4 ${primary ? "border-transparent bg-brand-500 text-white" : "border-line bg-card"}`}>
      <div className="flex items-baseline justify-between">
        <span className={`text-sm font-semibold ${primary ? "text-white" : "text-ink"}`}>{title}</span>
        <span className={`text-xs ${primary ? "text-white/70" : "text-ink-4"}`}>
          {totalRev > 0 ? pct(rev / totalRev) : "—"}
        </span>
      </div>
      <div className="mt-1 text-lg font-semibold">{won(rev)}</div>
      <dl className={`mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs ${primary ? "text-white/80" : "text-ink-3"}`}>
        <Mini label="AOV" value={wonOrDash(aov(row ?? { revenue: 0, orders: 0 }))} />
        <Mini label="ARPPU" value={wonOrDash(arppu(row ?? { revenue: 0, users: 0 }))} />
        <Mini label="결제건수" value={num(row?.orders ?? 0)} />
        <Mini label="유저수" value={num(row?.users ?? 0)} />
      </dl>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="opacity-80">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function wonOrDash(v: number | null): string {
  return v == null ? "—" : wonShort(v);
}
