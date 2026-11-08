// Landing pages Stripe sends people back to (checkout, Connect onboarding, Identity). Same card look as the site.
import type { ReactNode } from "react";

import { LogoPill } from "@/components/SiteHeader";

export default function ReturnPage({ tone, eyebrow, title, children }: { tone: "good" | "warn" | "info"; eyebrow: string; title: string; children: ReactNode }) {
  const icon = tone === "good" ? "✓" : tone === "warn" ? "!" : "i";
  return (
    <main className="landing">
      <div style={{ padding: "16px 16px 0" }}><LogoPill /></div>
      <div className="shell" style={{ maxWidth: 560, paddingTop: 40 }}>
        <section className="card stack center" style={{ padding: "32px 22px" }}>
          <div className="badge-icon" style={{ margin: "0 auto", width: 56, height: 56, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, fontWeight: 700, background: `var(--${tone === "good" ? "accent" : tone}-soft)`, color: `var(--${tone === "good" ? "accent-ink" : tone})` }}>{icon}</div>
          <span className="eyebrow">{eyebrow}</span>
          <h1>{title}</h1>
          <div className="stack muted" style={{ gap: 10 }}>{children}</div>
        </section>
      </div>
    </main>
  );
}
