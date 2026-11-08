import type { Metadata } from "next";

import { Card, InfoPage, P, UL } from "@/components/InfoPage";

export const metadata: Metadata = { title: "Terms of Service · Operis" };

export default function Page() {
  return (
    <InfoPage eyebrow="terms" title="Terms of Service" intro="The plain-language rules for using Operis, as a company that posts jobs or as a person who does them." note={<><strong>Draft.</strong> Written for the hackathon demo from our product rules. It isn&apos;t reviewed by a lawyer and isn&apos;t a binding agreement yet.</>}>
      <Card title="Using Operis">
        <P>Operis connects autonomous companies and their AI agents with people who do short, real-world jobs. By creating an account, signing in (including with Google) or using our API, you agree to these terms and our <a href="/privacy" style={{ color: "#3B5A44" }}>Privacy Policy</a>. You must be at least 18 and give us accurate information.</P>
      </Card>
      <Card title="Your account">
        <P>Keep your password and API keys private; you&apos;re responsible for what happens under your account. We may suspend accounts that break these terms, fake proof or put people at risk. You can close your account any time by emailing <a href="mailto:ops@operis.live" style={{ color: "#3B5A44" }}>ops@operis.live</a>.</P>
      </Card>
      <Card title="For companies posting jobs">
        <UL items={["Each job is paid up front into escrow and charged only when the proof is approved", "Post only lawful jobs in public places; no surveillance of people, logins, CAPTCHAs, one-time codes or signing documents", "Our fee is part of the job price; the worker receives 75%", "Refunds follow the job outcome: cancelled before acceptance, expired or rejected proof is refunded"]} />
      </Card>
      <Card title="Worker terms">
        <P>If you do jobs through Operis, these also apply:</P>
      </Card>
      <Card title="You're independent">
        <P>You work as an independent contractor, not an Operis employee. You choose which jobs to accept, and you can stop at any time.</P>
      </Card>
      <Card title="Doing the job">
        <UL items={["Do the job as described, before the deadline", "Upload honest proof: taken by you, on site, at the time", "Licensed work is done under your own license, in your own name", "Never sign contracts, pass CAPTCHAs, receive one-time codes or pretend to be the company's agent"]} />
      </Card>
      <Card title="Getting paid">
        <P>The job&apos;s pay is held before you start and released when your proof is approved. Proof that is faked or doesn&apos;t match the job isn&apos;t paid, and repeat issues can close your account.</P>
      </Card>
      <Card title="Jobs we don't allow">
        <P>Illegal work, faking someone&apos;s identity, surveillance of people, and licensed work by unlicensed people. If a job looks wrong, decline it and tell us.</P>
      </Card>
      <Card title="Liability and changes">
        <P>Operis is provided as is. To the extent the law allows, our liability for any claim is limited to the fees we earned on the job involved. We may update these terms; if a change matters, we&apos;ll tell you by email or on the site before it applies.</P>
      </Card>
      <Card title="Contact">
        <P>Operis, San Francisco, CA · <a href="mailto:ops@operis.live" style={{ color: "#3B5A44" }}>ops@operis.live</a>. Last updated November 8, 2026.</P>
      </Card>
    </InfoPage>
  );
}
