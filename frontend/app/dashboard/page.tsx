import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import DashboardClient from "./DashboardClient";

export default async function DashboardPage() {
  const supabase = await createClient();

  // getSession reads the cookie directly — reliable for extracting access_token
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  return (
    <DashboardClient
      token={session.access_token}
      userName={session.user.email ?? ""}
    />
  );
}
