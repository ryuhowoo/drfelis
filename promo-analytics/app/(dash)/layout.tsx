import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

const NAV = [
  { href: "/", label: "대시보드" },
  { href: "/library", label: "사례 라이브러리" },
  { href: "/upload", label: "데이터 업로드" },
];

export default async function DashLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 shrink-0 flex-col border-r border-neutral-200 bg-white">
        <div className="px-5 py-5">
          <Link href="/" className="block">
            <div className="text-base font-semibold">프로모션 애널리틱스</div>
            <div className="mt-0.5 text-xs text-neutral-400">드르펠리스 MD</div>
          </Link>
        </div>
        <nav className="flex flex-col gap-0.5 px-3">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className="rounded-lg px-3 py-2 text-sm text-neutral-700 transition hover:bg-neutral-100"
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto border-t border-neutral-100 px-5 py-4">
          <div className="truncate text-xs text-neutral-500">{user?.email}</div>
          <form action="/auth/signout" method="post">
            <button className="mt-2 text-xs text-neutral-400 underline-offset-2 hover:text-neutral-700 hover:underline">
              로그아웃
            </button>
          </form>
        </div>
      </aside>
      <main className="flex-1 overflow-x-hidden">{children}</main>
    </div>
  );
}
