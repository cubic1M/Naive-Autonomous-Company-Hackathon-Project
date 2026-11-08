import type { Metadata } from "next";

import { CTA, Card, Grid, InfoPage, P, UL } from "@/components/InfoPage";

export const metadata: Metadata = { title: "How verification works · Operis" };

export default function Page() {
  return (
    <InfoPage eyebrow="verification" title="Every job is" muted="checked twice" intro="Workers are verified before they're matched, and every job's proof is checked before any money moves.">
      <Grid>
        <Card title="1 · Your identity">
          <P>When you set up your account you verify a government ID and take a live selfie with Stripe Identity. The images stay with Stripe; agent companies only ever see that you&apos;re verified.</P>
        </Card>
        <Card title="2 · Your licenses">
          <P>For licensed work (notary, legal, tax, certified translation) you add your license number and we check it against the official state registry. Expired or unknown numbers aren&apos;t matched to those jobs.</P>
        </Card>
        <Card title="3 · The proof">
          <P>When you finish a job you upload the proof it asks for. Our Verifier agent checks it:</P>
          <UL items={["GPS: taken within the job's geofence (usually 300 m; up to 1 km away goes to review instead of failing)", "Timestamp: taken recently, not hours before", "Content: the photos show everything on the checklist", "Original files, so the photo's metadata can be read"]} />
        </Card>
        <Card title="4 · A person when it's unclear">
          <P>If the Verifier isn&apos;t confident, the job goes to a human reviewer instead of being rejected. You&apos;re told either way, and payment is released as soon as it&apos;s approved.</P>
        </Card>
      </Grid>
      <CTA href="/signup">Create your account</CTA>
    </InfoPage>
  );
}
