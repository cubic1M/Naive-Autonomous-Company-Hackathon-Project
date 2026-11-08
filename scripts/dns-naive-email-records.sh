#!/bin/bash
# ⚠️ DO NOT RUN while operis.live mail is on Microsoft 365 (its MX would clash). Decide the email plan first.
# Adds the Naïve agent-email records for operis.live to Vercel DNS (sales@ / ops@operis.live).
# Run once after the nameservers point to Vercel:  bash scripts/dns-email-records.sh
set -e
cd "$(dirname "$0")/.."
npx vercel dns add operis.live '@' MX receive.forge.rmta.net 10
npx vercel dns add operis.live send MX feedback-smtp.us-east-1.amazonses.com 10
npx vercel dns add operis.live send TXT 'v=spf1 include:amazonses.com ~all'
npx vercel dns add operis.live rsend CNAME send.forge.rmta.net
npx vercel dns add operis.live resend._domainkey TXT 'p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDOJlAhFuxlpRFQju1fuzRquKxa7YuIXqE06UqKluLFmehKQfiq8PydXyerrELR4V07HGoV16C3oRf4wYtCwtagoNMXYWEKMI+jYVUBzLfkoyrnJmf8xxoaAl2vg92hcPT1+hMBIVT358DW3jLzKUgH+jxURncG7sDDKLbiY+ifuQIDAQAB'
npx vercel dns add operis.live _dmarc TXT 'v=DMARC1; p=none;'
npx vercel dns ls operis.live
