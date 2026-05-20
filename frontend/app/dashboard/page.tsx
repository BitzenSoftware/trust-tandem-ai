import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import DashboardClient from "./DashboardClient";

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const token = (await supabase.auth.getSession()).data.session?.access_token ?? "";

  return <DashboardClient token={token} userName={user.email ?? ""} />;
}
