import type { Metadata } from "next";

import ResetPassword from "@/components/auth/ResetPassword";

export const metadata: Metadata = { title: "Choose a new password · Operis" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  return <ResetPassword token={sp.t ?? ""} />;
}
