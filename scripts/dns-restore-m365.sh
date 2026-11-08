#!/bin/bash
# Restores operis.live's Microsoft 365 email (ops@operis.live, used by Andrew's outreach via Outlook SMTP)
# in Vercel DNS, after the nameservers moved from GoDaddy to Vercel. Values copied from GoDaddy's zone.
#   bash scripts/dns-restore-m365.sh
cd "$(dirname "$0")/.." || exit 1
a() { npx vercel dns add operis.live "$@" || true; }
a '@' MX operis-live.mail.protection.outlook.com 0
a '@' TXT 'v=spf1 include:secureserver.net -all'
a '@' TXT 'NETORGFT21294107.onmicrosoft.com'
a autodiscover CNAME autodiscover.outlook.com
a selector1._domainkey CNAME selector1-operis-live._domainkey.netorgft21294107.n-v1.dkim.mail.microsoft
a selector2._domainkey CNAME selector2-operis-live._domainkey.netorgft21294107.n-v1.dkim.mail.microsoft
a _dmarc TXT 'v=DMARC1; p=quarantine; adkim=r; aspf=r; rua=mailto:dmarc_rua@onsecureserver.net;'
a lyncdiscover CNAME webdir.online.lync.com
a sip CNAME sipdir.online.lync.com
a email CNAME email.secureserver.net
a _sip._tls SRV 100 1 443 sipdir.online.lync.com
a _sipfederationtls._tcp SRV 100 1 5061 sipfed.online.lync.com
npx vercel dns ls operis.live
