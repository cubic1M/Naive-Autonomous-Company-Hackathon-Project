"use client";

// The header from the "Operis Homepage" design: logo pill with the menu button, optional center nav,
// and Log in / Sign up (or the signed-in worker) on the right.
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { initials, shortName, useSession } from "@/lib/session";

const ACCENT = "#46664F";

const MENU = [
  { href: "/jobs", label: "Browse requests" },
  { href: "/#for-people", label: "How it works for people" },
  { href: "/developers", label: "For agent companies: get an API key" },
  { href: "/verification", label: "How verification works" },
  { href: "/pricing", label: "Pricing" },
  { href: "/dashboard", label: "Live dashboard" },
  { href: "/backoffice", label: "Backoffice (founders)" },
];

export function Logo() {
  return (
    <svg width="24" height="24" viewBox="0 0 34 34" aria-hidden="true">
      <rect width="34" height="34" rx="8" fill="#1F2A22" />
      <circle cx="13.5" cy="17" r="6" fill="none" stroke="#ECE8DF" strokeWidth="2.4" />
      <circle cx="20.5" cy="17" r="6" fill="none" stroke="#A9C0A2" strokeWidth="2.4" />
    </svg>
  );
}

export function LogoPill() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { user, logout } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const item = { display: "flex", alignItems: "center", minHeight: "44px", padding: "0 12px", borderRadius: "8px", color: "#1F2A22", textDecoration: "none", fontSize: "15px", fontWeight: 500, background: "transparent", border: "0", font: "inherit", cursor: "pointer", width: "100%", textAlign: "left" } as const;

  return (
    <div ref={ref} style={{ position: "relative", display: "flex", alignItems: "center", gap: "10px", padding: "6px 6px 6px 8px", background: "#F7F4EE", border: "1px solid #DCD6CA", borderRadius: "12px" }}>
      <Link href="/" style={{ display: "flex", alignItems: "center", gap: "8px", textDecoration: "none", color: "#1F2A22" }}>
        <Logo />
        <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "17px", letterSpacing: "-0.02em" }}>operis.</span>
      </Link>
      <button type="button" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} aria-controls="site-menu" onClick={() => setOpen((o) => !o)} style={{ width: "36px", height: "36px", border: "0", borderRadius: "8px", background: ACCENT, color: "#ECE8DF", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
          {open ? <path d="M7 7l10 10M17 7L7 17" /> : <path d="M6 9h12M6 15h12" />}
        </svg>
      </button>
      {open && (
        <nav id="site-menu" aria-label="Site" style={{ position: "absolute", top: "calc(100% + 8px)", left: 0, zIndex: 50, width: "min(300px, calc(100vw - 48px))", background: "#FBF9F5", border: "1px solid #DCD6CA", borderRadius: "14px", padding: "8px", boxShadow: "0 18px 40px rgba(20, 30, 22, 0.18)", display: "flex", flexDirection: "column", gap: "2px" }}>
          {MENU.map((m) => (
            <Link key={m.href} href={m.href} style={item} onClick={() => setOpen(false)}>{m.label}</Link>
          ))}
          <div style={{ height: "1px", background: "#E3DED3", margin: "6px 4px" }} />
          {user ? (
            <>
              <Link href="/account" style={item}>My account</Link>
              <button type="button" style={item} onClick={async () => { await logout(); setOpen(false); router.push("/"); }}>Log out</button>
            </>
          ) : (
            <>
              <Link href="/login" style={item}>Log in</Link>
              <Link href="/signup" style={item}>Create account</Link>
            </>
          )}
        </nav>
      )}
    </div>
  );
}

/** Log in + Sign up buttons, or the worker's avatar once they're signed in. */
export function AuthButtons() {
  const { user, loading } = useSession();
  const pathname = usePathname();
  const next = pathname && pathname !== "/" && !pathname.startsWith("/login") && !pathname.startsWith("/signup") ? `?next=${encodeURIComponent(pathname)}` : "";
  if (loading) return <div style={{ width: "160px", height: "44px" }} aria-hidden="true" />;
  if (user)
    return (
      <Link href="/account" style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "15px", fontWeight: 600, color: "#232824", textDecoration: "none", minHeight: "44px" }}>
        <span aria-hidden="true" style={{ width: "36px", height: "36px", borderRadius: "999px", background: "#E2EADE", color: "#2F4A37", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px", fontWeight: 700 }}>{initials(user.name)}</span>
        {shortName(user.name)}
      </Link>
    );
  return (
    <div style={{ display: "flex", gap: "8px" }}>
      <Link href={`/login${next}`} style={{ display: "inline-flex", alignItems: "center", minHeight: "44px", padding: "0 18px", borderRadius: "8px", background: ACCENT, color: "#F7F4EE", fontSize: "14px", fontWeight: 500, textDecoration: "none" }}>Log in</Link>
      <Link href={`/signup${next}`} style={{ display: "inline-flex", alignItems: "center", minHeight: "44px", padding: "0 18px", borderRadius: "8px", background: "#FFFFFF", color: "#1F2A22", fontSize: "14px", fontWeight: 500, textDecoration: "none", border: "1px solid #DCD6CA" }}>Sign up</Link>
    </div>
  );
}

export default function SiteHeader({ center, right }: { center?: ReactNode; right?: ReactNode }) {
  return (
    <header style={{ position: "relative", zIndex: 5, background: "#ECE8DF" }}>
      <div style={{ maxWidth: "1320px", margin: "0 auto", padding: "16px", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "12px 32px" }}>
        <LogoPill />
        {center}
        {right ?? <AuthButtons />}
      </div>
    </header>
  );
}
