import type { Metadata } from "next";

import Onboarding from "@/components/onboarding/Onboarding";
import { safeNext } from "@/lib/nav";

export const metadata: Metadata = { title: "Set up your account · Operis" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const step = Math.min(5, Math.max(1, Number(sp.step) || 1));
  return <Onboarding startStep={step} next={safeNext(sp.next)} />;
}
