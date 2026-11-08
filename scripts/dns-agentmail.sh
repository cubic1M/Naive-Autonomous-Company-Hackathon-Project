#!/bin/bash
# AgentMail records for mail.operis.live (Andrew's outreach sender ops@mail.operis.live) in Vercel DNS.
# Only touches the mail. subdomain; Outlook on operis.live is unaffected.  Run: bash scripts/dns-agentmail.sh
cd "$(dirname "$0")/.." || exit 1
a() { npx vercel dns add operis.live "$@" || true; }
# (agentmail._domainkey.mail TXT already added in the dashboard)
a mail MX inbound-smtp.us-east-1.amazonaws.com 10
a mail.mail MX feedback-smtp.us-east-1.amazonses.com 10
a mail.mail TXT 'v=spf1 include:amazonses.com -all'
a _dmarc.mail TXT 'v=DMARC1; p=reject; rua=mailto:dmarc@agentmail.to'
npx vercel dns ls operis.live
