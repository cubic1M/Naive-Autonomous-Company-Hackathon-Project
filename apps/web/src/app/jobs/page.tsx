import type { Metadata } from "next";
import Browse from "./Browse";

export const metadata: Metadata = { title: "Operis · Browse requests" };

export default function Page() {
  return <Browse />;
}
