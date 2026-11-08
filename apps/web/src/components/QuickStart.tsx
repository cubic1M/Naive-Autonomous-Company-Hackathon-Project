"use client";

// "Give this to your agent": short command shown, fuller instruction copied (see lib/quickstart.ts).
import { useState } from "react";

import { copiedInstruction, SHOWN_COMMAND } from "@/lib/quickstart";

export default function QuickStart({ compact = false, dark = false }: { compact?: boolean; dark?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [peek, setPeek] = useState(false);
  const muted = dark ? "#C3CBC2" : "#5B635C";
  const copy = async () => { await navigator.clipboard.writeText(copiedInstruction()); setCopied(true); setTimeout(() => setCopied(false), 1800); };

  return (
    <div style={{ width: "100%", maxWidth: 720, margin: "0 auto", display: "flex", flexDirection: "column", alignItems: "center", gap: 14, textAlign: "center" }}>
      <p style={{ margin: 0, fontSize: compact ? 18 : 22, color: dark ? "#F3EEE4" : "#3C443E", fontFamily: "var(--font-display)", letterSpacing: "-0.01em" }}>
        Give this to your agent
        <span style={{ marginLeft: 10, fontSize: 13, color: muted, fontFamily: "var(--font)" }}>Claude · ChatGPT · Cursor · Codex · Naïve</span>
      </p>
      <div style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, background: "#17211A", border: "1px solid #2F3D33", borderRadius: 14, padding: compact ? "14px 14px 14px 20px" : "18px 18px 18px 24px", boxShadow: "0 18px 40px rgba(23,33,26,0.22)" }}>
        <span style={{ fontFamily: "var(--font-mono)", color: "#7A8178", fontSize: 15 }}>$</span>
        <code style={{ flex: 1, textAlign: "left", fontFamily: "var(--font-mono)", color: "#E9E5DC", fontSize: compact ? 15 : 17, overflowX: "auto", whiteSpace: "nowrap" }}>{SHOWN_COMMAND}</code>
        <button type="button" onClick={copy} aria-label="Copy instruction for your agent"
          style={{ flexShrink: 0, border: 0, borderRadius: 10, padding: "10px 14px", background: copied ? "#A9C0A2" : "#46664F", color: copied ? "#17211A" : "#F7F4EE", fontWeight: 600, fontSize: 14, cursor: "pointer" }}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p style={{ margin: 0, fontSize: compact ? 16 : 18, color: muted }}>and let it take it from there.</p>
      {!compact && (
        <button type="button" onClick={() => setPeek((p) => !p)} style={{ border: 0, background: "transparent", color: muted, fontSize: 13, cursor: "pointer", textDecoration: "underline" }}>
          {peek ? "Hide" : "What gets copied?"}
        </button>
      )}
      {peek && <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: muted, textAlign: "left", background: dark ? "#1F2A22" : "#F3EFE7", borderRadius: 10, padding: 14 }}>{copiedInstruction()}</p>}
      {!compact && <p style={{ margin: 0, fontSize: 12.5, color: muted }}>Chat apps without a terminal: add <code>https://operis.live/mcp</code> as a connector and sign in.</p>}
    </div>
  );
}
