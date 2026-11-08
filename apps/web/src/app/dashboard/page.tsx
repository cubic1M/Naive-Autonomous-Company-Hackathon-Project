import type { Metadata } from "next";
import Dashboard from "./Dashboard";

export const metadata: Metadata = { title: "Operis · Live dashboard" };

export default function Page() {
  return <Dashboard />;
}
