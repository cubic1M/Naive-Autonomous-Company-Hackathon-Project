import type { Metadata } from "next";

import ForgotPassword from "@/components/auth/ForgotPassword";

export const metadata: Metadata = { title: "Reset password · Operis" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  return <ForgotPassword email={sp.email ?? ""} />;
}
