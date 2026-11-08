"use client";

// My account: not an artboard in the design, built from its Auth/Onboarding pieces. It's where the
// onboarding sidebar's "change anything later in Settings" points.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { AuthFooter, SimpleHeader, headerLink } from "@/components/auth/AuthPage";
import { ACCENT } from "@/components/auth/ui";
import { initials, useSession, type User } from "@/lib/session";
import { METHOD_LABEL, when } from "@/lib/signin";

const ID_TEXT: Record<string, [string, string]> = {
  verified: ["Identity verified", "#2F4A37"],
  processing: ["ID check in progress", "#8A5300"],
  requires_input: ["ID check needs another try", "#A12A22"],
  unverified: ["Identity not verified yet", "#A12A22"],
};

export default function AccountPage() {
  const router = useRouter();
  const { user, loading, logout } = useSession();

  useEffect(() => {
    if (!loading && !user) router.replace("/login?next=/account");
  }, [loading, user, router]);

  if (!user) return <div style={{ minHeight: "100vh", background: "#ECE8DF" }} aria-busy="true" />;

  const [idText, idColor] = ID_TEXT[user.identity.status] ?? ID_TEXT.unverified!;
  const card = { background: "#FBF9F5", border: "1px solid #DCD6CA", borderRadius: "14px", padding: "22px", display: "flex", flexDirection: "column", gap: "12px" } as const;
  const row = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap", fontSize: "15px" } as const;
  const edit = (step: number) => ({ href: `/onboarding?step=${step}&next=/account`, style: { fontSize: "14px", fontWeight: 600, color: "#3B5A44", textDecoration: "none" } });

  return (
    <div style={{ overflow: "hidden", background: "#ECE8DF" }}>
      <div style={{ color: "#232824", background: "#ECE8DF", minHeight: "100vh", display: "flex", flexDirection: "column" }}>
        <SimpleHeader action={<Link href="/jobs" style={headerLink}>Browse requests</Link>} />
        <main style={{ flex: "1", width: "100%", maxWidth: "880px", margin: "0 auto", boxSizing: "border-box", padding: "28px 24px 56px", display: "flex", flexDirection: "column", gap: "16px" }}>
          <section style={{ ...card, background: "radial-gradient(120% 110% at 88% 0%, #43594A 0%, #26342B 42%, #151D17 100%)", border: "0", color: "#F3EEE4", flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: "16px" }}>
            <span aria-hidden="true" style={{ width: "56px", height: "56px", borderRadius: "999px", background: "#A9C0A2", color: "#1E2A22", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: "18px" }}>{initials(user.name)}</span>
            <div style={{ flex: "1 1 240px", display: "flex", flexDirection: "column", gap: "2px" }}>
              <h1 style={{ margin: "0", fontFamily: "var(--font-display)", fontWeight: 500, fontSize: "26px", letterSpacing: "-0.035em", color: "#F3EEE4" }}>{user.name || "Your account"}</h1>
              <span style={{ fontSize: "14px", color: "#C3CBC2" }}>{[user.email, user.phone].filter(Boolean).join(" · ")}</span>
            </div>
            <button type="button" onClick={async () => { await logout(); router.push("/"); }} style={{ minHeight: "44px", padding: "0 18px", borderRadius: "8px", border: "1px solid #4A5A4E", background: "transparent", color: "#F3EEE4", font: "inherit", fontSize: "14px", fontWeight: 600, cursor: "pointer" }}>Log out</button>
          </section>

          {!user.onboarding_done && (
            <section style={{ ...card, flexDirection: "row", alignItems: "center", flexWrap: "wrap", background: "#E9EFE4", border: "1px solid #DCE6D8" }}>
              <span style={{ flex: "1 1 260px", fontSize: "15px", color: "#2F4A37" }}><strong>Finish setting up.</strong> You&apos;re on step {Math.min(user.onboarding_step, 4)} of 4. Jobs are only sent to verified workers.</span>
              <Link href={`/onboarding?step=${Math.min(user.onboarding_step, 4)}`} style={{ display: "inline-flex", alignItems: "center", minHeight: "44px", padding: "0 18px", borderRadius: "8px", background: ACCENT, color: "#FFFFFF", fontSize: "14px", fontWeight: 600, textDecoration: "none" }}>Continue setup</Link>
            </section>
          )}

          <section style={card}>
            <div style={row}><h2 style={{ margin: "0", fontSize: "16px", fontWeight: 700, fontFamily: "var(--font)", letterSpacing: "normal" }}>Identity</h2><Link {...edit(1)}>Manage</Link></div>
            <span style={{ fontSize: "15px", fontWeight: 600, color: idColor }}>{idText}{user.identity.id_type ? ` · ${user.identity.id_type}` : ""}</span>
          </section>

          <section style={card}>
            <div style={row}><h2 style={{ margin: "0", fontSize: "16px", fontWeight: 700, fontFamily: "var(--font)", letterSpacing: "normal" }}>Skills and licenses</h2><Link {...edit(2)}>Edit</Link></div>
            <span style={{ fontSize: "15px", color: "#3C443E" }}>{user.skills.length ? user.skills.join(", ") : "No skills picked yet"}</span>
            {user.licenses.map((l) => (
              <span key={l.id} style={{ fontSize: "14px", color: l.status === "active" ? "#2F4A37" : "#A12A22" }}>
                {l.state && l.state !== "Other" ? `${l.state} ` : ""}{l.type} #{l.number} · {l.status === "active" ? "active on registry" : "not found on registry"}
              </span>
            ))}
          </section>

          <section style={card}>
            <div style={row}><h2 style={{ margin: "0", fontSize: "16px", fontWeight: 700, fontFamily: "var(--font)", letterSpacing: "normal" }}>Profiles and permissions</h2><Link {...edit(3)}>Edit</Link></div>
            <span style={{ fontSize: "15px", color: "#3C443E" }}>LinkedIn: {user.profiles.linkedin ? "connected" : "not connected"}{user.profiles.portfolio_url ? ` · ${user.profiles.portfolio_url}` : ""}</span>
            <span style={{ fontSize: "14px", color: "#4F5751" }}>
              {[user.permissions.read_profiles && "reads your profiles", user.permissions.search_public && "searches public sources", user.permissions.learn_choices && "learns from your choices"].filter(Boolean).join(" · ") || "Operis may not read your profiles, search about you, or learn from your choices."}
            </span>
          </section>

          <section style={card}>
            <div style={row}><h2 style={{ margin: "0", fontSize: "16px", fontWeight: 700, fontFamily: "var(--font)", letterSpacing: "normal" }}>Job alerts</h2><Link {...edit(4)}>Edit</Link></div>
            <span style={{ fontSize: "15px", color: "#3C443E" }}>
              {[user.alerts.sms && "Text", user.alerts.email && "Email", user.alerts.call && "Phone call"].filter(Boolean).join(", ") || "No alerts"} · {user.radius}{user.min_pay ? ` · at least $${user.min_pay.replace(/^\$/, "")}/hr` : ""} · quiet {user.quiet_hours}
            </span>
          </section>

          <section style={card}>
            <div style={row}><h2 style={{ margin: "0", fontSize: "16px", fontWeight: 700, fontFamily: "var(--font)", letterSpacing: "normal" }}>Sign-in</h2><Link href={`/forgot-password?email=${encodeURIComponent(user.email)}`} style={{ fontSize: "14px", fontWeight: 600, color: "#3B5A44", textDecoration: "none" }}>{user.has_password ? "Change password" : "Set a password"}</Link></div>
            <SignInDetails user={user} />
          </section>
        </main>
        <AuthFooter />
      </div>
    </div>
  );
}

// Sign-in methods and history: Google connected (and since when), password, last and previous sign-in.
function SignInDetails({ user }: { user: User }) {
  const si = user.sign_in;
  const row = { display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "baseline", flexWrap: "wrap" as const, fontSize: "15px", padding: "8px 0", borderTop: "1px solid #E4DED2" };
  const ok = (on: boolean, yes: string, no: string) => <span style={{ fontWeight: 600, color: on ? "#2F4A37" : "#8E958C" }}>{on ? yes : no}</span>;
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ ...row, borderTop: "none" }}>
        <span style={{ color: "#3C443E" }}>Google</span>
        {ok(!!si?.google.connected, `Connected as ${user.email}${si?.google.since ? ` · since ${when(si.google.since)}` : ""}`, "Not connected")}
      </div>
      <div style={row}>
        <span style={{ color: "#3C443E" }}>Password</span>
        {ok(!!si?.password, "Set", "Not set")}
      </div>
      <div style={row}>
        <span style={{ color: "#3C443E" }}>Email link</span>
        {ok(true, `Sent to ${user.email}`, "")}
      </div>
      {si?.last && (
        <div style={row}>
          <span style={{ color: "#3C443E" }}>Last sign-in</span>
          <span style={{ color: "#232824" }}>{METHOD_LABEL[si.last.method ?? ""] ?? "Signed in"}, {when(si.last.at)}</span>
        </div>
      )}
      {si?.previous && (
        <div style={row}>
          <span style={{ color: "#3C443E" }}>Before that</span>
          <span style={{ color: "#5B635C" }}>{METHOD_LABEL[si.previous.method ?? ""] ?? "Signed in"}, {when(si.previous.at)}</span>
        </div>
      )}
      {si?.member_since && <div style={{ ...row, color: "#8E958C", fontSize: "13px" }}>Member since {new Date(si.member_since).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</div>}
    </div>
  );
}
