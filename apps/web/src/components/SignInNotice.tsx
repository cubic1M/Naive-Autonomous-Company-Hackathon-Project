"use client";

// One-time confirmation after any sign-in: "Welcome back, Edwin. Signed in with Google as edwin@…"
// with when they last signed in before this. Reads ?signed_in=&welcome= (set by Google and email-link
// redirects) or a note left by in-page sign-ins, shows once, then cleans the URL.
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

import { useSession } from "@/lib/session";
import { METHOD_LABEL, rememberMethod, takeJustSignedIn, when } from "@/lib/signin";

type Note = { method: string; welcome: string };

export default function SignInNotice() {
  const { user } = useSession();
  const pathname = usePathname();
  const [note, setNote] = useState<Note | null>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    const method = url.searchParams.get("signed_in");
    if (method) {
      const welcome = url.searchParams.get("welcome") ?? "back";
      rememberMethod(method);
      setNote({ method, welcome });
      url.searchParams.delete("signed_in");
      url.searchParams.delete("welcome");
      window.history.replaceState(null, "", url.pathname + (url.search || "") + url.hash);
      return;
    }
    const j = takeJustSignedIn();
    if (j) setNote(j);
  }, [pathname]);

  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 9000);
    return () => clearTimeout(t);
  }, [note]);

  if (!note || !user) return null;
  const first = (user.name || "").split(/\s+/)[0] || "there";
  const how = METHOD_LABEL[note.method] ?? note.method;
  const prev = user.sign_in?.previous;
  const title =
    note.welcome === "new" || note.method === "signup" ? "Your Operis account is ready"
    : note.welcome === "linked" ? "Google is now connected to your account"
    : `Welcome back, ${first}`;
  const line =
    note.welcome === "linked" ? `From now on you can sign in with Google as ${user.email}.`
    : note.method === "signup" ? `Signed in as ${user.email}.`
    : `Signed in with ${how} as ${user.email}.`;
  const before = note.welcome === "back" && prev ? `Before this: ${METHOD_LABEL[prev.method ?? ""] ?? "signed in"}, ${when(prev.at)}.` : null;

  return (
    <div role="status" aria-live="polite" style={{ position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)", zIndex: 60, width: "min(520px, calc(100% - 24px))" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", background: "#17211A", color: "#F3EEE4", borderRadius: 14, padding: "14px 16px", boxShadow: "0 18px 40px rgba(23,33,26,0.28)" }}>
        <span aria-hidden="true" style={{ flex: "none", width: 26, height: 26, borderRadius: 999, background: "#A9C0A2", color: "#17211A", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 14 }}>✓</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 15 }}>{title}</div>
          <div style={{ fontSize: 14, color: "#C3CBC2", marginTop: 2, overflowWrap: "anywhere" }}>{line}</div>
          {before && <div style={{ fontSize: 13, color: "#8E958C", marginTop: 4 }}>{before}</div>}
        </div>
        <button type="button" onClick={() => setNote(null)} aria-label="Dismiss" style={{ flex: "none", border: 0, background: "transparent", color: "#C3CBC2", fontSize: 18, cursor: "pointer", padding: "0 4px", lineHeight: 1 }}>×</button>
      </div>
    </div>
  );
}
