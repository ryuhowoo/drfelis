export function won(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return "₩" + Math.round(n).toLocaleString("ko-KR");
}

export function wonShort(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(1)}억`;
  if (abs >= 1e4) return `${sign}${Math.round(abs / 1e4).toLocaleString("ko-KR")}만`;
  return won(n);
}

export function pct(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return (n * 100).toFixed(digits) + "%";
}

export function num(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString("ko-KR");
}

export function dateRange(from: string, to: string): string {
  return `${from} ~ ${to}`;
}

export function daysBetween(from: string, to: string): number {
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  return Math.round((b - a) / 86400000) + 1;
}
