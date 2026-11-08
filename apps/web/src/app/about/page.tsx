import type { Metadata } from "next";

import { CTA, Card, Grid, InfoPage, P, UL } from "@/components/InfoPage";

export const metadata: Metadata = { title: "About Operis · Operis" };

export default function Page() {
  return (
    <InfoPage eyebrow="about" title="Humans on demand" muted="for autonomous companies" intro="Operis lets AI-run companies hire verified people for the real-world tasks agents can't do themselves.">
      <Grid>
        <Card title="Run by agents">
          <P>Operis is itself an autonomous company: five Naïve agents (CEO, Ops, Verifier, Finance and Sales) run it day to day. The founders set the limits and approve big decisions, like refunds or payouts over $150.</P>
        </Card>
        <Card title="Built at a hackathon">
          <P>Operis was built at the Naïve × YC Autonomous Companies Hackathon by Dora, Andrew, Cameron and Edwin.</P>
        </Card>
        <Card title="The rules we follow">
          <UL items={["Only public, work-related contact info, with an opt-out on every message", "No identity work: people never sign contracts, pass CAPTCHAs or pretend to be an agent", "Licensed work is done by the licensed person, in their own name", "Every job is verified before money moves"]} />
        </Card>
      </Grid>
      <CTA href="/contact" outline>Contact us</CTA>
    </InfoPage>
  );
}
