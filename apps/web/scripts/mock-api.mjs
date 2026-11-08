// Stand-in for apps/api on :3001 when you don't have Postgres running. Same paths and response
// shapes as the real worker + dashboard routes, plus the worker-account endpoints proposed in
// apps/web/docs/ACCOUNTS_API.md, all in memory. `npm run mock-api -w @operis/web`, then open
// http://localhost:3000/j/demo (open job), /j/taken (someone else got it), /j/nope (expired).
// The browser reaches this server through the /api/* rewrite, so cookies are same-origin.
//
// Mock-only conveniences: SMS codes, login links and reset links are printed here and returned as
// dev_code / dev_link so the UI can show them. Google, LinkedIn and Stripe Identity are simulated by
// small pages under /mock/* (reached as /api/mock/*).
import crypto from "node:crypto";
import http from "node:http";

const now = () => new Date().toISOString();
const job = {
  id: "11111111-2222-3333-4444-555555555555",
  title: "Photograph the storefront at 548 Market St",
  instructions:
    "Take clear daytime photos of the storefront: the full facade from across the street, and a close-up of the posted opening hours. Don't go inside or photograph people's faces.",
  location: { address: "548 Market St, San Francisco, CA", lat: 37.7897, lng: -122.4004 },
  deadline: new Date(Date.now() + 3 * 3600_000).toISOString(),
  pay_usd: 45,
  certification_required: null,
  proof_requirement: { photos: { min: 2, must_show: ["full storefront facade", "posted opening hours"] }, geofence_m: 150 },
  company: "Harbor Logistics AI",
  category: "Photo & video",
};
const tokens = { demo: { status: "open" }, taken: { status: "open", race: true } };
let jobStatus = "outreach";
const ledger = { capture: 0, payout: 0, fee: 0, refund: 0 };
const feed = [{ type: "session.idle", summary: "Ops: blast sent to 12 people near 548 Market St", created_at: now() }];
const timeline = [{ job_id: job.id, event: "held", naive_session_id: "sess_demo_ceo", created_at: now() }];

// ---------- accounts ----------
const users = new Map(); // id -> user
const sessions = new Map(); // sid -> user id
const codes = new Map(); // phone -> { code, exp, tries }
const links = new Map(); // token -> { kind: "login" | "reset", userId, email, exp, next }
const rid = (n = 16) => crypto.randomBytes(n).toString("hex");
const hash = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString("hex");
const normPhone = (p) => String(p ?? "").replace(/[^\d+]/g, "").replace(/^(\d{10})$/, "+1$1").replace(/^1(\d{10})$/, "+1$1");
const normEmail = (e) => String(e ?? "").trim().toLowerCase();

function newUser({ name, email, phone, password, google }) {
  const salt = rid(8);
  const u = {
    id: `wrk_${rid(6)}`,
    name: name || "",
    email: normEmail(email),
    phone: phone ? normPhone(phone) : "",
    salt,
    pw: password ? hash(password, salt) : null,
    google: !!google,
    created_at: now(),
    identity: { status: "unverified", id_type: null, session_id: null },
    skills: [],
    licenses: [],
    profiles: { linkedin: null, portfolio_url: "", other_url: "" },
    permissions: { read_profiles: false, search_public: false, learn_choices: false },
    alerts: { sms: true, email: true, call: false },
    min_pay: "",
    radius: "Up to 25 miles",
    quiet_hours: "9 PM – 8 AM",
    agreed_terms_at: null,
    onboarding_step: 1,
    onboarding_done: false,
  };
  users.set(u.id, u);
  return u;
}
const byEmail = (e) => [...users.values()].find((u) => u.email && u.email === normEmail(e));
const byPhone = (p) => [...users.values()].find((u) => u.phone && u.phone === normPhone(p));
const publicUser = (u) => {
  const { salt, pw, ...rest } = u;
  return { ...rest, has_password: !!pw };
};

// Seed account so you can log in straight away: demo@operis.live / operis-demo-1 or (415) 555-0123.
newUser({ name: "Jordan Rivera", email: "demo@operis.live", phone: "(415) 555-0123", password: "operis-demo-1" });

function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie ?? "").split(/;\s*/).filter(Boolean).map((c) => c.split("=").map(decodeURIComponent)));
}
function currentUser(req) {
  const sid = parseCookies(req).operis_session;
  const id = sid && sessions.get(sid);
  return id ? users.get(id) ?? null : null;
}
function startSession(res, user, remember = true) {
  const sid = rid();
  sessions.set(sid, user.id);
  const maxAge = remember ? 60 * 60 * 24 * 30 : null;
  res.setHeader("Set-Cookie", `operis_session=${sid}; Path=/; HttpOnly; SameSite=Lax${maxAge ? `; Max-Age=${maxAge}` : ""}`);
}
function endSession(req, res) {
  const sid = parseCookies(req).operis_session;
  if (sid) sessions.delete(sid);
  res.setHeader("Set-Cookie", "operis_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
}
const safeNext = (n) => (typeof n === "string" && n.startsWith("/") && !n.startsWith("//") ? n : "/jobs");

// ---------- job view ----------
function view(t, user) {
  const o = tokens[t];
  const mine = o.status === "accepted";
  return {
    job,
    state: mine ? jobStatus : jobStatus === "outreach" ? "open" : "unavailable",
    can_accept: jobStatus === "outreach" && o.status === "open",
    can_upload_proof: mine && jobStatus === "accepted",
    reply_code: "4821",
    responded: o.status === "declined" ? "declined" : null,
    viewer: user
      ? { logged_in: true, name: user.name, cleared: user.identity.status === "verified", identity_status: user.identity.status }
      : { logged_in: false, phone_hint: "(•••) •••-0123" }, // the number this link was texted to
  };
}

const send = (res, code, body) => {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};
const redirect = (res, to) => {
  res.writeHead(302, { Location: to });
  res.end();
};
const html = (res, body) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;font:16px/1.5 system-ui,sans-serif;background:#2F4A37;color:#232824"><div style="max-width:440px;margin:48px auto;padding:28px;background:#FBF9F5;border-radius:16px;display:flex;flex-direction:column;gap:14px">${body}<p style="margin:0;font-size:12px;color:#8a8f88">Simulated by the Operis mock API. In production this is the real provider's page.</p></div></body>`);
};
const btn = (href, label, primary = true) =>
  `<a href="${href}" style="display:block;text-align:center;padding:14px;border-radius:8px;text-decoration:none;font-weight:600;${primary ? "background:#46664F;color:#fff" : "border:1px solid #C5BEB0;color:#232824"}">${label}</a>`;
const body = (req) =>
  new Promise((r) => {
    let s = "";
    req.on("data", (c) => (s += c));
    req.on("end", () => {
      try {
        r(s ? JSON.parse(s) : {});
      } catch {
        r({});
      }
    });
  });

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const path = url.pathname;
    const user = currentUser(req);

    // ---------- worker job links ----------
    const m = path.match(/^\/v1\/worker\/jobs\/([^/]+)(?:\/(accept|decline|proof|feedback))?$/);
    if (m) {
      const [, t, action] = m;
      if (!tokens[t]) return send(res, 404, { error: "not_found" });
      if (!action && req.method === "GET") return send(res, 200, view(t, user));
      if ((action === "accept" || action === "decline") && !user) return send(res, 401, { ok: false, error: "login_required" });
      if (action === "accept") {
        if (tokens[t].race || jobStatus !== "outreach") return send(res, 409, { ok: false, error: "already_taken_or_closed" });
        tokens[t].status = "accepted";
        tokens[t].worker = user.id;
        jobStatus = "accepted";
        timeline.unshift({ job_id: job.id, event: "accepted", naive_session_id: "sess_demo_ops", created_at: now() });
        feed.unshift({ type: "tool.completed", summary: `Ops: ${user.name || "worker"} accepted, outreach stopped`, created_at: now() });
        return send(res, 200, { ok: true, state: "accepted" });
      }
      if (action === "feedback") {
        if (!user) return send(res, 401, { ok: false, error: "login_required" });
        const b = await body(req);
        console.log("[mock] job feedback:", b);
        return send(res, 200, { ok: true });
      }
      if (action === "decline") {
        const b = await body(req);
        tokens[t].status = "declined";
        tokens[t].feedback = b;
        console.log("[mock] decline feedback:", b);
        return send(res, 200, { ok: true });
      }
      if (action === "proof") {
        if (tokens[t].status !== "accepted" || jobStatus !== "accepted") return send(res, 409, { error: "not_your_active_job" });
        const b = await body(req);
        if (!b.media?.length) return send(res, 400, { error: "no_media" });
        console.log("[mock] proof:", { media: b.media.map((x) => ({ kind: x.kind, name: x.name, role: x.role, bytes: x.url.length })), gps: [b.gps_lat, b.gps_lng], captured_at: b.captured_at, fields: b.fields });
        jobStatus = "proof_submitted";
        timeline.unshift({ job_id: job.id, event: "proof_submitted", naive_session_id: "sess_demo_verifier", created_at: now() });
        setTimeout(() => {
          jobStatus = "approved";
          feed.unshift({ type: "tool.completed", summary: "Verifier: approve_proof (score 0.93, 42 m from site)", created_at: now() });
          timeline.unshift({ job_id: job.id, event: "approved", naive_session_id: "sess_demo_finance", created_at: now() });
          ledger.capture += 60; ledger.payout += 45; ledger.fee += 15;
        }, 8000);
        return send(res, 200, { ok: true, proof_id: "proof_demo", state: "proof_submitted" });
      }
    }
    if (path === "/v1/worker/payout-setup" && req.method === "POST") {
      const b = await body(req);
      if (!tokens[b.token]) return send(res, 404, { error: "not_found" });
      return send(res, 200, { url: null, note: "payouts not wired yet (services/payments createPayoutLink)" });
    }

    // ---------- auth ----------
    if (path === "/v1/auth/signup" && req.method === "POST") {
      const b = await body(req);
      if (!b.name?.trim() || !b.email?.includes("@") || normPhone(b.phone).length < 11) return send(res, 400, { error: "invalid_fields" });
      if (String(b.password ?? "").length < 10) return send(res, 400, { error: "weak_password" });
      if (byEmail(b.email)) return send(res, 409, { error: "email_taken" });
      if (byPhone(b.phone)) return send(res, 409, { error: "phone_taken" });
      const u = newUser(b);
      startSession(res, u);
      return send(res, 200, { ok: true, user: publicUser(u) });
    }
    if (path === "/v1/auth/login" && req.method === "POST") {
      const b = await body(req);
      const u = byEmail(b.email);
      if (!u || !u.pw || hash(String(b.password ?? ""), u.salt) !== u.pw) return send(res, 401, { error: "bad_credentials" });
      startSession(res, u, b.remember !== false);
      return send(res, 200, { ok: true, user: publicUser(u) });
    }
    if (path === "/v1/auth/code/send" && req.method === "POST") {
      const b = await body(req);
      // From a job link we text the number the link was sent to (the outreach worker's phone).
      const phone = b.job_token && tokens[b.job_token] ? normPhone("(415) 555-0123") : normPhone(b.phone);
      if (phone.length < 11) return send(res, 400, { error: "invalid_phone" });
      if (!byPhone(phone)) return send(res, 404, { error: "no_account" });
      const code = String(crypto.randomInt(0, 1e6)).padStart(6, "0");
      codes.set(phone, { code, exp: Date.now() + 10 * 60_000, tries: 0 });
      console.log(`[mock] SMS to ${phone}: your Operis code is ${code}`);
      return send(res, 200, { ok: true, phone_hint: `(•••) •••-${phone.slice(-4)}`, dev_code: code });
    }
    if (path === "/v1/auth/code/verify" && req.method === "POST") {
      const b = await body(req);
      const phone = b.job_token && tokens[b.job_token] ? normPhone("(415) 555-0123") : normPhone(b.phone);
      const c = codes.get(phone);
      if (!c || c.exp < Date.now()) return send(res, 400, { error: "code_expired" });
      if (++c.tries > 5) return send(res, 429, { error: "too_many_tries" });
      if (String(b.code).trim() !== c.code) return send(res, 400, { error: "wrong_code" });
      codes.delete(phone);
      const u = byPhone(phone);
      startSession(res, u);
      return send(res, 200, { ok: true, user: publicUser(u) });
    }
    if (path === "/v1/auth/link/send" && req.method === "POST") {
      const b = await body(req);
      const u = byEmail(b.email);
      if (!u) return send(res, 404, { error: "no_account" });
      const t = rid();
      links.set(t, { kind: "login", userId: u.id, exp: Date.now() + 15 * 60_000, next: safeNext(b.next) });
      const link = `/api/v1/auth/link/verify?t=${t}`;
      console.log(`[mock] email to ${u.email}: log in at ${link}`);
      return send(res, 200, { ok: true, dev_link: link });
    }
    if (path === "/v1/auth/link/verify" && req.method === "GET") {
      const l = links.get(url.searchParams.get("t"));
      if (!l || l.kind !== "login" || l.exp < Date.now()) return redirect(res, "/login?error=link_expired");
      links.delete(url.searchParams.get("t"));
      startSession(res, users.get(l.userId));
      return redirect(res, l.next);
    }
    if (path === "/v1/auth/password/reset" && req.method === "POST") {
      const b = await body(req);
      const u = byEmail(b.email);
      // Same answer whether or not the account exists, so the form can't be used to probe emails.
      if (!u) return send(res, 200, { ok: true });
      const t = rid();
      links.set(t, { kind: "reset", userId: u.id, exp: Date.now() + 30 * 60_000 });
      const link = `/reset-password?t=${t}`;
      console.log(`[mock] email to ${u.email}: reset your password at ${link}`);
      return send(res, 200, { ok: true, dev_link: link });
    }
    if (path === "/v1/auth/password/reset/confirm" && req.method === "POST") {
      const b = await body(req);
      const l = links.get(b.t);
      if (!l || l.kind !== "reset" || l.exp < Date.now()) return send(res, 400, { error: "link_expired" });
      if (String(b.password ?? "").length < 10) return send(res, 400, { error: "weak_password" });
      const u = users.get(l.userId);
      u.pw = hash(b.password, u.salt);
      links.delete(b.t);
      startSession(res, u);
      return send(res, 200, { ok: true, user: publicUser(u) });
    }
    if (path === "/v1/auth/google/start" && req.method === "GET") {
      return redirect(res, `/api/mock/google?next=${encodeURIComponent(safeNext(url.searchParams.get("next")))}`);
    }
    if (path === "/v1/auth/google/callback" && req.method === "GET") {
      // Real API: exchange ?code with Google, read the verified email. Mock: a fixed Google identity.
      const email = url.searchParams.get("email") || "google.worker@gmail.com";
      const u = byEmail(email) ?? newUser({ name: "Sam Google", email, google: true });
      startSession(res, u);
      const next = safeNext(url.searchParams.get("next"));
      return redirect(res, u.onboarding_done ? next : `/onboarding?next=${encodeURIComponent(next)}`);
    }
    if (path === "/v1/auth/logout" && req.method === "POST") {
      endSession(req, res);
      return send(res, 200, { ok: true });
    }

    // ---------- me ----------
    if (path.startsWith("/v1/me")) {
      if (!user) return send(res, 401, { error: "login_required" });
      if (path === "/v1/me" && req.method === "GET") return send(res, 200, { user: publicUser(user) });
      if (path === "/v1/me" && req.method === "PATCH") {
        const b = await body(req);
        const allowed = ["name", "skills", "profiles", "permissions", "alerts", "min_pay", "radius", "quiet_hours", "onboarding_step", "onboarding_done"];
        for (const k of allowed) if (k in b) user[k] = k === "profiles" ? { ...user.profiles, ...b.profiles } : b[k];
        if (b.agreed_terms === true && !user.agreed_terms_at) user.agreed_terms_at = now();
        return send(res, 200, { ok: true, user: publicUser(user) });
      }
      if (path === "/v1/me/identity/session" && req.method === "POST") {
        const b = await body(req);
        user.identity = { ...user.identity, id_type: b.id_type ?? null, session_id: `vs_mock_${rid(6)}` };
        const ret = safeNext(b.return_url ?? "/onboarding");
        // Real API: stripe.identity.verificationSessions.create({ type: "document", options: { document: { require_matching_selfie: true } }, return_url })
        return send(res, 200, { ok: true, url: `/api/mock/stripe-identity?return=${encodeURIComponent(ret)}` });
      }
      if (path === "/v1/me/licenses" && req.method === "POST") {
        const b = await body(req);
        if (!b.type || !b.number?.trim()) return send(res, 400, { error: "invalid_fields" });
        const lic = {
          id: `lic_${rid(4)}`, type: b.type, state: b.state ?? null, number: b.number.trim(), certificate: b.certificate ?? null,
          // Mock registry: numbers ending in 0 are "not found", everything else is active.
          status: /0$/.test(b.number.trim()) ? "not_found" : "active", checked_at: now(),
          expires: "Mar 2029",
        };
        user.licenses.push(lic);
        return send(res, 200, { ok: true, license: lic, user: publicUser(user) });
      }
      const del = path.match(/^\/v1\/me\/licenses\/([^/]+)$/);
      if (del && req.method === "DELETE") {
        user.licenses = user.licenses.filter((l) => l.id !== del[1]);
        return send(res, 200, { ok: true, user: publicUser(user) });
      }
      if (path === "/v1/me/linkedin/start" && req.method === "GET") {
        return redirect(res, `/api/mock/linkedin?return=${encodeURIComponent(safeNext(url.searchParams.get("return")))}`);
      }
      if (path === "/v1/me/linkedin/callback" && req.method === "GET") {
        user.profiles.linkedin = { name: user.name || "LinkedIn member", headline: "Notary public · event presenter", connected_at: now() };
        return redirect(res, safeNext(url.searchParams.get("return")));
      }
      if (path === "/v1/me/linkedin" && req.method === "DELETE") {
        user.profiles.linkedin = null;
        return send(res, 200, { ok: true, user: publicUser(user) });
      }
    }

    // ---------- simulated third-party pages ----------
    if (path === "/mock/google") {
      const next = encodeURIComponent(url.searchParams.get("next") ?? "/jobs");
      return html(res, `<h2 style="margin:0">Sign in with Google</h2><p style="margin:0">Choose an account to continue to <strong>operis.live</strong></p>
        ${btn(`/api/v1/auth/google/callback?next=${next}`, "Sam Google · google.worker@gmail.com")}
        ${btn(`/api/v1/auth/google/callback?next=${next}&email=demo@operis.live`, "Jordan Rivera · demo@operis.live", false)}
        ${btn("/login", "Cancel", false)}`);
    }
    if (path === "/mock/linkedin") {
      const ret = url.searchParams.get("return") ?? "/onboarding";
      if (!user) return redirect(res, "/login");
      return html(res, `<h2 style="margin:0">LinkedIn</h2><p style="margin:0"><strong>Operis</strong> would like to read your name, headline, experience and skills.</p>
        ${btn(`/api/v1/me/linkedin/callback?return=${encodeURIComponent(ret)}`, "Allow")}
        ${btn(ret, "Cancel", false)}`);
    }
    if (path === "/mock/stripe-identity") {
      const ret = url.searchParams.get("return") ?? "/onboarding";
      if (!user) return redirect(res, "/login");
      if (url.searchParams.get("result")) {
        const r = url.searchParams.get("result");
        user.identity.status = r === "fail" ? "requires_input" : "processing";
        // Stripe sends identity.verification_session.verified a few seconds later.
        if (r !== "fail") setTimeout(() => (user.identity.status = "verified"), 4000);
        return redirect(res, ret);
      }
      const back = encodeURIComponent(ret);
      return html(res, `<div style="font-weight:700;color:#635BFF">stripe · Identity</div><h2 style="margin:0">Verify your identity for Operis</h2>
        <p style="margin:0">Stripe will ask for a photo of your ${user.identity.id_type ?? "ID"} and a selfie.</p>
        ${btn(`/api/mock/stripe-identity?return=${back}&result=ok`, "Simulate: upload ID + selfie (passes)")}
        ${btn(`/api/mock/stripe-identity?return=${back}&result=fail`, "Simulate: ID unreadable (fails)", false)}
        ${btn(ret, "Cancel", false)}`);
    }

    // ---------- dashboard ----------
    if (path === "/v1/dashboard") {
      const row = { id: job.id, title: job.title, status: jobStatus, address: job.location.address, lat: job.location.lat, lng: job.location.lng, budget_usd: 60, worker_id: null, updated_at: now() };
      const others = [
        { id: "aaaaaaaa-0000-0000-0000-000000000001", title: "Pick up a package in the Mission", status: "paid", address: "Valencia St, SF", lat: 37.7599, lng: -122.4214, budget_usd: 40, worker_id: "w", updated_at: new Date(Date.now() - 3600_000).toISOString() },
        { id: "aaaaaaaa-0000-0000-0000-000000000002", title: "Hold a sign near the YC office", status: "escalated", address: "YC, San Francisco", lat: 37.7749, lng: -122.4194, budget_usd: 60, worker_id: "w", updated_at: new Date(Date.now() - 900_000).toISOString() },
      ];
      return send(res, 200, {
        active_job: ["paid", "refunded", "cancelled", "rejected", "expired"].includes(jobStatus) ? null : row,
        jobs: [row, ...others],
        timeline,
        agent_feed: feed,
        money: { revenue: ledger.capture, payouts: ledger.payout, fees: ledger.fee, refunds: ledger.refund },
      });
    }
    send(res, 404, { error: "not_found" });
  })
  .listen(3001, () =>
    console.log("mock API on http://localhost:3001  (try /j/demo, /j/taken, /j/nope)\n  demo login: demo@operis.live / operis-demo-1  ·  phone (415) 555-0123"),
  );
