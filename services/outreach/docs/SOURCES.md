# Operis outreach: Monid sources

Surveyed 2026-11-07 via `monid discover` / `monid inspect`. All calls go through the `monid` CLI.
Input location matters: "body" -> `-i '<json>'`, "query" -> `--query '<json>'`.
Fixtures (real run output) live in `services/outreach/test/fixtures/`. Health is as reported at survey time.

## 1. Local businesses near lat/lng

| Provider | Endpoint | Price | Health | Input (location, required) | Notes |
|---|---|---|---|---|---|
| **anyapi** (RECOMMENDED, structured) | `/maps.search_nearby` | $0.0013/call (~20 places) | stable 8.4s | body; `query`, `coordinates{latitude,longitude}`; optional `zoom`, `cursor` | Flat fields: name, phone, website, domain, address, city, postalCode, latitude, longitude, rating, reviewCount, placeId. Tested. |
| litescrape (RECOMMENDED, cheapest) | `/google/maps` | $0.00015/call | healthy 7.4s | query; `q`, `type=search`, `ll=@lat,lon,5000m` (or `lat`,`lon`,`m`), `nearby`, `start` | Richer (hours, `gps_coordinates`, `type`) but nested under `local_results`. Tested. |
| litescrape | `/bing/maps` | $0.00015/call | stable 3s | query; `q`, `cp=lat~lon`, `count` (1-30) | Not run. Fallback coverage. |
| litescrape | `/yelp/search` | $0.00015/call | degraded | query; `find_loc` required, `find_desc`, `cflt`, `sortby` | Not run. Yelp rating/phone, no lat/lng input. |
| serpapi | `/apple-maps/search`, `/yelp/search`, `/bing/maps` | $0.015/call | stable | not inspected | 100x price; skip. |
| dataforseo | `/business/listings` | $0.00036/result + $0.012 flat | stable | body; `categories`, `location_coordinate`, `limit` | Category-database search; flat fee. |

Minimal examples:
- anyapi: `monid run -p anyapi -e /maps.search_nearby -i '{"query":"photographer","coordinates":{"latitude":37.7749,"longitude":-122.4194}}' -w 60`
- litescrape: `monid run -p litescrape -e /google/maps --query '{"q":"event staffing","type":"search","ll":"@37.7749,-122.4194,5000m"}' -w 60`

Output fields: anyapi `data.items[].{name,phone,website,domain,address,latitude,longitude,placeId,rating,reviewCount,category}` (lat/lng arrive as strings). litescrape `local_results[].{title,phone,website,address,gps_coordinates.{latitude,longitude},place_id,type,rating,reviews}`.

## 2. Contact enrichment (email from domain, finder, verifier)

| Provider | Endpoint | Price | Health | Input | Notes |
|---|---|---|---|---|---|
| **hunterio** (RECOMMENDED) | `/domain-search` | $0.0245 per started block of 10 emails; zero results free | healthy 3.4s | body; `domain` (or `company`), `limit` (max 100), `type`, `seniority`, `department`, `job_titles`, `required_field` | Tested. Example: `{"domain":"kineticevents.com","limit":5}` |
| hunterio | `/email-finder` | $0.0245, only if found | stable 3.9s | query; `domain`/`company`, `first_name`, `last_name` or `full_name` | Not run. |
| hunterio | `/email-verifier` | $0.01225, only on definitive verdict | healthy 5.6s | query; `email` (required) | RECOMMENDED verifier. |
| hunterio | `/domain-finder` ($0), `/email-count` ($0) | free | stable | company name -> domain; count before paying | Use `/email-count` as a free pre-check. |
| anyapi | `/email.verify` | $0.0066 | stable 10.6s | body; `email` | Cheaper alternative verifier, slower. |

Output fields (`/domain-search`): `data.organization`, `data.pattern`, `data.emails[].{value,type,confidence,first_name,last_name,position,seniority,linkedin,phone_number,verification.status}`, `meta.results` (total). Caution: some rows have `source_type: "generated"` / `provenance: "inferred"` (pattern guesses, not published addresses). Prefer `type: "generic"` and rows with `sources`, and verify before sending.

Excluded for privacy: contactout `/v1/people/search/personal-email` and any personal-email lookup. contactout `/v1/email/enrich/work-email` ($0.10+) also skipped as too costly.

## 3. Website contact extraction

| Provider | Endpoint | Price | Health | Input | Notes |
|---|---|---|---|---|---|
| **search1api** (RECOMMENDED) | `/crawl` | $0.001/page | stable 4.2s | body; `url` | Tested. Returns `results.{title,link,content}` markdown; regex phone/email from it. Crawl `/contact` explicitly; one page per call. |
| mrscraper | `/scrape/brand` | $0.001/token | stable 12s (p95 110s) | body; `url` | Logo/colors/social links, not emails. |
| anyapi | `/facebook.page_contact` | ~$0.0012 | stable 5.7s | body; `page` (FB page URL) | Public page email/phone. |
| anyapi | `/instagram.profile_contact` | $0-$0.00175 | stable 3.4s | body; `handle` | Public business contact on profile. |
| anyapi | `/tiktok.profile_contact` | $0 | stable | body | Free. |

## 4. Phone validation / line type

| Provider | Endpoint | Price | Health | Input |
|---|---|---|---|---|
| **api.strale.io** (RECOMMENDED, weak) | `/x402/phone-type-detect` | $0.0216/call | stable 1.2s | query; `phone_number` (required), `country_code` |
| api.strale.io | `/x402/phone-validate` | $0.0216/call | stable | query; `phone_number` |

Both infer from numbering plan only (no live carrier lookup). Cheaper to do format validation locally (libphonenumber); there is no real carrier-lookup endpoint.

## 5. Geocoding (address -> lat/lng)

| Provider | Endpoint | Price | Health | Input |
|---|---|---|---|---|
| api.kadec0.xyz | `/v1/geocode` | $0.02/call | stable 3.3s | query; `q`, `maxItems`; also `lat`,`lon` for reverse |
| api.strale.io | `/x402/address-geocode` | $0.0216/call | unknown | query; `address` |

RECOMMENDED: avoid paying. Pass the address as `location`/`q` to litescrape `/google/maps`, which resolves names itself; use kadec0 only if raw coordinates are needed. Alternatively geocode locally (Nominatim).

## 6. LinkedIn

| Provider | Endpoint | Price | Health | Input |
|---|---|---|---|---|
| **ploid** (RECOMMENDED search) | `/linkedin/search` | $0.01/result | stable 3.1s | body; `filters{keywords,location,title,currentCompany,school}`, `limit` (1-100, default 25), `cursor`. Tested. |
| **ploid** (RECOMMENDED enrich) | `/linkedin/profile` | $0.01/call | stable 9.2s | query; `url` (required) |
| apify | `/harvestapi/linkedin-profile-search-by-services` | $0.01/result | unknown | body; `search`, `locations`, `maxItems` |
| apify | `/harvestapi/linkedin-profile-search` | varies | stable 1.6m | slow, price varies; skip |

Output (`/linkedin/search`): `data.items[].{fullName,headline,location,profileUrl,publicIdentifier}`; `data.cursor`. No email or phone in search results. ALWAYS set `limit` (default 25 = $0.25).

## 7. Reddit

| Provider | Endpoint | Price | Health | Input |
|---|---|---|---|---|
| **anyapi** (RECOMMENDED) | `/reddit.search` | $0.00035/call (default route bison) | stable 4.6s | body; `query` (required; supports `subreddit:sanfrancisco`, `author:`), `sort`, `timeframe`, `cursor`, `route` |
| anyapi | `/reddit.subreddit_search` | $0.00035/call | stable | body; `subreddit` (required), `query` |
| anyapi | `/reddit.subreddit_posts` | $0.00038/call | healthy | body; `subreddit` (required), `limit`, `sort` (e.g. r/forhire new) |
| anyapi | `/reddit.user_posts` | ~$0.00038 | stable | body; username |

Output: `data.posts[].{title,selftext,author,subreddit,permalink,url,score,numComments,createdUtc}`, `data.nextCursor`. Reddit gives no contact info; use as lead signal (people posting wanting gig work) and contact via Reddit DM only.

## 8. X/Twitter, Facebook, Instagram

| Provider | Endpoint | Price | Health | Input |
|---|---|---|---|---|
| **anyapi** | `/twitter.search` | $0.0001-$0.0006/call | healthy | body; `query` (required), `limit`, `queryType` |
| anyapi | `/twitter.search_users` | $0.0001-$0.0007 | healthy | body; `query` |
| **anyapi** | `/facebook.page_lookup` | $0.00975+/call | stable | body; `query`, `limit` |
| anyapi | `/facebook.group_posts` | $0.0012+ | healthy | body; `url` (group URL) |
| anyapi | `/facebook.marketplace` | $0.0012+ | stable | body; `query`, `lat`, `lng` (strings) |
| **anyapi** | `/instagram.search_profiles` | $0.0012+ | stable, slow 21s | body; `query` (bio/category text) |
| anyapi | `/instagram.profile` | $0.001+ | stable | body; `handle` |
| anyapi | `/instagram.profile_contact` | $0-$0.00175 | stable | body; `handle` |

RECOMMENDED: anyapi for all three (one provider, uniform body-JSON). Instagram: `search_profiles` then `profile_contact` for public business email/phone. Not run.

## 9. Freelancer / job marketplaces

| Provider | Endpoint | Price | Health | Input |
|---|---|---|---|---|
| anyapi | `/upwork.jobs` | $0.0011-$0.007 | healthy 19.7s | body; `query`, `limit`, `location` (job postings, not freelancers) |
| anyapi | `/indeed.jobs` | $0.00009-$0.00125 | stable 5.3s | body; `query`, `location`, `limit` (job postings) |
| anyapi | `/facebook.marketplace` | see above | | |

These are demand-side postings (people hiring), not worker profiles. Weak fit.

## 10. General web search (fallback)

| Provider | Endpoint | Price | Health | Input |
|---|---|---|---|---|
| **litescrape** (RECOMMENDED) | `/google/search` | $0.00015/call | healthy 5.5s | query; `q`, `location` or `lat`/`lon`/`radius`, `num`, `gl`, `hl` |
| mrscraper | `/serp/google` | $0.001 | healthy 22s | not inspected |
| cloro | `/google/search` | $0.008 | stable | not inspected |

Use `site:linkedin.com/in notary "San Francisco"`, `site:yelp.com`, `site:thumbtack.com` style queries here to reach directories that have no endpoint.

## Not available in Monid

- Thumbtack, TaskRabbit, Fiverr, Nextdoor: no endpoint (discover returned unrelated results). Use Google SERP `site:` queries.
- Notary directories and professional license lookup (California SOS notary, state license boards): none. Closest: LinkedIn search for "notary", Google Maps category "Notary public".
- Real carrier line-type lookup (mobile vs landline): only numbering-plan inference (strale).
- Craigslist: none, and we will not scrape it.
- Free geocoder: only paid ones ($0.02).

## Spend

Balance before: $11.00. After: $10.96 (CLI displays 2 decimals; sum of run costs below is $0.0372).

| Run | Cost |
|---|---|
| litescrape /google/maps (earlier tested run) | $0.0001 |
| anyapi /maps.search_nearby (photographer, SF) | $0.0013 |
| hunterio /domain-search (kineticevents.com, limit 5) | $0.0245 |
| search1api /crawl (kineticevents.com) | $0.0010 |
| ploid /linkedin/search (notary, SF, limit 1) | $0.0100 |
| anyapi /reddit.search | $0.0003 |

Fixtures: `litescrape__google_maps.json`, `anyapi__maps.search_nearby.json`, `hunterio__domain-search.json`, `search1api__crawl.json`, `ploid__linkedin_search.json`, `anyapi__reddit.search.json`.
