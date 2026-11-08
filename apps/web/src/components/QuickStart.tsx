"use client";

// "Paste one prompt into your agent": the fastest way in for agents with web access.
import { useState } from "react";

import { quickStartPrompt } from "@/lib/quickstart";

export default function QuickStart({ compact = false }: { compact?: boolean }) {
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [task, setTask] = useState("");
  const [copied, setCopied] = useState(false);
  const text = quickStartPrompt({ email, company, task });
  const input: React.CSSProperties = { font: "inherit", fontSize: 14, padding: "10px 12px", borderRadius: 8, border: "1px solid #C5BEB0", background: "#FBF9F5", color: "#232824", flex: "1 1 180px", minWidth: 0 };

  return (
    <div style={{ width: "100%", maxWidth: compact ? 640 : undefined, textAlign: "left", background: "#FBF9F5", border: "1px solid #DCD6CA", borderRadius: 14, padding: compact ? 14 : 20, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <strong style={{ fontFamily: "var(--font-display)", fontWeight: 600, color: "#1F2A22" }}>Fastest: paste one prompt into your agent</strong>
        <span style={{ fontSize: 12, color: "#5B635C" }}>Claude Code, Codex, Cursor agent, Naïve and custom agents with web access</span>
      </div>
      {!compact && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input style={input} placeholder="Your email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input style={input} placeholder="Company name" value={company} onChange={(e) => setCompany(e.target.value)} />
          <input style={{ ...input, flex: "2 1 320px" }} placeholder="Task, e.g. photograph the storefront at 2102 Union St, $30, within 3 hours" value={task} onChange={(e) => setTask(e.target.value)} />
        </div>
      )}
      <div style={{ position: "relative" }}>
        <pre style={{ margin: 0, whiteSpace: "pre-wrap", background: "#17211a", color: "#e9e5dc", padding: "14px 14px 14px", borderRadius: 10, fontSize: 12.5, lineHeight: 1.6, fontFamily: "var(--font-mono)" }}>{text}</pre>
        <button type="button" onClick={async () => { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
          style={{ position: "absolute", top: 8, right: 8, border: 0, borderRadius: 8, padding: "6px 12px", background: copied ? "#a9c0a2" : "#46664f", color: copied ? "#17211a" : "#f7f4ee", fontWeight: 600, cursor: "pointer", fontSize: 13 }}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <span style={{ fontSize: 12, color: "#5B635C" }}>Your agent signs you up with your email, saves its key, connects for next time, and hires the person. You pay once at the Stripe link it gives you. Chat apps (ChatGPT, claude.ai) can&apos;t sign up this way; use the connector URL <code>https://operis.live/mcp</code>.</span>
    </div>
  );
}
