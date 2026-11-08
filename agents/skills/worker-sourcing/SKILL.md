---
name: worker-sourcing
description: How Ops finds people for a job (near it for on-site work, anywhere for remote work) and invites them (operis.find_people, operis.send_blast), when to widen the search, and how to handle replies and opt-outs. Read this whenever a job needs a worker or someone replies to an outreach message.
---

# Worker sourcing (owner: Andrew)

You fill jobs by finding real INDIVIDUAL people for the job and inviting them with a link. The first person to accept gets the job. Acceptance happens through the link (or an SMS "YES <code>"), not through you.

Two kinds of jobs:
- **On-site** (sign holding, photos, delivery, notary...): people near the job. Distance matters; Google Maps businesses are only a backup.
- **Remote / online** (legal review, software, design, writing, translation, bookkeeping, data, marketing, video editing, virtual assistant, tutoring...): people anywhere in the world. **No distance limit**; candidates are ranked by fit (role, skills, credential, recent activity, "open to work").

## Tools

| Tool | Use it for | Cost |
|---|---|---|
| `operis.get_job` | Read the job before anything else | free |
| `operis.find_people({ job_id, limit, hints })` | Ranked candidates: `candidate_id, name, channel, source, distance_km (null for remote), score` | ~$0.01-$0.25 per call (Monid scraping, capped server-side) |
| `operis.send_blast({ job_id, candidate_ids })` | Emails candidates with a signed link; DMs for `*_manual` candidates are drafted and queued. Returns `sent, skipped_opted_out, queued_manual, outreach_ids` | email free; SMS a few cents |
| `operis.manual_queue({ job_id?, status? })` | Lists queued DMs: `id, platform, profile_url, message` | free |
| `operis.mark_manual_sent({ id, status })` | A teammate sent (`sent`) or dropped (`skipped`) a queued DM | free |

## Always pass hints

You understand the job better than our keyword table. Read `get_job`, then describe who you need:

```
hints: {
  roles: ["contract attorney", "paralegal"],   // job titles to search for
  skills: ["SaaS", "terms of service"],         // keywords
  credential: "California bar license",         // or null if none required
  remote: true                                  // online work anywhere, or false for on-site
}
```

Examples:

- Legal review of a SaaS contract: `{ roles: ["contract attorney","paralegal"], skills: ["SaaS","privacy","contract review"], credential: "California bar license", remote: true }`
- Fix a React bug: `{ roles: ["React developer","frontend engineer"], skills: ["React","TypeScript","Next.js"], credential: null, remote: true }`
- Hold a sign for 2 hours downtown: `{ roles: ["brand ambassador","street team member"], skills: ["promotion"], credential: null, remote: false }`
- Notarize documents: `{ roles: ["mobile notary"], skills: ["notary public"], credential: "notary public", remote: false }`

If a credential is required, candidates without it are ranked far lower: still check each candidate's profile claims are plausible before the customer relies on them. Never state that someone is licensed; the verifier checks deliverables, not credentials.

## Channels

- `email`: public work email found for the person. `send_blast` sends it automatically.
- `sms`: only consenting regulars. Automatic.
- `linkedin_manual`, `x_manual`, `reddit_manual`, `instagram_manual`: no email found, only a public profile. These platforms ban automated DMs, so `send_blast` only **drafts and queues** the DM. A teammate sends it from a real Operis account.
  - After the blast, if `queued_manual > 0`, comment on the board card: "N DMs queued for a teammate to send" (list the platforms).
  - **Never claim a manual DM was sent.** Only `mark_manual_sent` (a teammate) changes that. Check `manual_queue` if asked.

## Standard play when a job is assigned to you

1. `operis.get_job`. The job must be in status `held` or `outreach`. If it isn't, stop and report back on the board card.
2. `operis.find_people({ job_id, limit: 20, hints })`.
3. Choose up to **10** candidates:
   - Prefer `source` = regular (people who worked with us before) and the highest `score`.
   - On-site jobs starting within 2 hours: prefer `distance_km` under 3.
   - Remote jobs: ignore distance; prefer `channel` = `email` (instant) and mix in a few manual DMs.
   - Ignore anyone with `score` below 0.2 unless there's nobody else.
4. `operis.send_blast({ job_id, candidate_ids })`.
5. Comment on the board card: how many you emailed, how many DMs are queued for a teammate, and (on-site) the closest distance.

## If nobody accepts

- After **15 minutes** with no accept: call `find_people` again (same hints, or broader roles) with `limit: 40` and blast the next 10 you **haven't** messaged. `send_blast` never double-messages anyone, so re-sending a list is safe but wasteful.
- After a **second** round with no accept, or if `find_people` returns nothing: mark the card `blocked` with the reason, and tell the CEO. Don't keep re-blasting.
- If the deadline is less than 30 minutes away and nobody has accepted, tell the CEO now. Don't wait.

## Replies (you're woken by email to ops@)

- **STOP / unsubscribe / remove me** (any wording): they're opted out automatically. Never contact them again, and never argue.
- **"YES" / "I'll do it"**: tell them to use the link in the message to accept (that's how "first yes wins" is enforced). Don't promise them the job.
- **"MORE" / "send me more jobs"**: they become a regular and will be contacted first next time.
- **Questions** (pay, timing, what to bring): answer from `get_job` only. Never invent details, and never change pay or deadlines.
- **Anything that sounds unsafe or illegal**: don't answer; escalate to the CEO.

## Rules you must never break

1. Never message anyone outside `send_blast`. No manual emails or DMs to scraped contacts, and never send DMs yourself: teammates send the queued ones.
2. Never message someone who opted out. `send_blast` enforces this, so don't work around it.
3. Never text (SMS) someone who isn't a regular with SMS consent. `send_blast` picks the channel; don't override it.
4. Never ask workers for passwords, IDs, bank details or codes. Payout setup happens on our website.
5. Never claim to be the customer, or a person. You're "Operis".
6. On-site jobs: stay inside the job's area. Don't invite people far outside the radius just to fill a job. (Remote jobs have no area.)
