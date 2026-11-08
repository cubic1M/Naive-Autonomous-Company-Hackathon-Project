# Ready for Naïve: x402 wallet payments, CEO control plane, brand kit

Everything below is built on branch `edwin/naive-ready` and **off by default**. The one thing we can't do ourselves is
switch on Naïve's custody wallet. Naïve does that on their side. Our probe returned:

```
POST /v1/identities/operis-x402-probe/wallet   → 501 feature_not_configured  ("the custody wallet is not configured")
```

## 1. What's built

| Piece | Where | State |
|---|---|---|
| **x402 seller**: agents fund jobs in USDC, no human | `GET https://api.operis.live/x402/jobs/{id}/fund` (`apps/api/src/app/x402/...`, `lib/x402.ts`) | Built and tested locally (402 with the right price, asset and address). Off until `X402_ENABLED=true` |
| `request_human` offers it | adds `x402: { url, network, asset, amount_usd }` and a `next_step` that says "on Naïve call wallet.pay with this url" | Only when x402 is on |
| USDC jobs through Finance | `capture_payment` succeeds without Stripe (the USDC already moved); `refund` and cancel mark a **USDC refund due** in the agent feed; the payout to the worker still goes through Stripe Connect | Built |
| Receiving wallet (testnet treasury) | `scripts/x402-treasury.ts`. Address **`0x5fE625331a9426C97A898C22F9Fe291A1148B0DC`** (Base Sepolia); key only in `apps/api/.env.local` | Made |
| Test buyer agent (any x402 wallet) | `scripts/x402-buyer.ts`: posts a job and pays it in test USDC | Ready; needs faucet USDC |
| USDC refunds | `scripts/x402-refund.ts` (lists due refunds, `--send` pays them back) | Ready |
| **Naïve wallet pays Operis** (the judge moment) | `agents/wallet-pay-test.ts`: wallet on our identity `operis-x402-probe`, faucet, `quote` and `pay` on a job's x402 url | Ready; prints "still OFF" until Naïve enables custody |
| **CEO gets Naïve's control plane** | `agents/control-plane.ts` plus `agents.json ceo.control_plane`. Least privilege: 13 read tools allowed, 5 write tools ask a founder, nothing that creates or deletes agents | Ready (dry run prints the plan) |
| **Brand kit in Naïve's studio** | `agents/brand.ts`: ring logo SVG plus palette Forest/Sage/Mint/Paper/Ink, `grotesk`, "Humans on demand for autonomous companies." | Ready (dry run) |
| Migration | `apps/api/migrations/013_x402_payments.sql` | Run with `npm run db:migrate` |

## 2. The message to send Naïve (chat or in person)

> Hi! We're **Operis** (org "Operis"), humans on demand for autonomous companies: one MCP tool, `request_human`,
> and a verified person in SF does the real-world task. Eight Naïve agents run the company.
>
> We built an **x402 seller** so a Naïve agent can hire a human and pay with its own wallet, no human in the loop:
> `request_human` returns an x402 url, and the agent calls **`wallet.pay`** on it. Our side is live on Base Sepolia
> (exact scheme, USDC, v2 `PAYMENT-REQUIRED`).
>
> Could you **switch on the custody wallet for our org**, Base Sepolia is fine? Right now
> `POST /v1/identities/operis-x402-probe/wallet` returns `501 feature_not_configured`.
>
> Three quick questions:
> 1. Can an operator set `per_tx_cap_micro_usd` to 30,000,000 ($30)? Our jobs start at $20.
> 2. Does `wallet.pay` speak x402 **v2** (`PAYMENT-SIGNATURE` / `PAYMENT-REQUIRED`) or v1 (`X-PAYMENT`)? We serve v2.
> 3. Is Base **mainnet** possible for our org during the demo?
>
> We'd love to be the first real seller on `wallet.pay`, for hiring a human. Thank you!

## 3. Your steps on the Naïve dashboard

The scripts do the API work; the dashboard is for checking and for the owner-only settings.

1. **Check you're the owner** of the "Operis" org (Organization → Members). Only an owner can enable Base mainnet
   wallets, and some of these routes need an `admin` key.
2. **API key:** the key in `NAIVE_API_KEY` must be an **admin** key to mint the CEO's control-plane session
   (Organization → API keys). If `control-plane.ts --apply` returns `403`, create an admin key and use it once.
3. **After Naïve turns wallets on:**
   - Identities → `operis-x402-probe` → Wallet: you should see a Base Sepolia wallet (the script creates it).
   - Set the per-payment cap to **$30** and the daily cap to **$60** if the script couldn't.
   - Fund it from the faucet: 1 USDC per click, or `--fund 20`.
4. **Control plane (when you're ready):** run the two commands in §4B. Then check:
   - Vaults: a vault named **"Orchestrator control plane"** holds credential `naive-control-plane` for `https://api.vetta.sh/v1/mcp`.
   - Agents → operis-ceo: a second MCP server `naive` with 18 tools (13 allowed, 5 ask).
   - Organization: the CEO shown as the company's CEO.
5. **Brand:** after §4C, the studio's top-left shows the Operis rings logo, and Organization → Brand shows the palette and tagline.
6. **Approvals:** `wallet.pay` defaults to **ask**, so a founder approves each payment in the studio's approvals (or
   we add it to the agent's `allow` list once we trust it).

## 4. Commands, in order (from the repo root, on this branch)

**A. x402 on (testnet). Do this as soon as you want, it doesn't depend on Naïve.**
```bash
DATABASE_URL=… npm run db:migrate                         # adds x402_payments (013)
npx vercel env add X402_ENABLED production   # value: true
npx vercel env add X402_PAY_TO production    # value: 0x5fE625331a9426C97A898C22F9Fe291A1148B0DC
# (optional) X402_NETWORK=eip155:84532, X402_FACILITATOR_URL=https://x402.org/facilitator   (the defaults)
npx vercel deploy --prod --yes
```
Prove it with any x402 wallet:
```bash
npx tsx scripts/x402-buyer.ts --new-wallet                # fund the address at https://faucet.circle.com (Base Sepolia, USDC)
X402_BUYER_PRIVATE_KEY=0x… OPERIS_API_KEY=opk_… npx tsx scripts/x402-buyer.ts
# → request_human returns x402.url → 402 → paid → job status held → Compliance, CEO, Ops wake. Watch admin.operis.live.
```

**B. CEO control plane**
```bash
npx tsx agents/control-plane.ts --apply                   # mints a 90-day least-privilege MCP session and stores it in the vault
CEO_CONTROL_PLANE=true API_BASE_URL=https://api.operis.live npm run agents:setup
```

**C. Brand kit**
```bash
npx tsx agents/brand.ts --apply
```

**D. The moment Naïve says yes**
```bash
npx tsx agents/wallet-pay-test.ts --fund 20               # creates the wallet ($30 cap) and funds 20 test USDC
# post a job (any agent, or scripts/x402-buyer.ts without paying), copy its x402.url, then:
npx tsx agents/wallet-pay-test.ts --pay https://api.operis.live/x402/jobs/<job_id>/fund
```
In the video: a Naïve agent with that identity calls `wallet.pay` on the url, and the backoffice shows
"x402: paid $20 USDC on Base Sepolia → funded".

## 5. How the money works with x402
- **Funding:** the agent's wallet signs a USDC authorization. The x402.org facilitator checks it and puts it onchain,
  and the USDC lands in our treasury. We mark the job's escrow `captured`, because the money already moved. The job
  goes to `held` and the agents start.
- **No double payment:** the job is claimed before the payment settles, so a second payment for the same job gets
  `409` and is never settled.
- **Paying the worker:** unchanged. Stripe Connect pays out from our Stripe balance. USDC → USD conversion through
  Coinbase or Circle is a treasury step for real money.
- **Refunds:** any cancel, expiry or rejection of a USDC job marks "USDC refund due" in the agent feed.
  `scripts/x402-refund.ts --send` pays it back. The treasury needs a little Base Sepolia ETH for gas.
- **Mainnet:** set `X402_NETWORK=eip155:8453`, point `X402_FACILITATOR_URL` at a mainnet facilitator (e.g. Coinbase
  CDP, which needs API keys), and use a treasury address a founder controls. The testnet key isn't for real money.

## 6. Known limits (say them if asked)
- Naïve's wallet is Phase 5 and not enabled for us yet, so the Naïve `wallet.pay` demo needs Naïve to switch on custody.
- We serve x402 **v2**. If `wallet.pay` only speaks v1, we also need to serve v1. The `@x402` SDK ships v1 schemes (`@x402/evm/v1`), so it's a small change, but untested until we know.
- USDC refunds are a founder step (script), not automatic yet.
