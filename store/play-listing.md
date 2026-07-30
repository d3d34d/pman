# Google Play — store listing

Paste-ready copy for **Play Console → Grow → Store presence → Main store listing**.
Character limits are enforced by Play; the counts below are already within them.

---

## App name (max 30)

```
PMAN — Property Management
```
*(26 characters)*

Alternative if you want the keyword up front:
```
PMAN: Rent & Property Manager
```
*(29 characters)*

---

## Short description (max 80)

```
Track rent, leases and tenants — with a portal your tenants actually use.
```
*(73 characters)*

---

## Full description (max 4000)

```
PMAN is an all-in-one property management app for independent landlords and
property managers — with a proper tenant portal built in, not bolted on.

Stop running your rentals out of a spreadsheet, a folder of screenshots and a
group chat.


FOR PROPERTY MANAGERS

• Rent roll at a glance — see exactly who has paid, who is short, and who is
  late, for any month.
• Dashboard — occupancy, rent collected vs billed, outstanding balances, open
  maintenance and payments waiting on your review.
• Properties and units — organise buildings, units, beds, baths and market rent.
• Tenants — add and archive tenants, keep contact and emergency details, and
  jot private notes.
• Leases — fixed-term or month-to-month, deposits, due day, grace period and
  late fees.
• Rent increases and decreases — enter a new rent with an effective date. Past
  months keep the rent they were actually billed at, so your history stays
  honest.
• Automatic late fees — applied once per month, only after the grace period.
• Payment approvals — tenants submit what they paid with a screenshot; you
  approve it into the ledger in one tap, or reject it with a reason.
• Maintenance — track requests from open to resolved, with vendor and cost.
• Expenses and reports — log spending per property, see income vs expenses by
  month, and export CSV for your accountant.
• Documents — keep leases and paperwork attached to the right tenant or unit.
• Announcements and messaging — reach one tenant or a whole building.


FOR TENANTS

• Your balance, in plain language — what you owe, what you have paid, and when
  rent is next due.
• Submit a payment — pay however you already do (bank transfer, Zelle, cash,
  cheque), then record it with a screenshot. Your manager reviews and confirms.
• Receipts and statements — every approved payment, with a downloadable
  statement.
• Your lease — terms, dates, deposit and documents in one place instead of
  buried in an email thread.
• Maintenance requests — report a problem with photos and follow its progress.
• Message your manager — one thread, so nothing gets lost.


HOW PAYING RENT WORKS

PMAN does not process card payments and never asks for your card or bank
details. Tenants pay by whatever method they already use, then submit the
amount, date, method and a screenshot as proof. The manager approves it, the
ledger updates, and the tenant gets a receipt. Both sides get a notification at
every step.


BUILT TO BE TRUSTWORTHY

• Separate, secure sign-in for managers and tenants.
• A tenant only ever sees their own lease, balance and documents.
• Passwords are hashed, sessions expire, and changing your password signs out
  every device.
• Uploaded documents are private — served only through short-lived signed links.
• No ads. No trackers. No analytics SDKs. Your data is never sold.
• Delete your account and personal data yourself, from inside the app.

Money is handled in exact whole cents, and rent history is append-only, so a
rent change never silently rewrites what a tenant was billed last year.


Free to use.

Questions or feedback: rronyy001@gmail.com
```

*(~3,050 characters — comfortably under the 4,000 limit)*

---

## Graphics checklist

| Asset | Spec | Status |
|---|---|---|
| App icon | 512×512 PNG, 32-bit | Use `apps/mobile/assets/images/icon.png` (export at 512×512) |
| Feature graphic | 1024×500 PNG/JPG | ✅ `store/assets/feature-graphic.png` |
| Phone screenshots | 2–8, 16:9–9:16, 320–3840px | ✅ 6 at 1080×1920 in `store/assets/screenshots/` |
| Tablet screenshots | Optional | Skip — declare phone-only |

Regenerate the graphics any time with:

```bash
npm run store:assets
```

### Suggested screenshot captions

If you overlay captions in Play Console, keep them to five words or fewer:

1. `01-dashboard` — “Know where you stand”
2. `02-rent-roll` — “Who paid. Who didn’t.”
3. `03-properties` — “Every unit, organised”
4. `04-tenants` — “Tenants and leases in one place”
5. `05-tenant-home` — “Tenants see their balance”
6. `06-tenant-pay` — “Submit proof, get a receipt”

---

## Categorisation

| Field | Value |
|---|---|
| App or game | App |
| Category | **Business** (alternative: Finance — Business avoids extra finance scrutiny) |
| Tags | Property management, Rentals, Real estate |
| Contact email | rronyy001@gmail.com |
| Website | https://d3d34d.github.io/pman/ |
| Privacy policy | https://d3d34d.github.io/pman/privacy.html |

---

## Notes for the reviewer (App content → App access)

Reviewers must be able to sign in. Paste this into **App access → All or some
functionality is restricted**, and keep the demo accounts alive on your server:

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

> Create these two accounts on your **production** API (`npm run seed` against
> it, or register them manually) before you submit. If the reviewer cannot log
> in, the app is rejected.
