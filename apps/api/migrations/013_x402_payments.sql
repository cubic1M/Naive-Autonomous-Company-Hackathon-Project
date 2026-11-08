-- Jobs funded in USDC over x402 (an agent's wallet pays GET /x402/jobs/{id}/fund). Idempotent.
-- The job's escrow row is written as 'captured' (the USDC already moved), so payout works unchanged; refunds of these
-- jobs go back in USDC (refund_status 'due' until a founder runs scripts/x402-refund.ts).
create table if not exists x402_payments (
  job_id uuid primary key,
  status text not null check (status in ('settling', 'settled', 'failed')),
  network text not null,                 -- CAIP-2, e.g. eip155:84532 (Base Sepolia) or eip155:8453 (Base)
  pay_to text not null,                  -- our receiving address
  payer text,                            -- the buyer's wallet address
  amount_micro_usd bigint not null,      -- USDC has 6 decimals: 1 USDC = 1,000,000
  tx_hash text,
  refund_status text check (refund_status in ('due', 'sent')),
  refund_tx_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
