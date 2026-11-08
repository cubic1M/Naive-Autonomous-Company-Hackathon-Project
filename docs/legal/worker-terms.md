# Operis Worker Terms

**Draft for counsel review, not legal advice.** No lawyer has reviewed this, and it is not in effect. It takes
effect only once the job page names this version and the job's terms next to the Accept button and the API records
them. The two liability models follow the design the founders approved on 8 Nov 2026
(`docs/specs/2026-11-08-liability-model-design.md` on branch `claude/liability-model`); the code that picks a job's
model isn't built yet.

**Version:** `2026-11-08`

These terms cover every job you accept through Operis (operis.live). Operis is run mostly by AI agents. Its
founders set the limits, review proof the agents can't decide, and handle anything legal or safety-related.
_[Founders: add Operis's legal name and mailing address here.]_ The Privacy page (operis.live/privacy) covers the
rest of what we store about you and what you control.

## How these terms are organised

Every job has one of two liability models, which say who is responsible to the company for the work. Operis picks
the model for each job after the company has paid for it and before the job is offered to anyone. The job page shows
which one applies, and the line under the Accept button names it. The shared terms apply to every job, and then
exactly one set of job terms applies: [Operis jobs](#operis-jobs-operis) or
[connector jobs](#connector-jobs-connector).

## Shared terms (every job)

### You're independent

You work as an independent contractor, not an Operis employee. You choose which jobs to accept, and you can stop
at any time. You decide whether to take a job and when to do it before its deadline, using your own phone and
tools. There's no minimum number of jobs and no schedule, and you're free to work for anyone else. Who your client
is depends on the job: see the job terms below.

### Choosing jobs

- We tell you about jobs by email, by text (only if you agreed to get texts), or by a direct message on a
  professional or social site.
- Every message lets you opt out. Reply STOP, or tell us you're not interested, and we won't contact you again.
- Each message has a personal link to the job page. Anyone who has your link can accept the job and upload proof
  as you, so don't share it.
- Several people may get the same job. The first person to accept gets it.
- You never have to accept. You can decline, tell us why, or ignore the message.
- To accept, tap Accept on the job page. Replying YES to a text doesn't accept a job: we text you the link instead.

### Doing the job

- Do the job as described, before the deadline.
- Upload honest proof: taken by you, on site, at the time.
- Licensed work is done under your own license, in your own name (see connector jobs).
- Never sign contracts, pass CAPTCHAs, receive one-time codes or pretend to be the company's agent.
- If the deadline passes before you upload proof, the job ends and isn't paid. There's no penalty fee.

### Your proof

- Upload the photos, video or files the job asks for. For on-site jobs, upload them from the job location: the
  proof page needs your phone's location before it can send proof.
- Don't reuse photos from another job or from the internet. Reused photos are rejected.
- Software checks your proof: the distance from the job address, when the photos were taken, the job's
  checklist, and a score from an AI model that looks at the photos. That AI model runs at an outside AI provider.
- Proof taken outside the job's distance limit is rejected. Proof that isn't clear goes to a person at Operis
  to decide.
- You keep ownership of your photos and files. By uploading them, you let Operis use them to check the job, give
  them to the company that posted the job to use for what the job was for, and use them as evidence if a payment
  is disputed.

### Getting paid

- The company that posts a job sets its price. For most jobs you get 75% of the posted price, and Operis keeps 25%
  as its fee: a $60 job pays you $45, and Operis keeps $15. Notary and legal jobs pay differently (see connector
  jobs). The smallest job is $3.
- The pay you see in our message and on the job page is your share. We don't take card fees out of it.
- The job's pay is held before you start: the company's card is authorized (not charged) through Stripe before
  the job is sent to anyone. When your proof is approved, the card is charged and we send your share through
  Stripe. Stripe then pays it into your bank account on its own schedule.
- For your first payout, you connect a bank account through Stripe's own sign-up. Stripe asks for your identity
  and tax details there, under its own agreement with you. Your pay waits until you finish.
- If your share of one job is over $150, the payout needs an extra approval inside Operis before it's sent.
- Pay is in US dollars.

### If proof is rejected, a job expires, or a charge is disputed

- If your proof is rejected (faked, taken somewhere else, reused, or doesn't match the job), you're not paid, and
  the company's card isn't charged or the company is refunded. Repeat issues can close your account.
- If you think we got a decision wrong, email ops@operis.live.
- If a company disputes the charge with its bank, or gets a refund, after you were paid for approved work, you
  keep your pay. We handle the dispute and may use your proof as evidence.
- If we find your proof was faked, we may ask you to pay it back, and we may close your account.

### Your location, device and ID data

What we collect, and why:

- **Location.** The proof page reads your phone's location (GPS) when it opens and again when you send proof. We
  store the location, how accurate it was and when it was read, to check you were at the job.
- **Your files, as they are.** We keep your original files, so anything your phone saved inside them stays
  there. That's usually when a photo was taken, often where (if your camera saves location), and the phone or
  camera model. We read the time and place to check the job.
- **Times.** We record when your files were last changed on your phone and when you sent the proof.
- **Your ID, for some jobs.** Jobs with a posted price over $150 (your share over $112.50), and jobs that need a
  license or certification, need a verified identity before we can approve your proof. You photograph a
  government ID and take a selfie on Stripe Identity's page. Stripe keeps the ID images and the selfie. We keep
  the result, the first and last name on the ID, Stripe's reference numbers and, if a check fails, Stripe's
  reason. We use that name to check a notary commission against the state's list.
- **When you accept.** See "What we record when you accept" below.

Who sees it:

- The company that posted the job gets your proof files (with everything saved inside them), your checklist
  ticks and typed answers, the accuracy and time of your location reading, and our verification score. It gets
  an Operis worker id, not your name, phone, email or ID.
- The outside AI provider that scores proof sees your photos.
- If a payment is disputed, Stripe and the card company may see your proof.
- Proof files are stored at links that are hard to guess but not password-protected: anyone who has a link can
  open the file.

How long we keep it: we don't delete this data on a schedule yet. You can ask us to delete yours at
ops@operis.live. We may need to keep some records, for example for payments, taxes or disputes.

### What we record when you accept

When you tap Accept, we record which version of these terms was next to the button, which job terms it named (an
Operis job or a connector job), the time, and the internet (IP) address the request came from. That's our record of
what you agreed to for that job.

### Safety and your right to say no

- You can turn down any job, and you can stop a job that feels unsafe. Your safety comes first.
- Don't break the law, go onto private property without permission, or put yourself or anyone else at risk to
  finish a job.
- In an emergency, call 911 first. Then tell us at ops@operis.live.
- If you stop a job, it isn't paid, and there's no penalty fee.
- Operis doesn't provide insurance for you.

### Jobs we don't allow

We screen job requests for these, but our filter can miss things. If a job looks wrong, decline it and tell us.

- Illegal work.
- Identity work: CAPTCHAs, one-time or verification codes, creating accounts or logging in for someone, or
  pretending to be someone else.
- Handling other people's cards, bank logins or ID documents.
- Surveillance: following or photographing a specific person, going onto private property, or recording private
  conversations.
- Licensed work by people who don't hold the license.
- Regulated or dangerous work we don't take at all: electrical wiring, medical advice or procedures, legal advice,
  driving passengers, weapons and drugs.
- Signing contracts, leases or filings on anyone's behalf.

### Taxes

You're responsible for your own taxes. We don't withhold any tax from your pay. If US tax rules require it, we'll
send you a tax form, such as a Form 1099-NEC, through Stripe.

### Changes to these terms

These terms have a version id (this one is `2026-11-08`). Each job is covered by the version and the job terms
named next to the Accept button when you accepted it. If we change the terms, the new version applies only to jobs
you accept after that.

### Contact us

Email ops@operis.live about a job, proof or payout, or to opt out. _[Founders: add the legal name and mailing
address.]_

## Job terms (one set per job)

### Operis jobs (`operis`)

- Operis is your client. You do the work for Operis as an independent contractor.
- Operis provides the service to the company that posted the job and is responsible to that company for the job.
- Operis jobs never need a professional license, because Operis holds none. If an Operis job looks like it needs
  one, decline it and tell us.
- Pay works as described in "Getting paid".

### Connector jobs (`connector`)

- Connector jobs are for work the law won't let Operis be responsible for, because Operis holds no professional
  licenses: notarial acts and legal work. A job is also a connector job when our compliance check can't confirm
  that Operis can be responsible for it.
- You provide the service to the company that posted the job, under your own license where one applies, and in
  your own name. The company is your client.
- You're responsible for the work and for following the rules of your license.
- Before you can accept a notary or legal job, we check your license: a notary commission against the state's
  list, or an attorney's license against the State Bar's public profile.
- Operis is the marketplace. It connects you with the company, checks your proof and handles payment as your
  payment agent: it collects the price from the company for you and pays you your share.
- Operis isn't responsible for the work itself and doesn't give professional advice. If the company is unhappy
  with the work, we pass that on to you as the provider, with our records of the job. We refund the company only
  for work that wasn't delivered.
- For notary and legal jobs, you get the whole posted price, and the company pays Operis's platform fee on top.
  Other connector jobs pay as described in "Getting paid". Either way, the card hold and payment after approved
  proof work as described there.

## Questions for counsel

1. **Contractor classification (California).** In Operis jobs, Operis is the worker's client; in connector jobs,
   the posting company is. Operis sets the fee and the proof rules, and the posting company, not the worker, sets
   the price. Does the ABC test (Labor Code §2775) apply in each model, can we meet prong B (work outside our usual
   course of business) for Operis jobs, and does the referral-agency exemption (§2777) fit connector jobs?
2. **Photo licence scope.** What may the posting company do with proof files: keep them, publish them, train
   models on them? The files reach it with their embedded location and device data, and they may show
   bystanders, faces or licence plates.
3. **Retention of ID and GPS data.** Nothing is deleted automatically today. What notice at collection,
   retention periods and deletion process do we need, given that proof GPS is precise geolocation and Stripe
   Identity takes a selfie?
4. **Clawback after payout.** Today a worker keeps pay after a later refund or chargeback. Can we recover pay for
   faked proof after it reaches their Stripe account, and what must these terms say for that?
5. **Insurance.** Operis jobs make Operis responsible to the company, and Operis has no insurance today: what
   cover do we need first (liability, occupational accident)? For connector jobs, should we require the worker's
   own bond or insurance?
6. **How acceptance is shown.** Is "By accepting you agree to the Worker Terms" under the Accept button, with a
   link, enough for a person who has no account, or do we need a checkbox? Would a YES text reply that links the
   terms ever be enough?
7. **How the liability model is decided.** A Compliance agent will pick `operis` or `connector` for each job after
   funding, under a versioned policy. When it's unsure, or decides nothing in time, the job becomes a connector job,
   which makes the worker responsible even for ordinary work. Is that fair and enforceable? What criteria and records
   does the decision need, is an AI agent's decision enough, and what happens if a job lands in the wrong model?
8. **What each model means in practice.** In Operis jobs, what does the worker still answer for (their own
   negligence, damage they cause)? In connector jobs, should the terms say that the company's payment to Operis
   counts as payment to the worker (the usual payment-agent clause), and what must the posting company's own terms
   say in each model?
