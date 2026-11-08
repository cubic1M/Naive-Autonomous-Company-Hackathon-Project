import type { Metadata } from "next";

import AuthPage from "@/components/auth/AuthPage";
import { safeNext } from "@/lib/nav";

export const metadata: Metadata = { title: "Create account · Operis" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  return <AuthPage mode="signup" next={safeNext(sp.next)} />;
}
