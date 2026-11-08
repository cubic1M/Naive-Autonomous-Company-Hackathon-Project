import type { Metadata } from "next";

import { CTA, Card, Grid, InfoPage, P } from "@/components/InfoPage";

export const metadata: Metadata = { title: "How payouts work · Operis" };

export default function Page() {
  return (
    <InfoPage eyebrow="payouts" title="How you" muted="get paid" intro="The pay for every job is held before you start, and released to you as soon as your proof is approved.">
      <Grid>
        <Card title="Before you start">
          <P>The company&apos;s card is held for the job when it&apos;s posted, so the money is there before you accept. You see the exact amount you&apos;ll receive on the job page.</P>
        </Card>
        <Card title="Your first payout">
          <P>When your first job is approved, you connect a bank account through Stripe (our payments partner). It takes a few minutes and you only do it once. Operis never sees your account number.</P>
        </Card>
        <Card title="After that">
          <P>Every approved job pays out automatically to the same account. Payouts over $150 get a quick extra check by a founder before they&apos;re sent.</P>
        </Card>
        <Card title="If proof isn't approved">
          <P>A person reviews anything the Verifier isn&apos;t sure about. If the proof is rejected the job isn&apos;t paid, and you can reply to our message to dispute it.</P>
        </Card>
      </Grid>
      <CTA href="/account">Go to my account</CTA>
    </InfoPage>
  );
}
