# services/outreach (owner: Andrew)

**Job:** when a job comes in, find real people near the location who could do it, and message them a link to the job.

Andrew builds two tools for the **Ops** agent: `find_people` and `send_blast`. Ops (a Naïve agent) decides when to call them; this folder does the actual work. Input and output shapes live in [`contracts/tools.ts`](../../contracts/tools.ts). Where this fits in the whole job: [`docs/FLOW.md`](../../docs/FLOW.md), steps 5–6.

```
Ops agent (Naïve)
   │ find_people(job_id)                │ send_blast(job_id, candidate_ids)
   ▼                                    ▼
find.ts                              blast.ts
   1. read job (lat/lng, task, cert)    1. skip opted-out people
   2. regulars first (DB)               2. make a signed link /j/[token] per person
   3. search the web via Monid          3. email strangers, SMS regulars only
   4. clean + dedupe                    4. save each message in `outreach`
   5. score                             5. return counts + ids
   6. save to `workers`
   7. return top N (ids + scores)
                                        ▼
                         Human clicks link → apps/web (Dora) → accept → apps/api (Edwin)
```

---

## Tool 1: `find_people`

**Input:** `{ job_id, limit? }` (default limit 20)
**Output:** `{ candidates: [{ candidate_id, name, channel, source, distance_km, score }] }`

1. **Read the job:** address, `lat`/`lng`, task, and `certification_required`.
2. **Regulars first:** query `workers` for people who worked with us before and opted in to more jobs, nearest first. They reply fastest.
3. **Search the web through [Monid](https://monid.ai)** (one API key covering many scrapers). Run 2–3 sources in parallel:

   | Need | Monid source (confirm with `monid discover`) | Why |
   |---|---|---|
   | Local gig workers | Craigslist gigs / services scraper | People who **posted** that they want work in SF |
   | Local businesses | Apify `/damilo/google-maps-scraper` (e.g. "event staffing", "sign spinners", "couriers" near the job) | Public phone, website and coordinates |
   | Certified people | LinkedIn / people search | **Only** when the job needs a certification (e.g. notary) |
   | Contact email | Email finder / website contact scraper | Turns a business website into an email |
   | Extra availability | Reddit posts (e.g. "looking for work SF") | People saying they're available |

4. **Clean:** dedupe by email/phone, drop anyone with no public work contact, and drop `opted_out = true`.
5. **Score (0–1):** distance to the job, task fit, has a contact, and a bonus for regulars.
6. **Save** new people to `workers` with `source` set (e.g. `monid:google-maps`).
7. **Return the top N.** Return ids and scores only, never raw scrapes: Naïve truncates tool results at 8,000 characters.

Sketch:

```ts
const results = await Promise.all([
  monid.run("apify", "/damilo/google-maps-scraper",
    { searchStringsArray: [taskKeyword(job)], locationQuery: job.address, maxCrawledPlaces: 30 }),
  monid.run(CRAIGSLIST.provider, CRAIGSLIST.endpoint, { city: "sfbay", query: taskKeyword(job) }),
]);
const people = dedupe(normalize(results))
  .filter(p => p.email || p.phone)
  .filter(p => !p.opted_out);
return { candidates: rank(people, job).slice(0, limit ?? 20) };
```

## Tool 2: `send_blast`

**Input:** `{ job_id, candidate_ids }`
**Output:** `{ sent, skipped_opted_out, outreach_ids }`

1. Skip anyone with `opted_out = true`.
2. Create a signed token per person with Edwin's `lib/links.ts` and save it in `outreach.token`. The link is `/j/[token]`, which opens Dora's job page.
3. Send the message:
   > Hi! Paid gig near you: hold a sign near the YC office, 2 hours, $45. Interested? {link}. Reply STOP to never hear from us.
   - **Email** (from the Naïve `ops@` inbox) for people we found online.
   - **SMS** via Edwin's `sendSms(to, body)` (`apps/api/src/lib/messaging.ts`: Mobilerun, falling back to Monid AgentLine) **only** for regulars who opted in before.
4. Save a row in `outreach` per message: `channel`, `token`, `status = sent`.
5. Return counts and ids.

**Not in this folder:** what happens after the click. Dora owns the job page, and Edwin's API owns accept / "first yes wins".

---

## How it plugs into Naïve

- **Ops agent** calls `find_people` and `send_blast` over our internal MCP server (Edwin registers them in `apps/api/src/mcp/internal.ts`; permission `allow`).
- **Skill:** `agents/skills/worker-sourcing/SKILL.md` (Andrew writes it) teaches Ops how to use the tools. For example: call `find_people`, blast the top 10, and if nobody accepts in 15 minutes, call again with a bigger limit, or escalate to the CEO.
- **Replies** to the `ops@` Naïve inbox wake Ops automatically.
- **Re-blast cron:** a Naïve deployment checks jobs stuck in `outreach` and widens the search.

## Connectors and env vars

| Connector | Used for | Env var |
|---|---|---|
| Monid | All scraping; call Edwin's `monidRun(provider, endpoint, input)` in `lib/monid.ts` | `MONID_API_KEY` (shared by Edwin) |
| Naïve email (`ops@`) | Outreach emails; replies wake Ops | set up by Edwin |
| SMS (Mobilerun, fallback Monid AgentLine) | SMS to opted-in regulars only; call `sendSms()` | set up by Edwin |
| Postgres | `workers`, `outreach` tables | `DATABASE_URL` |
| Link signing | Signed `/j/[token]` links via `lib/links.ts` | `LINK_SIGNING_SECRET` (Edwin) |

Never commit keys. Put them in `.env` locally and in Vercel env vars for deploys.

## Rules

1. **Public, work-related contact info only.** No buying or digging up personal data.
2. **Never message anyone who opted out.** `STOP` sets `workers.opted_out = true` permanently.
3. **Every message includes an opt-out.**
4. **Don't cold-text strangers.** Email them; SMS is only for regulars who said yes (US texting law).
5. **Cap Monid spend per job.** Runs are paid per call or per result, so set `maxItems` and limit sources.
6. **Short tool results** (under 8,000 characters).

## Build plan

1. **Monid setup.** `npm i -g @monid-ai/cli`, then `monid keys add -k <key> -l main` (Edwin shares the team key). Pick real endpoints with `monid discover -q "craigslist gigs"` and `monid inspect -p <provider> -e <endpoint>`. Record the chosen endpoints and inputs in this README.
2. **Mock `find_people`** that returns fake candidates in the contract shape, so Edwin can wire Ops to it right away.
3. **`send_blast` to yourself:** email your own address with a real signed link.
4. **Real `find_people`:** regulars, then Monid sources, then clean, score and save.
5. **Opt-out handling:** Edwin's `/webhooks/mobilerun` sets `opted_out` on SMS `STOP`; handle email unsubscribes in `send_blast`'s link/footer.
6. **Skill file** for Ops: `agents/skills/worker-sourcing/SKILL.md`.
7. **Smoke test:** add `find_people` and `send_blast` calls to `scripts/smoke.ts`.
8. **Seed regulars:** 5–10 friends near YC opted in, for fast demo replies.

## Files

```
services/outreach/
├── README.md     this file
├── find.ts       find_people
├── blast.ts      send_blast
└── score.ts      ranking
```

Shared clients (`monid.ts`, `messaging.ts`, `links.ts`) live in `apps/api/src/lib/` and are owned by Edwin. See [`docs/plans/edwin.md`](../../docs/plans/edwin.md).
