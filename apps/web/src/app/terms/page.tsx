import type { Metadata } from "next";

import { Card, InfoPage, P, UL } from "@/components/InfoPage";

export const metadata: Metadata = { title: "Worker Terms · Operis" };

export default function Page() {
  return (
    <InfoPage eyebrow="terms" title="Worker Terms" intro="The plain-language version of how working through Operis works." note={<><strong>Draft.</strong> Written for the hackathon demo from our product rules. It isn&apos;t reviewed by a lawyer and isn&apos;t a binding agreement yet.</>}>
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
    </InfoPage>
  );
}
