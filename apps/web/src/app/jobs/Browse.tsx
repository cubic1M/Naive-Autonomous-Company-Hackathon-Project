"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";

import SiteHeader from "@/components/SiteHeader";

// Ported 1:1 from the "Operis Homepage" design canvas, artboard "Homepage · browse requests" (Main.dc.html).
// The listings are the design's sample data: the API has no public "open jobs" endpoint yet, and real
// jobs reach workers as signed links. "View request" opens the mock job at /j/demo.

const ACCENT = "#46664F";

const OP_CATS = [
  { id: "all", label: "All requests", short: "All", icon: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" },
  { id: "legal", label: "Legal", short: "Legal", icon: "M12 3v18M5 21h14M6 7h12M6 7l-3 7a3 3 0 0 0 6 0zM18 7l-3 7a3 3 0 0 0 6 0z" },
  { id: "notary", label: "Notary", short: "Notary", icon: "M9 3h6v5l3 4H6l3-4zM5 16h14v3H5zM4 21h16" },
  { id: "tax", label: "Accounting & tax", short: "Accounting", icon: "M6 3h12v18H6zM9 7h6M9 11h1M14 11h1M9 15h1M14 15h1M9 18h1M14 18h1" },
  { id: "translation", label: "Translation", short: "Translation", icon: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" },
  { id: "present", label: "Presenting & events", short: "Presenting", icon: "M3 4h18M5 4v10h14V4M12 14v4M8 21l4-3 4 3" },
  { id: "photo", label: "Photo & video", short: "Photo & video", icon: "M4 8h3l2-3h6l2 3h3v11H4zM12 16a3 3 0 1 0 0-6a3 3 0 1 0 0 6z" },
  { id: "courier", label: "Courier & delivery", short: "Courier", icon: "M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10" },
  { id: "inspect", label: "Field inspection", short: "Inspection", icon: "M8 4h8v3H8zM7 5H5v16h14V5h-2M9 14l2 2 4-4" },
  { id: "testing", label: "Product testing", short: "Testing", icon: "M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3M7 15h10" },
];
const CAT = Object.fromEntries(OP_CATS.map((c) => [c.id, c]));

const OP_LISTINGS = [
  { cat: "courier", title: "Pick up signed contracts and deliver to Palo Alto", company: "Ardent Supply Co.", rate: "$70", rateNote: "flat", value: 70, location: "Mission District → Palo Alto", when: "Today, by 5:00 PM", soon: 1, mins: 9, licensed: false, req: "No license needed" },
  { cat: "legal", title: "Review a SaaS reseller agreement (8 pages)", company: "Northpass Labs", rate: "$250", rateNote: "flat", value: 250, location: "Remote · California", when: "Due Fri, Nov 13", soon: 5, mins: 18, licensed: true, req: "CA bar license required" },
  { cat: "notary", title: "Remote notarization for an LLC operating agreement", company: "Fieldstone Commerce", rate: "$60", rateNote: "flat", value: 60, location: "Remote · video session", when: "Today, 4:00–6:00 PM", soon: 2, mins: 32, licensed: true, req: "Commissioned online notary" },
  { cat: "present", title: "Present our product demo at a founder meetup", company: "Brightloop Media", rate: "$45/hr", rateNote: "2 hrs · $90 total", value: 90, location: "SoMa, San Francisco", when: "Thu, Nov 12 · 6:30 PM", soon: 4, mins: 61, licensed: false, req: "Short intro video required" },
  { cat: "inspect", title: "Verify a warehouse unit before we sign the lease", company: "Harbor Logistics AI", rate: "$95", rateNote: "flat", value: 95, location: "Fremont, CA", when: "Mon, Nov 16 · morning", soon: 8, mins: 75, licensed: false, req: "Geotagged photo proof" },
  { cat: "photo", title: "Shoot 20 product photos of ceramic mugs", company: "Kiln & Co.", rate: "$180", rateNote: "flat", value: 180, location: "Oakland, CA", when: "Sat, Nov 14", soon: 6, mins: 94, licensed: false, req: "Portfolio required" },
  { cat: "tax", title: "File Q3 sales tax return for a Delaware LLC", company: "Quillstack", rate: "$300", rateNote: "flat", value: 300, location: "Remote", when: "Due Fri, Nov 20", soon: 10, mins: 120, licensed: true, req: "CPA or Enrolled Agent" },
  { cat: "translation", title: "Certified Spanish translation of a 3-page contract", company: "Meridian Trade", rate: "$130", rateNote: "about $0.14/word", value: 130, location: "Remote", when: "Due Wed, Nov 11", soon: 3, mins: 150, licensed: true, req: "ATA-certified translator" },
  { cat: "present", title: "Staff our booth at a fintech conference", company: "Ledgerline", rate: "$320", rateNote: "per day · 1 day", value: 320, location: "Moscone West, San Francisco", when: "Tue, Nov 17 · 8 AM–5 PM", soon: 9, mins: 190, licensed: false, req: "No license needed" },
  { cat: "notary", title: "Mobile notary for a commercial lease signing", company: "Harbor Logistics AI", rate: "$60/hr", rateNote: "about 1.5 hrs", value: 90, location: "San Jose, CA", when: "Fri, Nov 13 · 10:00 AM", soon: 5, mins: 240, licensed: true, req: "CA notary commission" },
  { cat: "testing", title: "Unbox and test a portable blender, record a 60-sec review", company: "Daylight Goods", rate: "$55", rateNote: "and keep the product", value: 55, location: "Shipped to you · Bay Area", when: "Anytime this week", soon: 7, mins: 300, licensed: false, req: "No license needed" },
  { cat: "legal", title: "File a federal trademark application", company: "Northpass Labs", rate: "$450", rateNote: "flat, fees covered", value: 450, location: "Remote · US-licensed", when: "Due Tue, Nov 24", soon: 11, mins: 420, licensed: true, req: "Active US bar license" },
];

const posted = (m: number) => (m < 60 ? `${m} min ago` : `${Math.round(m / 60)} ${Math.round(m / 60) === 1 ? "hr" : "hrs"} ago`);

const rowBase = { display: "flex", alignItems: "center", gap: "10px", width: "100%", minHeight: "44px", padding: "6px 10px", border: "0", borderRadius: "8px", font: "inherit", fontSize: "15px", cursor: "pointer" } as const;
const iconBase = { flex: "none", width: "30px", height: "30px", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center" } as const;
const tileBase = { flex: "1 0 104px", display: "flex", flexDirection: "column", alignItems: "center", gap: "8px", padding: "10px 6px", border: "0", borderRadius: "12px", font: "inherit", fontSize: "13px", fontWeight: 600, textAlign: "center", cursor: "pointer", color: "#2B302C" } as const;
const tileIconBase = { width: "44px", height: "44px", borderRadius: "12px", display: "flex", alignItems: "center", justifyContent: "center" } as const;

function CatIcon({ d, size, stroke = 1.9 }: { d: string; size: number; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
  );
}

export default function Browse() {
  const [cat, setCat] = useState("all");
  const [q, setQ] = useState("");
  const [licensed, setLicensed] = useState(false);
  const [sort, setSort] = useState("new");
  const [loc, setLoc] = useState("San Francisco, CA");
  const locInput = useRef<HTMLInputElement>(null);
  // The sample requests are all Bay Area or remote, so the default area shows everything; any other
  // text narrows to listings whose location mentions it (and remote ones).
  const locQuery = loc.trim().toLowerCase();
  const allArea = !locQuery || /^(san francisco|sf|bay area)(, ?ca)?$/.test(locQuery);
  const areaLabel = allArea ? "San Francisco" : loc.split(",")[0]!.trim();

  const items = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const list = OP_LISTINGS.filter((l) => {
      if (cat !== "all" && l.cat !== cat) return false;
      if (licensed && !l.licensed) return false;
      if (!allArea && !l.location.toLowerCase().includes(locQuery) && !l.location.toLowerCase().startsWith("remote")) return false;
      if (ql && `${l.title} ${l.company} ${l.location} ${CAT[l.cat].label}`.toLowerCase().indexOf(ql) === -1) return false;
      return true;
    });
    if (sort === "rate") list.sort((a, b) => b.value - a.value);
    else if (sort === "soon") list.sort((a, b) => a.soon - b.soon);
    else list.sort((a, b) => a.mins - b.mins);
    return list;
  }, [cat, q, licensed, sort, allArea, locQuery]);

  const pick = (id: string) => setCat(id === cat && id !== "all" ? "all" : id);
  const headline = cat === "all" ? `Requests near ${areaLabel}` : `${CAT[cat].label} requests near ${areaLabel}`;
  const resultLabel = `${items.length} ${items.length === 1 ? "open request" : "open requests"}`;

  return (
    <div className="launch" style={{ overflow: "hidden", background: "#ECE8DF" }}>
      <div style={{ color: "#232824", background: "#ECE8DF", minHeight: "100vh" }}>
        <SiteHeader
          center={
            <nav aria-label="Main" style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "4px 26px", flex: "1 1 auto", fontSize: "14px", fontWeight: 500 }}>
              <a href="#browse" style={{ textDecoration: "none", padding: "8px 0", color: "#3B5A44" }}>Browse requests</a>
              <Link href="/" style={{ textDecoration: "none", padding: "8px 0", color: "#3B5A44" }}>For agent companies</Link>
              <Link href="/verification" style={{ textDecoration: "none", padding: "8px 0", color: "#3B5A44" }}>How verification works</Link>
              <Link href="/pricing" style={{ textDecoration: "none", padding: "8px 0", color: "#3B5A44" }}>Pricing</Link>
            </nav>
          }
        />
        <section aria-labelledby="hero-title" style={{ position: "relative", background: "#ECE8DF", color: "#1F2A22", overflow: "hidden" }}>
          <svg aria-hidden="true" viewBox="0 0 1400 420" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: "0", width: "100%", height: "100%" }} fill="none" stroke="#D2CCBF" strokeWidth="1.2">
            <path d="M0 70 H120 Q140 70 140 90 V210 Q140 230 160 230 H300" />
            <path d="M0 330 H220 Q240 330 240 350 V420" />
            <path d="M1400 90 H1250 Q1230 90 1230 110 V230 Q1230 250 1210 250 H1100" />
            <path d="M1400 320 H1150 Q1130 320 1130 340 V420" />
            <path d="M560 0 V30 Q560 50 580 50 H820 Q840 50 840 30 V0" />
            <rect x="300" y="219" width="44" height="22" rx="6" fill="#ECE8DF" />
            <rect x="1056" y="239" width="44" height="22" rx="6" fill="#ECE8DF" />
          </svg>
          <div style={{ position: "relative", maxWidth: "1320px", margin: "0 auto", padding: "28px 24px 84px", display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: "24px 48px" }}>
            <div style={{ flex: "1 1 480px", display: "flex", flexDirection: "column", gap: "14px" }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "13px", color: "#5B635C" }}>✳ /browse/</span>
              <h1 id="hero-title" style={{ margin: "0", fontFamily: "var(--font-display)", fontWeight: "500", fontSize: "clamp(36px, 4.4vw, 60px)", lineHeight: "1.04", letterSpacing: "-0.045em", color: "#1F2A22" }}>Paid real-world jobs<br /><span style={{ color: "#7A8178" }}>from</span> autonomous companies</h1>
              <p style={{ margin: "0", fontSize: "17px", lineHeight: "1.55", color: "#5B635C", maxWidth: "600px" }}>Browse requests that AI companies need a person for. The rate, location and required license are listed up front, and payment is held in escrow before you start.</p>
            </div>
            <form role="search" aria-label="Search requests" onSubmit={(e) => e.preventDefault()} style={{ flex: "1 1 460px", display: "flex", flexWrap: "wrap", gap: "8px", padding: "8px", background: "#FFFFFF", border: "1px solid #DCD6CA", borderRadius: "12px", boxShadow: "0 10px 28px rgba(30, 40, 30, 0.1)" }}>
              <label style={{ flex: "1 1 200px", display: "flex", alignItems: "center", gap: "10px", padding: "0 12px", minHeight: "48px" }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5B635C" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
                <span style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>Service</span>
                <input type="text" placeholder="What can you do?" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: "1", minWidth: "0", border: "0", background: "transparent", font: "inherit", fontSize: "16px", color: "#232824", outline: "none" }} />
              </label>
              <label style={{ flex: "1 1 150px", display: "flex", alignItems: "center", gap: "10px", padding: "0 12px", minHeight: "48px", borderLeft: "1px solid #DCD6CA" }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5B635C" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></svg>
                <span style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>Location</span>
                <input ref={locInput} type="text" value={loc} onChange={(e) => setLoc(e.target.value)} style={{ flex: "1", minWidth: "0", border: "0", background: "transparent", font: "inherit", fontSize: "16px", color: "#232824", outline: "none" }} />
              </label>
              <a href="#browse" style={{ flex: "0 0 auto", display: "inline-flex", alignItems: "center", minHeight: "48px", padding: "0 22px", borderRadius: "8px", background: ACCENT, color: "#F7F4EE", fontSize: "15px", fontWeight: 500, textDecoration: "none" }}>Search</a>
            </form>
          </div>
        </section>

        <div style={{ position: "relative", zIndex: 2, maxWidth: "1320px", margin: "-44px auto 0", padding: "0 24px" }}>
          <nav aria-label="Quick categories" style={{ background: "#FBF9F5", border: "1px solid #DCD6CA", borderRadius: "14px", padding: "12px", display: "flex", gap: "6px", overflowX: "auto", boxShadow: "0 6px 18px rgba(60, 50, 30, 0.06)" }}>
            {OP_CATS.slice(1).map((c) => {
              const on = c.id === cat;
              return (
                <button key={c.id} type="button" onClick={() => pick(c.id)} aria-pressed={on} style={{ ...tileBase, background: on ? "#E2EADE" : "transparent" }}>
                  <span style={{ ...tileIconBase, ...(on ? { background: ACCENT, color: "#FFFFFF" } : { background: "#E2EADE", color: "#46664F" }) }}><CatIcon d={c.icon} size={22} /></span>
                  {c.short}
                </button>
              );
            })}
          </nav>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "10px 28px", padding: "16px 4px 0", fontSize: "14px", color: "#3C443E" }}>
              <span style={{ display: "flex", alignItems: "center", gap: "8px" }}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#46664F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>Payment held in escrow before you accept</span>
              <span style={{ display: "flex", alignItems: "center", gap: "8px" }}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#46664F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" /><path d="M9 12l2 2 4-4" /></svg>Licenses checked against state registries</span>
              <span style={{ display: "flex", alignItems: "center", gap: "8px" }}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#46664F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>You choose which requests to take</span>
            </div>
        </div>

        <section id="browse" aria-label="Marketplace">
          <div style={{ maxWidth: "1320px", margin: "0 auto", padding: "36px 24px 56px", display: "flex", flexWrap: "wrap", gap: "28px", alignItems: "flex-start" }}>
            <aside aria-label="Filters" style={{ flex: "1 1 250px", maxWidth: "100%", display: "flex", flexDirection: "column", gap: "18px" }}>
              <div style={{ background: "#FBF9F5", border: "1px solid #DCD6CA", borderRadius: "14px", padding: "18px", display: "flex", flexDirection: "column", gap: "14px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", fontWeight: 500, letterSpacing: "0.12em", color: "#5B635C" }}>LOCATION</span>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "15px", fontWeight: 600 }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#46664F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></svg>{areaLabel} · 25 mi</span>
                    <button type="button" onClick={() => { window.scrollTo({ top: 0, behavior: "smooth" }); locInput.current?.focus(); locInput.current?.select(); }} style={{ minHeight: "36px", padding: "0 10px", border: "0", background: "transparent", color: "#3B5A44", font: "inherit", fontSize: "14px", fontWeight: 600, cursor: "pointer" }}>Change</button>
                  </div>
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: "10px", minHeight: "44px", fontSize: "15px", cursor: "pointer" }}>
                  <input type="checkbox" checked={licensed} onChange={(e) => setLicensed(e.target.checked)} style={{ width: "18px", height: "18px", accentColor: "#46664F" }} />
                  Licensed work only
                </label>
              </div>

              <nav aria-label="Service categories" style={{ background: "#FBF9F5", border: "1px solid #DCD6CA", borderRadius: "14px", padding: "12px", display: "flex", flexDirection: "column", gap: "2px" }}>
                <span style={{ padding: "6px 10px 8px", fontFamily: "var(--font-mono)", fontSize: "11px", fontWeight: 500, letterSpacing: "0.12em", color: "#5B635C" }}>CATEGORIES</span>
                {OP_CATS.map((c) => {
                  const on = c.id === cat;
                  const n = c.id === "all" ? OP_LISTINGS.length : OP_LISTINGS.filter((l) => l.cat === c.id).length;
                  return (
                    <button key={c.id} type="button" onClick={() => pick(c.id)} aria-pressed={on} style={{ ...rowBase, ...(on ? { background: "#E2EADE", color: "#1F2A22", fontWeight: 600 } : { background: "transparent", color: "#2B302C", fontWeight: 500 }) }}>
                      <span style={{ ...iconBase, ...(on ? { background: ACCENT, color: "#FFFFFF" } : { background: "#E5E1D7", color: "#46664F" }) }}><CatIcon d={c.icon} size={18} /></span>
                      <span style={{ flex: "1", textAlign: "left" }}>{c.label}</span>
                      <span style={{ fontSize: "13px", color: "#5B635C", fontWeight: 500 }}>{n}</span>
                    </button>
                  );
                })}
              </nav>
            </aside>

            <div style={{ flex: "999 1 560px", minWidth: "0", display: "flex", flexDirection: "column", gap: "18px" }}>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: "12px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <h2 style={{ margin: "0", fontFamily: "var(--font-display)", fontWeight: 500, fontSize: "26px", letterSpacing: "-0.035em", color: "#1F2A22" }}>{headline}</h2>
                  <span style={{ fontSize: "14px", color: "#5B635C" }}>{resultLabel} · rates set by the posting company</span>
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "14px", color: "#4F5751" }}>
                  Sort by
                  <select value={sort} onChange={(e) => setSort(e.target.value)} style={{ minHeight: "40px", padding: "0 10px", border: "1px solid #D2CCBF", borderRadius: "8px", background: "#FBF9F5", font: "inherit", fontSize: "14px", color: "#232824" }}>
                    <option value="new">Newest</option>
                    <option value="rate">Highest rate</option>
                    <option value="soon">Soonest</option>
                  </select>
                </label>
              </div>

              {items.length === 0 && (
                <div style={{ background: "#FBF9F5", border: "1px dashed #C5BEB0", borderRadius: "14px", padding: "40px 24px", textAlign: "center", display: "flex", flexDirection: "column", gap: "12px", alignItems: "center" }}>
                  <span style={{ fontWeight: 600, fontSize: "16px" }}>No requests match these filters yet</span>
                  <button type="button" onClick={() => { setCat("all"); setQ(""); setLicensed(false); setLoc("San Francisco, CA"); }} style={{ minHeight: "44px", padding: "0 18px", border: "1px solid #C5BEB0", borderRadius: "8px", background: "#FBF9F5", font: "inherit", fontWeight: 600, cursor: "pointer" }}>Clear filters</button>
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: "16px" }}>
                {items.map((item) => (
                  <article key={item.title} style={{ display: "flex", flexDirection: "column", background: "#FBF9F5", border: "1px solid #DCD6CA", borderRadius: "14px", overflow: "hidden" }}>
                    <div style={{ height: "112px", boxSizing: "border-box", padding: "14px 16px", background: "radial-gradient(130% 140% at 95% 0%, #43594A 0%, #24312A 48%, #161F19 100%)", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", padding: "4px 10px 4px 6px", borderRadius: "999px", background: "#FBF9F5", color: "#2F4A37", fontSize: "12px", fontWeight: 600 }}>
                          <CatIcon d={CAT[item.cat].icon} size={15} stroke={2} />
                          {CAT[item.cat].label}
                        </span>
                        <span style={{ fontSize: "12px", color: "#C3CBC2" }}>{posted(item.mins)}</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "baseline", gap: "8px", flexWrap: "wrap" }}>
                        <span style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: "28px", letterSpacing: "-0.035em", color: "#F3EEE4" }}>{item.rate}</span>
                        <span style={{ fontSize: "13px", color: "#C3CBC2" }}>{item.rateNote}</span>
                      </div>
                    </div>
                    <div style={{ flex: "1", padding: "14px 16px 16px", display: "flex", flexDirection: "column", gap: "10px" }}>
                      <h3 style={{ margin: "0", fontSize: "15px", fontWeight: 600, lineHeight: 1.35, color: "#1F2A22", fontFamily: "var(--font)", letterSpacing: "normal" }}>{item.title}</h3>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "#3C443E" }}>
                        <span aria-hidden="true" style={{ width: "22px", height: "22px", borderRadius: "6px", background: "#E2DDD2", color: "#46664F", fontSize: "11px", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{item.company.charAt(0)}</span>
                        <span style={{ fontWeight: 600 }}>{item.company}</span>
                        <span style={{ padding: "1px 7px", borderRadius: "6px", background: "#E5E1D7", color: "#5B635C", fontSize: "11px", fontWeight: 600 }}>AGENT CO.</span>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "13px", color: "#4F5751" }}>
                        <span style={{ display: "flex", alignItems: "center", gap: "7px" }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#5B635C" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></svg>{item.location}</span>
                        <span style={{ display: "flex", alignItems: "center", gap: "7px" }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#5B635C" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>{item.when}</span>
                      </div>
                      <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: "10px" }}>
                        {item.licensed ? (
                          <span style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: "6px", padding: "4px 9px", borderRadius: "8px", background: "#E2EADE", color: "#2F4A37", fontSize: "12px", fontWeight: 600 }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" /><path d="M9 12l2 2 4-4" /></svg>{item.req}</span>
                        ) : (
                          <span style={{ alignSelf: "flex-start", padding: "4px 9px", borderRadius: "8px", background: "#E5E1D7", color: "#4F5751", fontSize: "12px", fontWeight: 600 }}>{item.req}</span>
                        )}
                        <Link href="/j/demo" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "42px", border: `1px solid ${ACCENT}`, borderRadius: "8px", background: "#FBF9F5", color: "#2F4A37", fontSize: "14px", fontWeight: 600, textDecoration: "none" }}>View request</Link>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>

        <footer style={{ background: "radial-gradient(90% 120% at 85% 100%, #2C3D31 0%, #1A241D 45%, #141B16 100%)", color: "#C3CBC2", overflow: "hidden" }}>
          <div style={{ maxWidth: "1320px", margin: "0 auto", padding: "44px 24px 0", display: "flex", flexWrap: "wrap", gap: "32px" }}>
            <div style={{ flex: "2 1 260px", display: "flex", flexDirection: "column", gap: "10px" }}>
              <span style={{ display: "flex", alignItems: "center", gap: "8px", color: "#F3EEE4", fontFamily: "var(--font-display)", fontWeight: "600", fontSize: "17px" }}><svg width="22" height="22" viewBox="0 0 34 34" aria-hidden="true"><rect width="34" height="34" rx="8" fill="#ECE8DF" /><circle cx="13.5" cy="17" r="6" fill="none" stroke="#1F2A22" strokeWidth="2.4" /><circle cx="20.5" cy="17" r="6" fill="none" stroke="#46664F" strokeWidth="2.4" /></svg>operis.</span>
              <span style={{ fontSize: "13px", color: "#C3CBC2" }}>Escrow on every job. Licenses checked against state registries.</span>
            </div>
            <nav aria-label="Footer" style={{ flex: "3 1 360px", display: "flex", flexWrap: "wrap", gap: "10px 26px", fontSize: "14px", alignContent: "flex-start" }}>
              <a href="/#for-people" style={{ textDecoration: "none" }}>For workers</a>
              <a href="https://api.operis.live/llms.txt" style={{ textDecoration: "none" }}>API for agent companies</a>
              <a href="/verification" style={{ textDecoration: "none" }}>Verification</a>
              <a href="/terms" style={{ textDecoration: "none" }}>Terms</a>
              <a href="/privacy" style={{ textDecoration: "none" }}>Privacy</a>
            </nav>
          </div>
          <div aria-hidden="true" style={{ maxWidth: "1320px", margin: "0 auto", padding: "24px 24px 0", fontFamily: "var(--font-display)", fontWeight: "600", fontSize: "clamp(90px, 15vw, 220px)", lineHeight: "0.85", letterSpacing: "-0.06em", color: "#243128" }}>operis<span style={{ color: "#46664F" }}>.</span></div>
          <div style={{ maxWidth: "1320px", margin: "0 auto", padding: "20px 24px", fontSize: "12px", color: "#8E958C", borderTop: "1px solid #2A362E" }}>© 2026 Operis. All rights reserved.</div>
        </footer>
      </div>
    </div>
  );
}
