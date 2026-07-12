# PMAN — All-in-One Property Management

A mobile app (Android / iOS / web) for property managers, with a full tenant portal.

- **Manager side** — dashboard, rent roll (who paid / who didn't), properties & units, tenants, leases, rent increases/decreases, payments, late fees, maintenance, expenses, reports & authenticated CSV export, document uploads, announcements, tenant messaging.
- **Tenant side** — invite-code signup, **submit proof of payment** (amount/method/date + screenshot) for manager review, receipts & statement export, balance & ledger, lease documents, renewal countdown, two-way messaging, maintenance requests with photos, local rent reminders.

## Live web preview

The web front-end auto-deploys to **GitHub Pages** → **https://d3d34d.github.io/pman/**

> ⚠️ **This is a UI preview only.** GitHub Pages serves static files, so the Fastify + SQLite **API cannot run there**. The app loads and you can browse the welcome / sign-in screens, but logging in and data won't work until the API is hosted (Render/Railway/etc.) and `EXPO_PUBLIC_API_URL` points at it. To run the real thing, use the Quick start below. See [SHIPPING-ANDROID.md](SHIPPING-ANDROID.md) for the hosting steps.

## Structure

```
apps/api      Fastify + Prisma (SQLite) REST API — business logic, money math, payments
apps/mobile   Expo SDK 54 (React Native + TypeScript) — manager UI + tenant portal
```

The native `android/` (and `ios/`) directories are **generated**, not committed (Expo's CNG model) — recreate them with `npx expo prebuild -p android`.

## Quick start

```bash
npm install       # installs both workspaces
npm run seed      # demo data: 2 properties, 6 units, leases, payments, a saved card, a message thread
npm run api       # API on http://localhost:4000
npm run mobile    # Expo — press w for web, a for Android, or scan the QR with Expo Go
```

Demo logins (after seeding):

| Role    | Email             | Password      |
|---------|-------------------|---------------|
| Manager | manager@pman.dev  | `password123` |
| Tenant  | tenant@pman.dev   | `password123` |

Invite code `WELCOME1` exercises the tenant signup flow. Registration is open — create your own manager account to start fresh.

Scan `expo-qr.png` in the repo root with Expo Go (regenerate it after an IP change with `npm run qr`).

## Security

Auth and payments are hardened and covered by a dedicated test suite (`test/security.test.ts`):

- **Sessions** — JWTs expire (30 days) and carry a `tokenVersion`. Changing a password (or `POST /auth/logout-all`) bumps the version, instantly revoking every existing token on every device. Deleted users' tokens stop working immediately.
- **Secrets** — in `NODE_ENV=production` the server refuses to boot with a missing, short, or default `JWT_SECRET` (set a 32+ char value).
- **Passwords** — bcrypt (cost 12), minimum 8 chars, 72-byte cap enforced (not silently truncated). Login runs a constant-time compare even for unknown emails, so timing doesn't reveal which emails are registered; the error message is identical for wrong-password and unknown-email.
- **Rate limiting** — 300 req/min globally, 10/min on the credential endpoints (`/auth/*`), which throttles brute-force and invite-code guessing.
- **Payment idempotency** — keys are scoped to the lease *and* the source, so one tenant's key can never replay another tenant's payment, and a tenant can't forge the autopay slot. A per-payment amount cap and a member-of-lease check on the card round it out.
- **Files** — uploads are validated against a type allowlist (PDF/PNG/JPG/WEBP/HEIC) and served only through short-lived **signed URLs** (1-hour expiry); there is no public file endpoint, and path traversal is rejected.

Production checklist: set a strong `JWT_SECRET`, run behind HTTPS, restrict CORS to your app's origin, and move uploads to object storage with real signed URLs.

## Running on Android

The API binds `0.0.0.0`, and the app derives the API host from whatever machine serves the JS bundle — so a phone on the same Wi-Fi just works.

**Expo Go (fastest, nothing to install on your machine):**

1. Install **Expo Go** from the Play Store.
2. Put the phone on the same Wi-Fi as this machine.
3. `npm run api` in one terminal, `npm run mobile` in another.
4. Scan the QR code with Expo Go.

The project targets **Expo SDK 54** so it runs in the standard Expo Go from the Play Store. (If Expo Go shows "incompatible SDK version", your Expo Go supports a different SDK than the project — matching them is what SDK 54 is for.)

**Native dev build** (`npm run android` → `expo run:android`) additionally needs the Android SDK and **JDK 17 or 21** — Android Gradle does not support JDK 25. Debug builds allow cleartext HTTP so they can reach the dev API; release builds require HTTPS, which is the correct default.

To point the app at a specific API, set `EXPO_PUBLIC_API_URL`. On an Android **emulator**, `localhost` is the emulator itself; the app automatically rewrites it to `10.0.2.2` (the host machine).

## How the money works

- All amounts are integer **cents**; a billing month is a **period** (`"2026-07"`).
- A lease's rent lives in **RentTerm** rows — a rent change appends a new dated row, so history is auditable and past months keep their original rent. A change applies from its effective month forward.
- **Charges** (rent, late fees, one-off) are generated idempotently on demand — one rent charge per lease-month, no cron needed. No proration: partial months bill in full.
- **Payments** aren't earmarked; they apply FIFO to the oldest charges. Partial payments, credits, and "who owes what since when" fall out of the allocation.
- **Late fees** auto-apply once a rent charge is still unpaid past the due date + grace period, exactly once per month.
- "Owed today" (`dueNowCents`) counts only charges due on or before today, so pre-generated future months never show as debt.

## Paying rent (submit-and-approve)

There's no card processor in v1. Tenants pay however they already do (Zelle, bank transfer, cash, check), then **submit proof** in the app; the manager reviews and approves it into the ledger.

- Tenant → **Pay rent → Submit a payment**: amount, method, date, reference/note, and a **screenshot** of the transfer. Creates a `PaymentSubmission` (PENDING).
- Manager is **alerted** (push + email — see below), then reviews under **Payment approvals** (also surfaced on the dashboard): sees the details + screenshot, then **Approve** (writes a real `Payment` into the ledger, clearing the balance and issuing a receipt) or **Reject** with a reason the tenant sees.

The card-processing path is deliberately deferred but not thrown away: a `PaymentProvider` seam (`apps/api/src/payments/`) with a mock gateway and a Stripe REST adapter is still in the codebase behind `PAYMENT_PROVIDER`, ready to switch on later. Real card entry would require Stripe's on-device SDK for PCI compliance.

### Notifications (`apps/api/src/notify/`)

The whole review loop is wired for **push** and **email**, both behind provider seams:

- **Manager** is alerted when a tenant **submits** a payment.
- **Tenant** is alerted when the manager **approves** (with the receipt number) or **rejects** (with the reason) their submission.

Channels:

- **Push** — Expo push to the user's registered devices (keyless). Each device registers its token on login (`POST /me/push-token`); both managers and tenants register. Note: Expo Go can't receive remote push on SDK 53+; it lights up in a dev/production build with an EAS `projectId`.
- **Email** — defaults to a **console transport** that logs the message (so you can watch it work in dev with no account). For real delivery set `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, and `EMAIL_FROM` (Resend REST, no extra dependency). When a tenant has no portal account, the email falls back to their profile contact address.

All notifications are best-effort and fire-and-forget: a failure never blocks or fails the underlying action.

Every alert is also **persisted** to a `Notification` row, so users have an in-app **notification center** (under More / Account) with a history and unread badges — they see activity even if they missed the push. `GET /me/notifications` returns the list + unread count; opening the center marks all read (`POST /me/notifications/read-all`), which clears the tab-bar badge.

## Tests

```bash
npm test   # 76 tests
```

Covers charge idempotency, rent-change effective dating, late fees, FIFO allocation, `dueNowCents`, the payment-submission → approval → ledger flow (and reject), the manager alert on a new submission and the tenant alert on approve/reject, cross-tenant/cross-manager scoping, JWT expiry + revocation, account deletion, role scoping, and the invite flow. The deferred card gateway is also covered (Luhn/brand, declines, idempotency, autopay).

## Notes

- **CSV export** (manager reports, tenant statement) is fetched with the caller's token and delivered as a browser download (web) or the share sheet (native). These endpoints reject unauthenticated requests.
- **Document uploads** accept PDFs and images and are stored under `apps/api/uploads/` (git-ignored) with unguessable filenames, served from `/files/:name`.
- **Rent reminders** are scheduled locally on the tenant's device. The web build shows a "use the app" note instead.
- **Stripe & PCI:** the Stripe adapter creates a PaymentMethod from a raw card server-side, which Stripe permits with **test** keys. In production the card must be tokenized on the device (Stripe Elements / PaymentSheet) and only the resulting `pm_...` id sent to the server. `charge()` needs no changes. This is documented in `apps/api/src/payments/stripe.ts`.

## Not in v1 (by design)

Tenant screening, listing syndication, accounting integrations, proration, owner statements, hosted deployment, refunds/chargebacks, and moving uploads behind signed URLs on cloud storage.
