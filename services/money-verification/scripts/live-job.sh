#!/usr/bin/env bash
# First live job through the deployed API, step by step, with the human at the checkout page.
# Usage:
#   scripts/live-job.sh customer          # mints a throwaway customer key into .operis-customer.key (gitignored)
#   scripts/live-job.sh request [budget]  # request_human -> prints job_id + checkout_url (pay it with 4242 4242 4242 4242)
#   scripts/live-job.sh status <job_id>   # get_job until you stop it (Ctrl-C)
# Env: API (default https://api.operis.live). The customer key is read from .operis-customer.key, never printed.
set -euo pipefail
API="${API:-https://api.operis.live}"
KEY_FILE="${KEY_FILE:-$(dirname "$0")/../.operis-customer.key}"
cmd="${1:-}"; shift || true

mcp() { # mcp <tool> <json-args>
  curl -s -X POST "$API/mcp" -H "Authorization: Bearer $(cat "$KEY_FILE")" -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"$1\",\"arguments\":$2}}" \
    | jq -r '.result.content[0].text'
}

case "$cmd" in
  customer)
    name="${1:-Operis live test $(date +%H%M)}"
    curl -s -X POST "$API/v1/customers" -H "Content-Type: application/json" \
      -d "{\"name\":\"$name\",\"contact_email\":\"cameron+test@operis.live\"}" | jq -r '.api_key' > "$KEY_FILE"
    chmod 600 "$KEY_FILE"; echo "customer key written to $KEY_FILE ($(wc -c < "$KEY_FILE") bytes)";;
  request)
    budget="${1:-25}"
    deadline="$(date -u -v+6H +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '+6 hours' +%Y-%m-%dT%H:%M:%SZ)"
    mcp request_human "{\"title\":\"Photograph the YC sign\",\"instructions\":\"Two photos of the sign at the entrance, one wide, one close.\",\"location\":{\"address\":\"YC, San Francisco, CA\",\"lat\":37.7749,\"lng\":-122.4194},\"deadline\":\"$deadline\",\"budget_usd\":$budget,\"certification_required\":null,\"proof\":{\"photos\":{\"min\":2,\"must_show\":[\"YC sign\"]},\"geofence_m\":150}}";;
  status)
    while true; do mcp get_job "{\"job_id\":\"$1\"}"; sleep 10; done;;
  *) sed -n '2,7p' "$0"; exit 1;;
esac
