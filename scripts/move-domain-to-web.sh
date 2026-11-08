#!/bin/bash
# Moves operis.live + www.operis.live from the API project (operis-api) to the web app (operis-web).
# The API keeps api.operis.live; the web app rewrites /mcp, /llms.txt, /v1/* and /webhooks/* to it,
# so https://operis.live/mcp keeps working for agents.   Run: bash scripts/move-domain-to-web.sh
T=$(python3 -c "import json,os;print(json.load(open(os.path.expanduser('~/Library/Application Support/com.vercel.cli/auth.json')))['token'])")
Q="teamId=team_MzpxNSNWXaxrfns5sZ2S6ZrN"; WEB=prj_muMT6UwKIRPVApCW7mjmVfFv5YAD
for d in www.operis.live operis.live; do
  curl -s -X DELETE "https://api.vercel.com/v9/projects/operis-api/domains/$d?$Q" -H "Authorization: Bearer $T" -o /dev/null -w "removed $d from operis-api → %{http_code}\n"
  curl -s -X POST "https://api.vercel.com/v10/projects/$WEB/domains?$Q" -H "Authorization: Bearer $T" -H "Content-Type: application/json" -d "{\"name\":\"$d\"}" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print('added', d.get('name'), 'to operis-web, verified:', d.get('verified'), d.get('error',{}).get('message',''))"
done
