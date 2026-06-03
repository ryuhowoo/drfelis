import { createClient } from "@/lib/supabase/server";
import AppShell from "./AppShell";

export default async function DashLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return <AppShell email={user?.email}>{children}</AppShell>;
}
