# Shipping PMAN to the Google Play Store

A step-by-step path from the current dev build to a published Android app. Items marked **[you]** need your accounts/decisions; **[done]** is already in the repo; **[code]** is work I can do next on request.

## Where things stand

- **[done]** Expo SDK 54 app that runs in Expo Go; Android package `dev.pman.app`, `versionCode 1`.
- **[done]** EAS build profiles in `apps/mobile/eas.json` (preview = sideloadable APK, production = Play AAB).
- **[done]** In-app **account deletion** (Play requires this for any app with accounts) and separate manager/tenant sign-in.
- **[done]** API hardened (JWT expiry + revocation, rate limiting, signed file URLs, per-tenant payment isolation). 63 automated tests.

## 1. Host the backend  **[you + code]**

The app can't ship pointing at a laptop. You need the API reachable over **HTTPS**.

- **[you]** Pick a host (Render, Railway, Fly.io are simplest) and a managed **Postgres** database.
- **[code]** I switch Prisma from SQLite to Postgres (a provider + connection-string change and a real migration), and add a deploy config (Dockerfile / render.yaml) and file storage on S3/R2. Ask me and I'll do it.
- **[you]** Set env on the host: `DATABASE_URL`, a strong `JWT_SECRET` (32+ chars — the server refuses to boot in production without one), `PAYMENT_PROVIDER`, storage keys.
- **[you]** Note the public API URL, e.g. `https://api.yourdomain.com`.

Then set that URL in `apps/mobile/eas.json` (replace `https://REPLACE-WITH-YOUR-API-HOST` in the `preview` and `production` profiles).

## 2. Real payments (only if tenants pay in-app)  **[you + code]**

- **[you]** Create a Stripe account; get `sk_live` / `pk_live` keys; connect a bank.
- **[code]** Move card entry to Stripe's on-device SDK (PaymentSheet). Today the card form posts card numbers to our server — fine for the mock, **not allowed for real cards** (PCI). This is a required change before real payments. The provider seam is already there (`PAYMENT_PROVIDER=stripe`).
- If tenants won't pay in-app yet, skip this and hide the Pay screen — managers can still record payments manually.

## 3. Google Play account & signing  **[you]**

- **[you]** Create a **Google Play Developer account** — $25 one-time.
- **[you]** Create an **Expo account** (free) for EAS Build.

## 4. Build the app  **[you, one command each]**

From `apps/mobile`, after `npm i -g eas-cli` and `eas login`:

```bash
eas init                       # links this project to your Expo account (writes projectId)
eas build --platform android --profile preview      # → installable APK to sideload & test
eas build --platform android --profile production   # → .aab for the Play Store
```

The **preview APK** is the fastest real-device test: download it from the EAS build page and install on your phone (no Play needed). Do this before submitting.

## 5. Store listing assets  **[you]**

- App icon (already in `assets/`), a 512×512 icon, a 1024×500 feature graphic, and **phone screenshots** (Play requires at least 2).
- Short + full description, category (Business/Productivity).
- **Privacy Policy URL** (required). You collect email, name, and — if payments are on — payment data; the policy must say so, and Play's **Data Safety** form must match.

## 6. Submit  **[you]**

```bash
eas submit --platform android --profile production   # uploads the .aab to Play
```

Then in the Play Console: complete Data Safety, content rating, target audience, and provide a **test login** for reviewers (a seeded manager and tenant). Start on the **internal testing** track, then promote to production.

## Recommended gaps before real users  **[code]**

These aren't strictly required to submit, but you'll want them fast:

- **Password reset** ("forgot password") — needs an email provider (Resend/Postmark/SendGrid). Endpoints + screens are ~an afternoon once you pick a provider.
- **Transactional email** generally — invites, receipts, reminders are in-app only right now.
- **Server-side push notifications** — current rent reminders are device-local; real apps push from the server (Expo push).
- **Error monitoring** — Sentry.

## Fastest realistic order

1. I migrate the API to Postgres + a deploy config; you deploy it and set env. **(unblocks everything)**
2. You set the API URL in `eas.json`, run `eas build --profile preview`, sideload, and confirm it works on your phone against the hosted API.
3. Decide on Stripe (in-app payments) vs. manual-only for v1.
4. Add password reset + a privacy policy.
5. `eas build --profile production` → `eas submit` → internal testing → production.

Tell me which step to take and I'll do the code parts (#1 Postgres/deploy, Stripe on-device, password reset).
