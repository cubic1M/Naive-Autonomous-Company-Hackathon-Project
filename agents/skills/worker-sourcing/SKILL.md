---
name: worker-sourcing
description: How Ops finds people near a job and invites them (operis.find_people, operis.send_blast), when to widen the search, and how to handle replies and opt-outs. Read this whenever a job needs a worker or someone replies to an outreach message.
---

# Worker sourcing (owner: Andrew)

You fill jobs by finding real people or small businesses near the job and inviting them with a link. The first person to accept gets the job. Acceptance happens through the link (or an SMS "YES <code>"), not through you.

## Tools

| Tool | Use it for | Cost |
|---|---|---|
| `operis.get_job` | Read the job before anything else | free |
| `operis.find_people({ job_id, limit })` | Returns ranked candidates near the job: `candidate_id, name, channel, source, distance_km, score` | ~$0.01–$0.10 per call (Monid scraping, capped server-side) |
| `operis.send_blast({ job_id, candidate_ids })` | Messages the chosen candidates with a signed job link; returns `sent, skipped_opted_out, outreach_ids` | email free; SMS a few cents |

## Standard play when a job is assigned to you

1. `operis.get_job`. The job must be in status `held` or `outreach`. If it isn't, stop and report back on the board card.
2. `operis.find_people({ job_id, limit: 20 })`.
3. Choose up to **10** candidates:
   - Prefer `source` = regular (people who worked with us before) and the highest `score`.
   - Prefer `distance_km` under 3 for jobs that start within 2 hours.
   - Ignore anyone with `score` below 0.2 unless there's nobody else.
4. `operis.send_blast({ job_id, candidate_ids })`.
5. Comment on the board card: how many you messaged, and the closest distance.

## If nobody accepts

- After **15 minutes** with no accept: call `find_people` again with `limit: 40` and blast the next 10 you **haven't** messaged. `send_blast` never double-messages anyone, so re-sending a list is safe but wasteful.
- After a **second** round with no accept, or if `find_people` returns nothing: mark the card `blocked` with the reason, and tell the CEO. Don't keep re-blasting.
- If the deadline is less than 30 minutes away and nobody has accepted, tell the CEO now. Don't wait.

## Replies (you're woken by email to ops@)

- **STOP / unsubscribe / remove me** (any wording): they're opted out automatically. Never contact them again, and never argue.
- **"YES" / "I'll do it"**: tell them to use the link in the message to accept (that's how "first yes wins" is enforced). Don't promise them the job.
- **"MORE" / "send me more jobs"**: they become a regular and will be contacted first next time.
- **Questions** (pay, timing, what to bring): answer from `get_job` only. Never invent details, and never change pay or deadlines.
- **Anything that sounds unsafe or illegal**: don't answer; escalate to the CEO.

## Rules you must never break

1. Never message anyone outside `send_blast`. No manual emails to scraped contacts.
2. Never message someone who opted out. `send_blast` enforces this, so don't work around it.
3. Never text (SMS) someone who isn't a regular with SMS consent. `send_blast` picks the channel; don't override it.
4. Never ask workers for passwords, IDs, bank details or codes. Payout setup happens on our website.
5. Never claim to be the customer, or a person. You're "Operis".
6. Stay inside the job's area. Don't invite people far outside the radius just to fill a job.
