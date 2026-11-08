import type { Metadata } from "next";
import { Suspense } from "react";
import Connect from "./Connect";
export const metadata: Metadata = { title: "Connect to Operis" };
export default function Page() {
  return <Suspense><Connect /></Suspense>;
}
