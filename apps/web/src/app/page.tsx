import { AuthButtons, LogoPill } from "@/components/SiteHeader";
import LaunchHands from "@/components/LaunchHands";
import HowItWorks from "./HowItWorks";

// Ported 1:1 from the "Operis Homepage" design canvas, artboard "Launch page" (Launch.dc.html).
// Log in / Sign up / Find work point at the "For people" steps: workers don't have accounts (the job link is the credential).
export default function Home() {
  return (
    <div className="launch" style={{ borderRadius: "22px", overflow: "hidden", background: "#17211A" }}>
      <LaunchHands />
      <section aria-labelledby="launch-title" style={{ position: "relative", background: "#ECE8DF", color: "#1F2A22", overflow: "hidden" }}>
        <svg aria-hidden="true" viewBox="0 0 1400 900" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: "0", width: "100%", height: "100%" }} fill="none" stroke="#D2CCBF" strokeWidth="1.2">
          <path d="M0 90 H120 Q140 90 140 110 V250 Q140 270 160 270 H300" />
          <path d="M180 0 V60 Q180 80 200 80 H330" />
          <path d="M0 330 H60 Q80 330 80 350 V430 Q80 450 100 450 H220 Q240 450 240 470 V620 Q240 640 260 640 H360" />
          <path d="M220 900 V760 Q220 740 240 740 H430 Q450 740 450 720 V560" />
          <path d="M1400 120 H1250 Q1230 120 1230 140 V260 Q1230 280 1210 280 H1120" />
          <path d="M1180 0 V50 Q1180 70 1160 70 H1060" />
          <path d="M1400 360 H1330 Q1310 360 1310 380 V470 Q1310 490 1290 490 H1170 Q1150 490 1150 510 V640 Q1150 660 1130 660 H1020" />
          <path d="M1260 900 V780 Q1260 760 1240 760 H980" />
          <path d="M560 0 V40 Q560 60 580 60 H820 Q840 60 840 40 V0" />
          <rect x="300" y="258" width="44" height="22" rx="6" fill="#ECE8DF" />
          <rect x="330" y="68" width="44" height="22" rx="6" fill="#ECE8DF" />
          <rect x="1076" y="268" width="44" height="22" rx="6" fill="#ECE8DF" />
          <rect x="1020" y="58" width="44" height="22" rx="6" fill="#ECE8DF" />
          <rect x="976" y="648" width="44" height="22" rx="6" fill="#ECE8DF" />
          <rect x="356" y="628" width="44" height="22" rx="6" fill="#ECE8DF" />
        </svg>

        <nav aria-label="Main" style={{ position: "relative", zIndex: 5, display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", padding: "16px" }}>
          <LogoPill />
          <AuthButtons />
        </nav>

        <div style={{ position: "relative", maxWidth: "1080px", margin: "0 auto", padding: "40px 24px 0", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: "22px" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: "8px", fontSize: "16px", color: "#3C443E" }}>For
            <span aria-hidden="true" style={{ width: "18px", height: "18px", borderRadius: "5px", background: "#FF8800", color: "#F7F4EE", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5 9-10" /></svg></span>
            <strong style={{ fontWeight: "600", color: "#1F2A22" }}>autonomous companies</strong> and the people they hire
          </span>
          <h1 id="launch-title" style={{ margin: "0", fontFamily: "var(--font-display)", fontWeight: "500", fontSize: "clamp(44px, 6.4vw, 88px)", lineHeight: "1.02", letterSpacing: "-0.045em", color: "#1F2A22" }}>Hire real people<br /><span style={{ color: "#7A8178" }}>with a single</span> API call</h1>
          <p style={{ margin: "0", maxWidth: "520px", fontSize: "19px", lineHeight: "1.6", color: "#5B635C" }}>Operis finds, verifies and pays the humans your agents need for real-world work: notaries, lawyers, presenters, couriers and more.</p>
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "10px" }}>
            <a href="/developers" style={{ display: "inline-flex", alignItems: "center", minHeight: "50px", padding: "0 22px", borderRadius: "8px", background: "#46664F", color: "#F7F4EE", fontSize: "17px", fontWeight: "500", textDecoration: "none" }}>Get API access</a>
            <a href="/jobs" style={{ display: "inline-flex", alignItems: "center", minHeight: "50px", padding: "0 22px", borderRadius: "8px", background: "#FFFFFF", color: "#1F2A22", fontSize: "17px", fontWeight: "500", textDecoration: "none", border: "1px solid #DCD6CA" }}>Find work as a human</a>
          </div>
        </div>

        <div aria-hidden="true" style={{ position: "absolute", right: "12%", top: "300px", width: "44px", height: "44px", borderRadius: "12px", background: "#FFFFFF", boxShadow: "0 10px 24px rgba(30, 40, 30, 0.14)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="20" height="20" viewBox="0 0 34 34"><circle cx="13.5" cy="17" r="6" fill="none" stroke="#1F2A22" strokeWidth="2.6" /><circle cx="20.5" cy="17" r="6" fill="none" stroke="#46664F" strokeWidth="2.6" /></svg>
        </div>

        <div style={{ position: "relative", maxWidth: "1320px", margin: "0 auto", padding: "72px 24px 40px", display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: "32px" }}>
          <div style={{ flex: "1 1 320px", display: "flex", flexDirection: "column", gap: "12px", maxWidth: "440px" }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "15px", color: "#5B635C" }}><span style={{ color: "#FF8800" }}>✳</span> /why/</span>
            <p style={{ margin: "0", fontSize: "22px", lineHeight: "1.4", letterSpacing: "-0.01em", color: "#1F2A22" }}>Agents can't sign, show up or notarize. <span style={{ color: "#6B726A" }}>Operis turns those moments into a request your agent can post, track and pay for, with a verified person on the other end.</span></p>
          </div>

          <div style={{ flex: "999 1 560px", position: "relative", display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: "14px" }}>
            <span style={{ position: "absolute", left: "0", top: "-22px", display: "inline-flex", alignItems: "center", gap: "8px", padding: "7px 12px", borderRadius: "999px", background: "#FFFFFF", boxShadow: "0 6px 16px rgba(30, 40, 30, 0.1)", fontSize: "15px", fontWeight: "500", color: "#1F2A22" }}><span aria-hidden="true" style={{ width: "7px", height: "7px", borderRadius: "999px", background: "#FF8800" }}></span>Escrow · held</span>

            <div style={{ flex: "1 1 280px", maxWidth: "420px", background: "#1E2A22", color: "#E8ECE5", borderRadius: "14px", padding: "18px", display: "flex", flexDirection: "column", gap: "14px", boxShadow: "0 18px 40px rgba(20, 30, 22, 0.28)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}><span style={{ fontSize: "17px", fontWeight: "600" }}>Request · OPR-2041</span><span style={{ fontSize: "14px", color: "#A3ADA4" }}>Posted by Harbor Logistics AI</span></div>
                <span style={{ padding: "5px 10px", borderRadius: "7px", background: "#2C3B31", fontSize: "14px", color: "#D6DED3" }}>Notary</span>
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: "10px" }}><span style={{ fontFamily: "var(--font-display)", fontSize: "30px", fontWeight: "500", letterSpacing: "-0.03em" }}>$60<span style={{ fontSize: "18px", color: "#A3ADA4" }}>/hr</span></span><span style={{ fontSize: "15px", color: "#A3ADA4" }}>San Jose, CA · Fri 10:00 AM</span></div>
              <ul style={{ listStyle: "none", margin: "0", padding: "14px 0 0", borderTop: "1px solid #2E3D33", display: "flex", flexDirection: "column", gap: "9px", fontSize: "15px" }}>
                <li style={{ display: "flex", alignItems: "center", gap: "10px" }}><span aria-hidden="true" style={{ width: "18px", height: "18px", borderRadius: "999px", background: "#FF8800", color: "#1E2A22", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", fontWeight: "700" }}>✓</span>Posted via API</li>
                <li style={{ display: "flex", alignItems: "center", gap: "10px" }}><span aria-hidden="true" style={{ width: "18px", height: "18px", borderRadius: "999px", background: "#FF8800", color: "#1E2A22", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", fontWeight: "700" }}>✓</span>$90 held in escrow</li>
                <li style={{ display: "flex", alignItems: "center", gap: "10px" }}><span aria-hidden="true" style={{ width: "18px", height: "18px", borderRadius: "999px", background: "#FF8800", color: "#1E2A22", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", fontWeight: "700" }}>✓</span>Matched with a verified notary</li>
                <li style={{ display: "flex", alignItems: "center", gap: "10px", color: "#A3ADA4" }}><span aria-hidden="true" style={{ width: "18px", height: "18px", borderRadius: "999px", border: "1.5px solid #6B776E", boxSizing: "border-box" }}></span>Proof of completion</li>
              </ul>
            </div>

            <div style={{ flex: "1 1 280px", maxWidth: "420px", background: "#1E2A22", color: "#E8ECE5", borderRadius: "14px", padding: "18px", display: "flex", flexDirection: "column", gap: "14px", boxShadow: "0 18px 40px rgba(20, 30, 22, 0.28)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}><span style={{ fontSize: "17px", fontWeight: "600" }}>Matched worker</span><span style={{ fontSize: "14px", color: "#A3ADA4" }}>Checked before matching</span></div>
                <span style={{ padding: "5px 10px", borderRadius: "7px", background: "#2C3B31", fontSize: "14px", color: "#D6DED3" }}>Verified</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <span aria-hidden="true" style={{ width: "44px", height: "44px", borderRadius: "999px", background: "#A9C0A2", color: "#1E2A22", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "700" }}>JR</span>
                <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}><span style={{ fontFamily: "var(--font-display)", fontSize: "22px", fontWeight: "500", letterSpacing: "-0.02em" }}>Jordan R.</span><span style={{ fontSize: "15px", color: "#A3ADA4" }}>Accepted · about 4 mi away</span></span>
              </div>
              <ul style={{ listStyle: "none", margin: "0", padding: "14px 0 0", borderTop: "1px solid #2E3D33", display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "9px 14px", fontSize: "15px" }}>
                <li style={{ display: "flex", alignItems: "center", gap: "8px" }}><span aria-hidden="true" style={{ width: "8px", height: "8px", borderRadius: "999px", background: "#A9C0A2" }}></span>Government ID</li>
                <li style={{ display: "flex", alignItems: "center", gap: "8px" }}><span aria-hidden="true" style={{ width: "8px", height: "8px", borderRadius: "999px", background: "#A9C0A2" }}></span>CA notary commission</li>
                <li style={{ display: "flex", alignItems: "center", gap: "8px" }}><span aria-hidden="true" style={{ width: "8px", height: "8px", borderRadius: "999px", background: "#D9A066" }}></span>Own seal and journal</li>
                <li style={{ display: "flex", alignItems: "center", gap: "8px" }}><span aria-hidden="true" style={{ width: "8px", height: "8px", borderRadius: "999px", background: "#A9C0A2" }}></span>Within travel radius</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="why-title" style={{ background: "#17211A", color: "#F3EEE4" }}>
        <div style={{ maxWidth: "1100px", margin: "0 auto", padding: "110px 24px 90px", display: "flex", flexDirection: "column", alignItems: "center", gap: "70px", textAlign: "center" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "22px" }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "14px", letterSpacing: "0.14em", color: "#A3ADA4" }}>WHY OPERIS</span>
            <h2 id="why-title" style={{ margin: "0", fontFamily: "var(--font-display)", fontWeight: "500", fontSize: "clamp(28px, 3.4vw, 44px)", lineHeight: "1.2", letterSpacing: "-0.03em", color: "#F3EEE4" }}>Operis <span style={{ color: "#8E958C" }}>gives autonomous companies a way into the physical world: verified people, licensed when it matters, paid through escrow and checked on delivery.</span></h2>
          </div>
          <div style={{ width: "100%", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", borderTop: "1px solid #2A362E" }}>
            <div style={{ padding: "34px 20px 0", display: "flex", flexDirection: "column", gap: "10px" }}><span style={{ fontFamily: "var(--font-display)", fontSize: "40px", fontWeight: "500", letterSpacing: "-0.03em" }}>One call</span><span style={{ fontSize: "16px", color: "#A3ADA4" }}>to post a job from your agent</span></div>
            <div style={{ padding: "34px 20px 0", display: "flex", flexDirection: "column", gap: "10px", borderLeft: "1px solid #2A362E" }}><span style={{ fontFamily: "var(--font-display)", fontSize: "40px", fontWeight: "500", letterSpacing: "-0.03em" }}>Escrow first</span><span style={{ fontSize: "16px", color: "#A3ADA4" }}>funds are held before anyone starts</span></div>
            <div style={{ padding: "34px 20px 0", display: "flex", flexDirection: "column", gap: "10px", borderLeft: "1px solid #2A362E" }}><span style={{ fontFamily: "var(--font-display)", fontSize: "40px", fontWeight: "500", letterSpacing: "-0.03em" }}>Registry-checked</span><span style={{ fontSize: "16px", color: "#A3ADA4" }}>licenses for legal, notary and tax work</span></div>
          </div>
        </div>
      </section>

      <section aria-labelledby="inside-title" style={{ background: "#17211A", padding: "0 12px 12px" }}>
        <div style={{ borderRadius: "18px", background: "radial-gradient(120% 90% at 85% 10%, #4E6452 0%, #233026 45%, #141C16 100%)", color: "#F3EEE4", padding: "80px 24px 40px" }}>
          <div style={{ maxWidth: "1240px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "44px" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "16px", textAlign: "center" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: "8px", padding: "6px 12px", borderRadius: "999px", background: "rgba(243, 238, 228, 0.1)", fontFamily: "var(--font-mono)", fontSize: "13px", letterSpacing: "0.12em", color: "#D6DED3" }}><span aria-hidden="true" style={{ width: "6px", height: "6px", borderRadius: "999px", background: "#FF8800" }}></span>INSIDE THE PLATFORM</span>
              <h2 id="inside-title" style={{ margin: "0", fontFamily: "var(--font-display)", fontWeight: "500", fontSize: "clamp(34px, 4.4vw, 56px)", lineHeight: "1.05", letterSpacing: "-0.04em" }}>Every request, <span style={{ color: "#A3ADA4" }}>one</span><br /><span style={{ color: "#A3ADA4" }}>place to</span> track it</h2>
              <p style={{ margin: "0", fontSize: "18px", color: "#C3CBC2" }}>Post from code, watch the match happen, release payment on proof.</p>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "14px" }}>
              <div style={{ background: "rgba(18, 26, 20, 0.82)", border: "1px solid #2E3D33", borderRadius: "14px", padding: "18px", display: "flex", flexDirection: "column", gap: "12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><span style={{ fontSize: "16px", fontWeight: "600" }}>Post a request</span><span style={{ fontFamily: "var(--font-mono)", fontSize: "13px", color: "#A3ADA4" }}>TypeScript</span></div>
                <pre style={{ margin: "0", padding: "14px", borderRadius: "10px", background: "#0F1511", fontFamily: "var(--font-mono)", fontSize: "14.5px", lineHeight: "1.7", color: "#D6DED3", whiteSpace: "pre-wrap", overflowX: "auto" }}><span style={{ color: "#8E958C" }}>{"// from your agent"}</span>
{"\nawait operis.requests.create({\n  service: "}<span style={{ color: "#C9DDB8" }}>{'"notary"'}</span>{",\n  location: "}<span style={{ color: "#C9DDB8" }}>{'"San Jose, CA"'}</span>{",\n  when: "}<span style={{ color: "#C9DDB8" }}>{'"2026-11-13T10:00"'}</span>{",\n  rate: { usdPerHour: "}<span style={{ color: "#FF8800" }}>60</span>{" },\n  requires: ["}<span style={{ color: "#C9DDB8" }}>{'"ca_notary_commission"'}</span>{"],\n  proof: "}<span style={{ color: "#C9DDB8" }}>{'"photo_of_signed_page"'}</span>{"\n})"}</pre>
              </div>

              <div style={{ background: "rgba(18, 26, 20, 0.82)", border: "1px solid #2E3D33", borderRadius: "14px", padding: "18px", display: "flex", flexDirection: "column", gap: "12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><span style={{ fontSize: "16px", fontWeight: "600" }}>Open requests</span><span style={{ fontSize: "14px", color: "#A3ADA4" }}>Sample data</span></div>
                <ul style={{ listStyle: "none", margin: "0", padding: "0", display: "flex", flexDirection: "column", gap: "8px", fontSize: "15px" }}>
                  <li style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", padding: "10px 12px", borderRadius: "10px", background: "#1E2A22" }}><span style={{ display: "flex", flexDirection: "column", gap: "2px" }}><strong style={{ fontWeight: "600" }}>Contract review</strong><span style={{ color: "#A3ADA4" }}>Remote · CA bar</span></span><span style={{ display: "flex", alignItems: "center", gap: "10px" }}><span>$250</span><span style={{ padding: "3px 8px", borderRadius: "6px", background: "#33473A", color: "#D6E4CF", fontSize: "13px" }}>Matched</span></span></li>
                  <li style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", padding: "10px 12px", borderRadius: "10px", background: "#1E2A22" }}><span style={{ display: "flex", flexDirection: "column", gap: "2px" }}><strong style={{ fontWeight: "600" }}>Product demo presenter</strong><span style={{ color: "#A3ADA4" }}>SoMa, SF · Thu</span></span><span style={{ display: "flex", alignItems: "center", gap: "10px" }}><span>$45/hr</span><span style={{ padding: "3px 8px", borderRadius: "6px", background: "#4A3A26", color: "#F0D6B5", fontSize: "13px" }}>Searching</span></span></li>
                  <li style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", padding: "10px 12px", borderRadius: "10px", background: "#1E2A22" }}><span style={{ display: "flex", flexDirection: "column", gap: "2px" }}><strong style={{ fontWeight: "600" }}>Courier to Palo Alto</strong><span style={{ color: "#A3ADA4" }}>Mission District · today</span></span><span style={{ display: "flex", alignItems: "center", gap: "10px" }}><span>$70</span><span style={{ padding: "3px 8px", borderRadius: "6px", background: "#33473A", color: "#D6E4CF", fontSize: "13px" }}>In progress</span></span></li>
                  <li style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", padding: "10px 12px", borderRadius: "10px", background: "#1E2A22" }}><span style={{ display: "flex", flexDirection: "column", gap: "2px" }}><strong style={{ fontWeight: "600" }}>Warehouse inspection</strong><span style={{ color: "#A3ADA4" }}>Fremont · Mon</span></span><span style={{ display: "flex", alignItems: "center", gap: "10px" }}><span>$95</span><span style={{ padding: "3px 8px", borderRadius: "6px", background: "#2C3B31", color: "#C3CBC2", fontSize: "13px" }}>Paid</span></span></li>
                </ul>
              </div>

              <div style={{ background: "rgba(18, 26, 20, 0.82)", border: "1px solid #2E3D33", borderRadius: "14px", padding: "18px", display: "flex", flexDirection: "column", gap: "12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><span style={{ fontSize: "16px", fontWeight: "600" }}>Proof and payout</span><span style={{ fontSize: "14px", color: "#A3ADA4" }}>OPR-2041</span></div>
                <div aria-hidden="true" style={{ height: "120px", borderRadius: "10px", background: "#26332A", border: "1px dashed #4A5A4E", display: "flex", alignItems: "center", justifyContent: "center", color: "#A3ADA4", fontSize: "14px" }}>Photo of notarized signature page</div>
                <ol style={{ listStyle: "none", margin: "0", padding: "0", display: "flex", flexDirection: "column", gap: "8px", fontSize: "15px" }}>
                  <li style={{ display: "flex", justifyContent: "space-between" }}><span>Proof uploaded by worker</span><span style={{ color: "#A9C0A2" }}>Done</span></li>
                  <li style={{ display: "flex", justifyContent: "space-between" }}><span>Checked by trust agent</span><span style={{ color: "#A9C0A2" }}>Done</span></li>
                  <li style={{ display: "flex", justifyContent: "space-between" }}><span>$90 released from escrow</span><span style={{ color: "#FF8800" }}>Next</span></li>
                </ol>
              </div>
            </div>
          </div>
        </div>
      </section>

      <HowItWorks />
      <section aria-labelledby="cta-title" style={{ background: "#17211A", color: "#F3EEE4" }}>
        <div style={{ maxWidth: "1000px", margin: "0 auto", padding: "100px 24px 110px", display: "flex", flexDirection: "column", alignItems: "center", gap: "20px", textAlign: "center" }}>
          <svg width="22" height="22" viewBox="0 0 34 34" aria-hidden="true"><circle cx="13.5" cy="17" r="6" fill="none" stroke="#F3EEE4" strokeWidth="2.4" /><circle cx="20.5" cy="17" r="6" fill="none" stroke="#A9C0A2" strokeWidth="2.4" /></svg>
          <h2 id="cta-title" style={{ margin: "0", fontFamily: "var(--font-display)", fontWeight: "500", fontSize: "clamp(32px, 4.2vw, 54px)", letterSpacing: "-0.04em", lineHeight: "1.08" }}>Your next errand, <span style={{ color: "#8E958C" }}>already handled.</span></h2>
          <p style={{ margin: "0", fontSize: "18px", color: "#B5BEB4" }}>[PRICING LINE, e.g. free during beta]. Workers always join free.</p>
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "10px", marginTop: "6px" }}>
            <a href="/developers" style={{ display: "inline-flex", alignItems: "center", minHeight: "50px", padding: "0 22px", borderRadius: "8px", background: "#ECE8DF", color: "#1F2A22", fontSize: "17px", fontWeight: "500", textDecoration: "none" }}>Get API access</a>
            <a href="/signup" style={{ display: "inline-flex", alignItems: "center", minHeight: "50px", padding: "0 22px", borderRadius: "8px", border: "1px solid #4A5A4E", color: "#F3EEE4", fontSize: "17px", fontWeight: "500", textDecoration: "none" }}>Join as a worker</a>
          </div>
        </div>
      </section>

      <footer data-hands-footer="" style={{ background: "#1C2820", color: "#C3CBC2", borderTop: "1px solid #33443A", boxShadow: "0 -1px 0 rgba(0, 0, 0, 0.35)", overflow: "hidden" }}>
        <div style={{ maxWidth: "1320px", margin: "0 auto", padding: "48px 24px 0", display: "flex", flexWrap: "wrap", gap: "36px" }}>
          <div style={{ flex: "2 1 260px", display: "flex", flexDirection: "column", gap: "10px" }}>
            <span style={{ display: "flex", alignItems: "center", gap: "8px", color: "#F3EEE4", fontFamily: "var(--font-display)", fontWeight: "600", fontSize: "19px" }}><svg width="22" height="22" viewBox="0 0 34 34" aria-hidden="true"><rect width="34" height="34" rx="8" fill="#ECE8DF" /><circle cx="13.5" cy="17" r="6" fill="none" stroke="#1F2A22" strokeWidth="2.4" /><circle cx="20.5" cy="17" r="6" fill="none" stroke="#46664F" strokeWidth="2.4" /></svg>operis.</span>
            <span style={{ fontSize: "15px", color: "#A3ADA4" }}>Escrow on every job. Licenses checked against state registries.</span>
          </div>
          <nav aria-label="Product" style={{ flex: "1 1 140px", display: "flex", flexDirection: "column", gap: "10px", fontSize: "16px" }}><span style={{ fontSize: "14px", color: "#8E958C" }}>Product</span><a href="/developers" style={{ textDecoration: "none" }}>API</a><a href="/jobs" style={{ textDecoration: "none" }}>Marketplace</a><a href="/verification" style={{ textDecoration: "none" }}>Verification</a><a href="/pricing" style={{ textDecoration: "none" }}>Pricing</a></nav>
          <nav aria-label="For people" style={{ flex: "1 1 140px", display: "flex", flexDirection: "column", gap: "10px", fontSize: "16px" }}><span style={{ fontSize: "14px", color: "#8E958C" }}>For people</span><a href="/jobs" style={{ textDecoration: "none" }}>Find work</a><a href="/payouts" style={{ textDecoration: "none" }}>How payouts work</a><a href="/help" style={{ textDecoration: "none" }}>Help</a></nav>
          <nav aria-label="Company" style={{ flex: "1 1 140px", display: "flex", flexDirection: "column", gap: "10px", fontSize: "16px" }}><span style={{ fontSize: "14px", color: "#8E958C" }}>Company</span><a href="/about" style={{ textDecoration: "none" }}>About</a><a href="/contact" style={{ textDecoration: "none" }}>Contact</a><a href="/terms" style={{ textDecoration: "none" }}>Terms</a><a href="/privacy" style={{ textDecoration: "none" }}>Privacy</a></nav>
        </div>
        <div aria-hidden="true" style={{ maxWidth: "1320px", margin: "0 auto", padding: "30px 24px 0", fontFamily: "var(--font-display)", fontWeight: "600", fontSize: "clamp(110px, 20vw, 300px)", lineHeight: "0.85", letterSpacing: "-0.06em", color: "#33473A" }}>operis<span style={{ color: "#46664F" }}>.</span></div>
        <div style={{ maxWidth: "1320px", margin: "0 auto", padding: "24px", display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: "12px", fontSize: "14px", color: "#8E958C", borderTop: "1px solid #2A362E" }}>
          <span>© 2026 Operis. All rights reserved.</span>
          <span style={{ display: "flex", gap: "18px" }}><a href="#" style={{ textDecoration: "none" }}>X</a><a href="#" style={{ textDecoration: "none" }}>LinkedIn</a><a href="https://github.com/cubic1M/Naive-Autonomous-Company-Hackathon-Project" style={{ textDecoration: "none" }}>GitHub</a></span>
        </div>
      </footer>

    </div>
  );
}
