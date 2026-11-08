import type { Metadata } from "next";

import AuthPage from "@/components/auth/AuthPage";
import LoginFromJob from "@/components/auth/LoginFromJob";
import { safeNext } from "@/lib/nav";

export const metadata: Metadata = { title: "Log in · Operis" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  // Came from a texted job link: show that job beside the login form.
  const job = next.match(/^\/j\/([^/?#]+)/);
  if (job) return <LoginFromJob token={decodeURIComponent(job[1]!)} next={next} />;
  return <AuthPage mode="login" next={next} error={sp.error ?? null} />;
}
