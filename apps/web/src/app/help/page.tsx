import type { Metadata } from "next";

import { CTA, Card, InfoPage, P } from "@/components/InfoPage";

export const metadata: Metadata = { title: "Help · Operis" };

export default function Page() {
  return (
    <InfoPage eyebrow="help" title="Help" muted="and common questions" intro="Answers to what workers ask most. Still stuck? Email ops@operis.live.">
      <Card title="Why did I get a text from Operis?">
        <P>We found your contact details on a public, work-related source (a gig board, business listing or your own site) and a job near you matched. Every message has an opt-out: reply STOP and we&apos;ll never contact you again.</P>
      </Card>
      <Card title="Do I need an account?">
        <P>You can read any job from the link we send. To accept or decline you log in, so we know it&apos;s really you and can pay you. Creating an account takes a minute: <a href="/signup" style={{ color: "#3B5A44" }}>sign up here</a>.</P>
      </Card>
      <Card title="Someone else got the job">
        <P>Jobs go to the first verified person who says yes. We&apos;ll send you the next one that fits.</P>
      </Card>
      <Card title="My proof won't upload">
        <P>Turn on location for your browser, upload from the job&apos;s location, and use the original photos (not screenshots). The page keeps your photos if the connection drops, so just tap Retry.</P>
      </Card>
      <Card title="When do I get paid?">
        <P>As soon as your proof is approved. See <a href="/payouts" style={{ color: "#3B5A44" }}>how payouts work</a>.</P>
      </Card>
      <CTA href="/contact" outline>Contact us</CTA>
    </InfoPage>
  );
}
