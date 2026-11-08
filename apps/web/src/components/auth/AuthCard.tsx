// A single centered card in the Auth artboard's style, for the smaller account screens.
import Link from "next/link";
import type { ReactNode } from "react";

import { AuthFooter, SimpleHeader, headerLink } from "./AuthPage";

export function AuthCard({ title, intro, children }: { title: string; intro: string; children: ReactNode }) {
  return (
    <div style={{ borderRadius: "22px", overflow: "hidden", background: "#ECE8DF" }}>
      <div style={{ color: "#232824", background: "#ECE8DF", minHeight: "calc(100vh - 24px)", display: "flex", flexDirection: "column" }}>
        <SimpleHeader action={<Link href="/jobs" style={headerLink}>Back to requests</Link>} />
        <main style={{ flex: "1", width: "100%", maxWidth: "520px", margin: "0 auto", boxSizing: "border-box", padding: "40px 24px 56px" }}>
          <section style={{ background: "#FBF9F5", border: "1px solid #DCD6CA", borderRadius: "14px", padding: "32px", display: "flex", flexDirection: "column", gap: "18px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <h1 style={{ margin: "0", fontFamily: "var(--font-display)", fontWeight: 500, fontSize: "26px", letterSpacing: "-0.035em", color: "#1F2A22" }}>{title}</h1>
              <p style={{ margin: "0", fontSize: "15px", lineHeight: 1.55, color: "#4F5751" }}>{intro}</p>
            </div>
            {children}
          </section>
        </main>
        <AuthFooter />
      </div>
    </div>
  );
}
