# Google Play — store listing (ASO-optimised)

Paste-ready copy for **Play Console → Grow → Store presence → Main store listing**.
All character counts are verified and within Play's limits.

---

## How ranking actually works on Play

Play indexes **three** text fields. There is no keywords field (that's iOS).

| Field | Limit | Search weight | Also affects |
|---|---|---|---|
| App name | 30 | **Highest** | First impression |
| Short description | 80 | **High** | Conversion — shown under the title |
| Full description | 4000 | Moderate | Conversion — first 3 lines shown before "Read more" |
| Developer name | 50 | Low | — |

Two rules that matter more than volume:

1. **Repeat naturally, don't stuff.** Play penalises keyword spam, and it reads as
   spam to users too. 4–8 mentions of a primary term across 4,000 characters is
   plenty.
2. **Text only gets you impressions.** Installs, retention, ratings and reviews
   drive ranking long-term. A listing that converts beats one that's merely
   keyword-dense.

### Keywords this listing targets

Counts below are **measured** from the full description text, not estimated.

| Priority | Term | In title | In short | Full desc | Density |
|---|---|---|---|---|---|
| Primary | rent *(all forms)* | ✅ | ✅ | 22 | 3.5% |
| Primary | tenant / tenants | — | ✅ | 17 | 2.7% |
| Primary | lease / leases | — | ✅ | 10 | 1.6% |
| Primary | landlord / landlords | option B | ✅ | 4 | 0.6% |
| Primary | rent tracker | option B | ✅ | 2 | 0.3% |
| Primary | track rent | — | ✅ | 2 | 0.3% |
| Secondary | tenant portal | — | ✅ | 4 | 0.6% |
| Secondary | property manager | ✅ | — | 3 | 0.5% |
| Secondary | property management | — | ✅ | 3 | 0.5% |
| Secondary | rent collection | — | — | 2 | 0.3% |
| Secondary | rental property | — | — | 2 | 0.3% |
| Long-tail | maintenance | — | — | 4 | 0.6% |
| Long-tail | rent roll · late fees · rent ledger · rental income | — | — | 1 each | — |

Healthy range is roughly **0.5–3%** per term. Everything above sits inside it —
"rent" and "tenant" are higher only because they're the product's core nouns and
unavoidable in normal prose, which reads naturally rather than stuffed.

Re-measure any time you edit the copy — it also checks every field against
Play's character limits, so you can't paste something that will be rejected:

```bash
npm run store:seo
```

---

## App name (max 30)

**Recommended:**

```
PMAN: Rent & Property Manager
```
*(29 characters)*

Keeps your brand while capturing "rent" and "property manager" — the two terms a
landlord is most likely to type.

**Alternatives:**

```
PMAN: Landlord & Rent Tracker
```
*(29 — trades "property manager" for "landlord" + "rent tracker")*

```
Rent Tracker: Landlord & Lease
```
*(30 — maximum discoverability, drops the brand entirely)*

> For a brand-new app, keywords beat brand: nobody is searching "PMAN" yet. If you
> later build recognition, you can move the brand forward. Renaming is allowed at
> any time and doesn't reset your listing.

---

## Short description (max 80)

This is the highest-leverage 80 characters you'll write — it's both a strong
ranking signal and the line that decides whether people tap.

**Recommended:**

```
Landlord app to track rent, leases & tenants — with a free tenant portal.
```
*(73 characters)*

**Alternatives:**

```
Rent tracker for landlords: manage leases, tenants & payments in one app.
```
*(73 — leads with "rent tracker")*

```
Track rent, leases & tenants. Free property management app with a portal.
```
*(73 — leads with the action, includes "property management app")*

---

## Full description (max 4000)

The first three lines show before "Read more" — they carry the primary keywords
*and* the hook.

```
PMAN is a free property management app for landlords and property managers —
with a tenant portal built in, not bolted on.

Track rent, leases, tenants and maintenance in one place, and know at a glance
exactly who has paid and who hasn't.

Stop running your rental property out of a spreadsheet, a folder of screenshots
and a group chat.


▸ A RENT TRACKER THAT ACTUALLY ADDS UP

Built to track rent against real tenancies, not as a generic checklist:

• Rent roll for any month — see who paid, who is short, and who is late
• Automatic late fees, applied once per month and only after the grace period
• Rent increases and decreases with an effective date, so past months keep the
  rent they were really billed at
• A full rent ledger per lease: every charge, every payment, running balance
• Payments apply oldest-first, so partial payments and credits just work


▸ RECORD RENT PAYMENTS, NO PROCESSOR NEEDED

Tenants pay however they already do — bank transfer, Zelle, cash or cheque —
then submit the amount, date and a screenshot as proof. You review it and
approve it into the ledger in one tap, or reject it with a reason. Every step
is logged in the in-app notification centre for both sides.

Rent collection stays in your control: no card processing, no payment fees and
nothing to wait on.


▸ LEASE MANAGEMENT AND TENANTS

• Fixed-term or month-to-month leases with deposits, due day and grace period
• Add, edit and archive tenants without losing their payment history
• Leases expiring in the next 90 days, surfaced before they catch you out
• Private notes per tenant, and emergency contact details
• Invite tenants to the portal with a one-time code


▸ PROPERTY MANAGEMENT, MAINTENANCE AND EXPENSES

Everything else a rental property needs, in the same app:

• Organise buildings and units with beds, baths, size and market rent
• Occupancy at a glance across your whole rental portfolio
• Maintenance requests from open to resolved, with vendor and cost
• Log expenses per property and see rental income vs expenses by month
• Export CSV for your accountant or your tax return
• Store leases and documents against the right tenant or unit
• Announcements to a whole building, or a message to one tenant


▸ THE TENANT PORTAL YOUR TENANTS WILL ACTUALLY OPEN

Every tenant gets their own free tenant portal login:

• Their balance in plain language — owed, paid, and when rent is next due
• Submit a rent payment with proof, and get a receipt once it's approved
• Their lease, deposit and documents in one place instead of an email thread
• Report maintenance with photos and follow the progress
• Message their property manager in a single thread


▸ BUILT TO BE TRUSTED WITH RENT DATA

• Separate, secure sign-in for landlords and tenants
• A tenant only ever sees their own lease, balance and documents
• Passwords are hashed; changing yours signs out every device
• Documents are private, served only through short-lived signed links
• No ads. No trackers. No analytics SDKs. Your data is never sold
• Delete your account and personal data yourself, from inside the app

Money is handled in exact whole cents, and rent history is append-only — so a
rent change never silently rewrites what a tenant was billed last year.


▸ WHO IT'S FOR

Independent landlords, small property managers, and anyone managing rental
properties for themselves or for owners. Whether you are a landlord with one
spare room or running property management across a portfolio of units, PMAN
keeps the rent tracked, the leases straight and the paperwork findable.

A rent tracker, a lease manager and a tenant portal — free to use.

Questions or feedback: rronyy001@gmail.com
```

*(~3,450 characters — within the 4,000 limit)*

---

## Validate these keywords for free (10 minutes)

I've applied ASO principles, but I don't have live search-volume data. Check the
real thing before you publish — the Play Store's own autocomplete is free and
reflects actual queries, ranked by popularity:

1. Open the **Play Store app** (autocomplete differs from the web).
2. Type each seed term slowly: `rent`, `landlord`, `property man`, `rental`,
   `tenant`, `lease`.
3. Write down every suggestion that appears — those are real, popular searches.
4. If a suggestion fits the app better than a term above (e.g. "rent manager" or
   "landlord tracker" outranks "rent tracker"), swap it into the **title** and
   **short description** first.
5. Search your top 3 terms and look at who ranks. Read their titles and short
   descriptions — that's your competitive set.

Free tools with usable limits if you want numbers: AppTweak, Sensor Tower, or
AppFollow trials.

---

## Graphics

| Asset | Spec | Status |
|---|---|---|
| App icon | 512×512 PNG, 32-bit | ✅ `store/assets/play-icon-512.png` |
| Feature graphic | 1024×500 | ✅ `store/assets/feature-graphic.png` |
| Phone screenshots | 2–8, 320–3840px | ✅ 6 at 1080×1920 in `store/assets/screenshots/` |
| Tablet screenshots | Optional | Skip — declare phone-only |

Regenerate everything with `npm run store:assets`.

### Screenshot captions (conversion, not ranking)

Most people judge from the first two screenshots without reading a word of the
description. If you overlay captions, keep them under five words:

1. `01-dashboard` — "Know where you stand"
2. `02-rent-roll` — "Who paid. Who didn't."
3. `03-properties` — "Every unit, organised"
4. `04-tenants` — "Tenants and leases together"
5. `05-tenant-home` — "Tenants see their balance"
6. `06-tenant-pay` — "Submit proof, get a receipt"

> Screenshot text is **not** indexed for search — it's purely conversion. But
> conversion feeds ranking, so it matters indirectly.

---

## Categorisation

| Field | Value |
|---|---|
| App or game | App |
| Category | **Business** (Finance is also valid but invites extra financial-policy scrutiny) |
| Tags | Property management, Rentals, Real estate |
| Contact email | rronyy001@gmail.com |
| Website | https://d3d34d.github.io/pman/ |
| Privacy policy | https://d3d34d.github.io/pman/privacy.html |

> **Developer name is indexed too.** If your Play developer account is still
> something generic, renaming it to include a keyword (e.g. "PMAN Property
> Software") is a small, free ranking gain.

---

## Notes for the reviewer (App content → App access)

Reviewers must be able to sign in, or the app is rejected. Paste this into
**App access → All or some functionality is restricted**:

```
PMAN has two separate sign-in areas. Demo credentials for review:

Property Manager
  Email: manager@pman.dev
  Password: password123

Tenant
  Email: tenant@pman.dev
  Password: password123

Both accounts are pre-loaded with sample properties, leases and payments.
No other steps are needed — there is no paywall and no in-app purchase.

A browser version of the same app (sample data, no server) is at
https://d3d34d.github.io/pman/ if that is easier to inspect.
```

> These accounts must exist on your **production** API before you submit
> (`fly ssh console -C "npm --prefix /app/apps/api run seed"`).

---

## After launch — the levers that actually move ranking

Text gets you found; these keep you there.

1. **Ratings.** Prompt for a review after a *successful* moment — a manager
   approving a payment, or a tenant getting a receipt. Never on launch.
2. **Reply to every review.** Replies are indexed and visibly lift ratings.
3. **Retention.** Play weights apps people keep. The payment-approval loop is your
   natural monthly re-engagement — push notifications matter here.
4. **Iterate the short description.** Change it, wait 2–3 weeks, compare
   conversion in Play Console → Store performance. It's the cheapest test you have.
5. **Localise.** Each added language is a whole new keyword index. Spanish first
   if you're targeting US landlords.
6. **Custom store listings.** Play lets you serve different listings by country or
   install state — worth doing once you have traffic.

Track it all in **Play Console → Grow → Store performance**, which shows the
actual search terms bringing people to your listing. Revisit this file after your
first 100 installs with that real data.
