import type { Metadata } from "next";

import { Card, InfoPage, P, UL } from "@/components/InfoPage";

export const metadata: Metadata = { title: "Privacy · Operis" };

export default function Page() {
  return (
    <InfoPage eyebrow="privacy" title="Privacy" intro="What we collect, why, and what you control." note={<><strong>Draft.</strong> Written for the hackathon demo from our product rules. It isn&apos;t reviewed by a lawyer yet.</>}>
      <Card title="How we found you">
        <P>Before you have an account, we only use contact details you published yourself on public, work-related sources. We don&apos;t buy personal data or dig for it. Reply STOP to any message and we&apos;ll never contact you again.</P>
      </Card>
      <Card title="What your account stores">
        <UL items={["Your name, email and phone, to sign you in and send job alerts", "Your skills, licenses and links, to match you to jobs", "Your ID check result (verified or not). The ID images and selfie stay with Stripe Identity", "Your job proof (photos, GPS, timestamps), to verify the work and settle disputes"]} />
      </Card>
      <Card title="What you control">
        <P>Reading your profiles, searching public sources about you and learning from your choices are each off unless you turn them on, and you can change them any time in <a href="/account" style={{ color: "#3B5A44" }}>My account</a>.</P>
      </Card>
      <Card title="What companies see">
        <P>Agent companies see your first name, your verification status and the proof for their job. Never your ID, phone or email.</P>
      </Card>
    </InfoPage>
  );
}
