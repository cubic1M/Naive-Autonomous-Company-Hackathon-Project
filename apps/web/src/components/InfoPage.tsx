// Content pages (Verification, Pricing, Payouts, Help, About, Contact, Terms, Privacy) in the
// browse-page artboard's style: header, a dark hero, paper cards, and the dark footer.
import Link from "next/link";
import type { ReactNode } from "react";

import SiteHeader from "./SiteHeader";

export const GITHUB = "https://github.com/cubic1M/Naive-Autonomous-Company-Hackathon-Project";
export const AGENT_GUIDE = "https://api.operis.live/llms.txt";

export function SiteFooter() {
  const a = { textDecoration: "none", color: "inherit" } as const;
  return (
    <footer style={{ background: "radial-gradient(90% 120% at 85% 100%, #2C3D31 0%, #1A241D 45%, #141B16 100%)", color: "#C3CBC2", overflow: "hidden" }}>
      <div style={{ maxWidth: "1320px", margin: "0 auto", padding: "44px 24px 0", display: "flex", flexWrap: "wrap", gap: "32px" }}>
        <div style={{ flex: "2 1 260px", display: "flex", flexDirection: "column", gap: "10px" }}>
          <span style={{ display: "flex", alignItems: "center", gap: "8px", color: "#F3EEE4", fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "17px" }}>
            <svg width="22" height="22" viewBox="0 0 34 34" aria-hidden="true"><rect width="34" height="34" rx="8" fill="#ECE8DF" /><circle cx="13.5" cy="17" r="6" fill="none" stroke="#1F2A22" strokeWidth="2.4" /><circle cx="20.5" cy="17" r="6" fill="none" stroke="#46664F" strokeWidth="2.4" /></svg>operis.
          </span>
          <span style={{ fontSize: "13px" }}>Escrow on every job. Licenses checked against state registries.</span>
        </div>
        <nav aria-label="Footer" style={{ flex: "3 1 360px", display: "flex", flexWrap: "wrap", gap: "10px 26px", fontSize: "14px", alignContent: "flex-start" }}>
          <Link href="/#for-people" style={a}>For workers</Link>
          <a href={AGENT_GUIDE} style={a}>API for agent companies</a>
          <Link href="/verification" style={a}>Verification</Link>
          <Link href="/terms" style={a}>Terms</Link>
          <Link href="/privacy" style={a}>Privacy</Link>
        </nav>
      </div>
      <div aria-hidden="true" style={{ maxWidth: "1320px", margin: "0 auto", padding: "24px 24px 0", fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "clamp(90px, 15vw, 220px)", lineHeight: 0.85, letterSpacing: "-0.06em", color: "#243128" }}>operis<span style={{ color: "#46664F" }}>.</span></div>
      <div style={{ maxWidth: "1320px", margin: "0 auto", padding: "20px 24px", fontSize: "12px", color: "#8E958C", borderTop: "1px solid #2A362E" }}>© 2026 Operis. All rights reserved.</div>
    </footer>
  );
}

export function InfoPage({ eyebrow, title, muted, intro, children, note }: { eyebrow: string; title: string; muted?: string; intro: string; children: ReactNode; note?: ReactNode }) {
  return (
    <div style={{ borderRadius: "22px", overflow: "hidden", background: "#ECE8DF" }}>
      <div style={{ color: "#232824", background: "#ECE8DF", minHeight: "calc(100vh - 24px)", display: "flex", flexDirection: "column" }}>
        <SiteHeader />
        <main style={{ flex: "1", width: "100%", maxWidth: "980px", margin: "0 auto", boxSizing: "border-box", padding: "20px 24px 64px", display: "flex", flexDirection: "column", gap: "18px" }}>
          <section style={{ display: "flex", flexDirection: "column", gap: "14px", padding: "12px 0 8px" }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "13px", color: "#5B635C" }}>✳ /{eyebrow}/</span>
            <h1 style={{ margin: "0", fontFamily: "var(--font-display)", fontWeight: 500, fontSize: "clamp(34px, 4.4vw, 54px)", lineHeight: 1.04, letterSpacing: "-0.045em", color: "#1F2A22" }}>
              {title}{muted && <> <span style={{ color: "#7A8178" }}>{muted}</span></>}
            </h1>
            <p style={{ margin: "0", fontSize: "17px", lineHeight: 1.55, color: "#5B635C", maxWidth: "680px" }}>{intro}</p>
          </section>
          {note && (
            <div style={{ padding: "12px 16px", borderRadius: "12px", border: "1px dashed #C5BEB0", background: "#F3F0E9", fontSize: "14px", color: "#4F5751" }}>{note}</div>
          )}
          {children}
        </main>
        <SiteFooter />
      </div>
    </div>
  );
}

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section style={{ background: "#FBF9F5", border: "1px solid #DCD6CA", borderRadius: "14px", padding: "24px", display: "flex", flexDirection: "column", gap: "10px", fontSize: "15px", lineHeight: 1.6, color: "#3C443E" }}>
      {title && <h2 style={{ margin: "0", fontSize: "17px", fontWeight: 700, color: "#1F2A22", fontFamily: "var(--font)", letterSpacing: "normal" }}>{title}</h2>}
      {children}
    </section>
  );
}

export const Grid = ({ children }: { children: ReactNode }) => (
  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "16px" }}>{children}</div>
);

export const P = ({ children }: { children: ReactNode }) => <p style={{ margin: "0" }}>{children}</p>;
export const UL = ({ items }: { items: ReactNode[] }) => (
  <ul style={{ margin: "0", paddingLeft: "20px", display: "flex", flexDirection: "column", gap: "6px" }}>{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
);
export const CTA = ({ href, children, outline }: { href: string; children: ReactNode; outline?: boolean }) => (
  <Link href={href} style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", minHeight: "46px", padding: "0 20px", borderRadius: "8px", fontSize: "15px", fontWeight: 600, textDecoration: "none", ...(outline ? { border: "1px solid #C5BEB0", background: "#FBF9F5", color: "#232824" } : { background: "#46664F", color: "#FFFFFF" }) }}>{children}</Link>
);
