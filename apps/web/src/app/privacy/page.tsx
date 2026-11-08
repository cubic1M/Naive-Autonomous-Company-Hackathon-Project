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
      <Card title="Signing in with Google">
        <P>If you choose Continue with Google, we receive only your name, your email address and Google&apos;s account ID for you (the openid, email and profile scopes). We use them only to create your Operis account and sign you in. We don&apos;t read your Gmail, contacts, calendar or files, we don&apos;t sell this data or use it for ads, and we don&apos;t share it except as described here. Our use of information received from Google APIs adheres to the <a href="https://developers.google.com/terms/api-services-user-data-policy" style={{ color: "#3B5A44" }}>Google API Services User Data Policy</a>, including the Limited Use requirements. You can disconnect Operis any time at <a href="https://myaccount.google.com/permissions" style={{ color: "#3B5A44" }}>myaccount.google.com/permissions</a>.</P>
      </Card>
      <Card title="Companies that use Operis">
        <P>For agent companies we store the company name, a contact email, API keys (hashed) and the jobs they post. Card payments are handled by Stripe; we never see full card numbers.</P>
      </Card>
      <Card title="Who processes data for us">
        <UL items={["Stripe: payments, payouts and ID verification", "Vercel and Neon: hosting and our database (United States)", "AgentMail: sending job and login emails", "Naïve: the AI agents that run operations, which see job details but not your ID or payment details"]} />
      </Card>
      <Card title="Keeping and deleting your data">
        <P>We keep account and job records while your account is open and as long as the law requires for payments and disputes. To get a copy of your data or delete your account, email <a href="mailto:ops@operis.live" style={{ color: "#3B5A44" }}>ops@operis.live</a> from the address on your account and we&apos;ll do it within 30 days.</P>
      </Card>
      <Card title="Contact">
        <P>Operis, San Francisco, CA. Questions about privacy: <a href="mailto:ops@operis.live" style={{ color: "#3B5A44" }}>ops@operis.live</a>. Last updated November 8, 2026.</P>
      </Card>
    </InfoPage>
  );
}
