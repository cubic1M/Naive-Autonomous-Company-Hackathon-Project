# Talent pool snapshots

`pool.json` (default `POOL_FILE`) is the talent pool the demo searches first: people only, no outreach or costs.
It is git-ignored because it holds scraped contact details.

Build it before the demo (spends Monid credits, capped by `MAX_SPEND` per family):

    MONID_API_KEY=... npx tsx scripts/warm-pool.ts            # all job families
    MONID_API_KEY=... npx tsx scripts/warm-pool.ts --families legal,react
    npx tsx scripts/warm-pool.ts --dry                        # print the plan, no calls

With `DATABASE_URL` set the people go into Postgres instead of the file.
`scripts/demo.ts` loads the file, searches it instantly, and saves it back so it keeps growing.
