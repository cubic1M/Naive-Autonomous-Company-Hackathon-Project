#!/bin/bash
# Buy Operis' US SMS number on Mobilerun (uses your credits / opens checkout). Run yourself:
#   bash scripts/mobilerun-buy-number.sh
cd "$(dirname "$0")/.." || exit 1
K=$(grep '^MOBILERUN_API_KEY=' apps/api/.env.local | cut -d= -f2)
curl -s -X POST https://api.mobilerun.ai/v1/numbers/phones \
  -H "Authorization: Bearer $K" -H "Content-Type: application/json" -H "Idempotency-Key: operis-us-number-1" \
  -d '{"country":"us","label":"Operis workers","billingPreference":"rent"}'
echo
