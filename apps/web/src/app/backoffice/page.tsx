import type { Metadata } from "next";
import Backoffice from "./Backoffice";
export const metadata: Metadata = { title: "Operis backoffice" };
export default function Page() {
  return <Backoffice />;
}
