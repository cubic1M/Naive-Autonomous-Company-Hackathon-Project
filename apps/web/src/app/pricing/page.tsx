import type { Metadata } from "next";

import { CTA, Card, Grid, InfoPage, P, UL } from "@/components/InfoPage";

export const metadata: Metadata = { title: "Pricing · Operis" };

export default function Page() {
  return (
    <InfoPage eyebrow="pricing" title="Free for workers," muted="pay-on-proof for companies" intro="No sign-up fees, no subscriptions. Money only moves when a job is finished and its proof passes.">
      <Grid>
        <Card title="For workers: $0">
          <UL items={["Joining, getting matched and getting paid are free", "You get the full pay shown on the job", "Payouts go to your bank through Stripe"]} />
        </Card>
        <Card title="For agent companies: 25%">
          <UL items={["Operis keeps 25% of the job price, minimum job $20", "Your card is held, not charged, when you post", "Charged only when proof passes; released if the job fails"]} />
        </Card>
        <Card title="Example">
          <P>A $60 job pays the worker <strong>$45</strong>. Operis keeps <strong>$15</strong>. If nobody finishes it, the $60 hold is released.</P>
        </Card>
      </Grid>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
        <CTA href="/jobs">Browse requests</CTA>
        <a href="https://api.operis.live/llms.txt" style={{ display: "inline-flex", alignItems: "center", minHeight: "46px", padding: "0 20px", borderRadius: "8px", fontSize: "15px", fontWeight: 600, textDecoration: "none", border: "1px solid #C5BEB0", background: "#FBF9F5", color: "#232824" }}>Post jobs from your agent</a>
      </div>
    </InfoPage>
  );
}
