#!/bin/bash
# Removes the Operis team that was first created in the "meaning of life" org (it now lives in "Operis").
# Deletes ONLY: agents named operis-*, their schedules, webhooks pointing at operis, the "operis" vault,
# and the worker-sourcing skill. Other agents in that org are untouched.
#   OLD_NAIVE_KEY=sk_live_... bash scripts/cleanup-old-naive-org.sh        (dry run: lists what it would delete)
#   OLD_NAIVE_KEY=sk_live_... bash scripts/cleanup-old-naive-org.sh --yes  (deletes)
set -e
K="${OLD_NAIVE_KEY:?set OLD_NAIVE_KEY to the meaning-of-life key}"; H="Authorization: Bearer $K"; B=https://api.vetta.sh/v1
GO=$([ "$1" = "--yes" ] && echo 1 || echo 0)
ORG=$(curl -s "$B/me" -H "$H" | jq -r .organization.name); echo "org: $ORG"
[ "$ORG" = "Operis" ] && { echo "Refusing: this is the Operis org (the live team). Use the meaning-of-life key."; exit 1; }
del() { if [ $GO = 1 ]; then curl -s -X DELETE "$B/$1" -H "$H" -o /dev/null -w "deleted $1 → %{http_code}\n"; else echo "would delete $1  ($2)"; fi; }
AGENTS=$(curl -s "$B/agents?limit=100" -H "$H" | jq -r '.data[] | select(.name|startswith("operis-")) | "\(.id) \(.name)"')
IDS=$(echo "$AGENTS" | awk '{print $1}' | paste -sd'|' -)
[ -n "$IDS" ] && curl -s "$B/deployments?limit=100" -H "$H" | jq -r --arg a "$IDS" '.data[] | select(.agent_id|test($a)) | "\(.id) \(.cron)"' | while read id cron; do del "deployments/$id" "schedule $cron"; done
curl -s "$B/webhooks?limit=100" -H "$H" | jq -r '.data[] | select(.url|test("operis")) | .id' | while read id; do del "webhooks/$id" "webhook → operis"; done
echo "$AGENTS" | while read id name; do [ -n "$id" ] && del "agents/$id" "$name"; done
curl -s "$B/vaults?limit=100" -H "$H" | jq -r '.data[] | select(.display_name=="operis") | .id' | while read id; do del "vaults/$id" "vault operis"; done
del "skills/skl_9habm7stdjrvp4t084nge6hre2" "skill worker-sourcing"
[ $GO = 1 ] || echo "Dry run. Re-run with --yes to delete."
