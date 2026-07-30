# Shipping PMAN to Google Play

Everything in the repo is release-ready. What remains needs **your** accounts and
card, so it can't be automated from here. Work top to bottom — each step is
verifiable before you move on.

**Realistic time:** ~2 hours of work, then 1–7 days waiting on Google's first review.
**Cost:** $25 one-off (Play Console) + ~$0–5/month (API hosting).

---

## The one thing that matters most

A downloaded app has no dev server to talk to. **The API must be live on a public
HTTPS URL before you build the APK/AAB.** The app now refuses to produce a working
release without `EXPO_PUBLIC_API_URL` rather than silently pointing at `localhost`,
so do step 1 first.

---

## Step 1 — Put the API online

The API ships with a `Dockerfile` and `fly.toml`. Fly is suggested because a single
$0–3/month volume holds **both** the database and uploaded files, so nothing is lost
on redeploy. Any Docker host works.

```bash
# one-time
brew install flyctl && fly auth signup

fly launch --no-deploy --copy-config     # keep the app name it offers, or edit fly.toml
fly volumes create pman_data --size 1    # 1 GB: database + uploads
fly secrets set JWT_SECRET="$(openssl rand -base64 48)"
fly deploy
```

Confirm it's alive — this must return `{"ok":true,...}`:

```bash
curl https://YOUR-APP.fly.dev/health
```

Create the accounts Google's reviewer will use (and your own first login):

```bash
fly ssh console -C "npm --prefix /app/apps/api run seed"
```

> **Careful:** `seed` wipes and reloads demo data. Run it once, before you have real
> users, and never again on a live database.

<details>
<summary>Prefer Render / Railway / a VPS?</summary>

Point the host at the repo's `Dockerfile` (build context = repo root) and set:

| Variable | Value |
|---|---|
| `JWT_SECRET` | 32+ random chars — the server refuses to boot without it |
| `DATABASE_URL` | `file:/data/pman.db` on a **persistent disk** |
| `UPLOADS_DIR` | `/data/uploads` on the same disk |
| `NODE_ENV` | `production` |
| `CORS_ORIGIN` | *(optional)* browser origins allowed to call the API |

Without a persistent disk, every deploy deletes your users' data. For real scale,
switch `provider = "sqlite"` to `"postgresql"` in `apps/api/prisma/schema.prisma`
and point `DATABASE_URL` at a managed Postgres.
</details>

---

## Step 2 — Point the app at that URL

Edit **`apps/mobile/eas.json`** and replace both placeholders with your real host:

```jsonc
"preview":    { "env": { "EXPO_PUBLIC_API_URL": "https://YOUR-APP.fly.dev" } },
"production": { "env": { "EXPO_PUBLIC_API_URL": "https://YOUR-APP.fly.dev" } }
```

No trailing slash. It must be `https://` — Android blocks plaintext HTTP in release
builds, which is the correct default.

---

## Step 3 — Build a real APK and test it on your phone

```bash
npm install -g eas-cli
eas login                       # free Expo account
eas build:configure             # links the project, once

eas build --platform android --profile preview   # installable APK
```

EAS generates and stores your **upload keystore** on the first build. Back it up —
losing it means you can never update the app under the same listing:

```bash
eas credentials   # → Android → Keystore → Download
```

Install the APK on your phone from the link EAS prints, then check:

- [ ] Manager login works against the live API
- [ ] Tenant login works
- [ ] A tenant can submit a payment **with a screenshot**
- [ ] The manager sees it under Payment approvals and can approve it
- [ ] Notifications arrive
- [ ] Killing and reopening the app keeps you signed in

If anything fails here it will fail for Google too. Fix before continuing.

> Building locally instead of on EAS needs the Android SDK and **JDK 17 or 21** —
> Android Gradle does not support JDK 25, which is what's installed on this machine.
> EAS sidesteps that entirely.

---

## Step 4 — Build the release bundle

```bash
eas build --platform android --profile production   # .aab for Play
```

`autoIncrement` bumps `versionCode` on every production build, so you never hit
"version code already used".

---

## Step 5 — Play Console

1. Pay the **$25** one-off fee at <https://play.google.com/console> and verify your
   identity (Google may ask for ID; this can take a day or two — start early).
2. **Create app** → name `PMAN`, English, App, Free.
3. Fill these in — all the copy is written for you:

| Console section | Source |
|---|---|
| Main store listing (name, descriptions, graphics) | [`store/play-listing.md`](store/play-listing.md) |
| Feature graphic, icon, screenshots | [`store/assets/`](store/assets/) |
| Data safety | [`store/play-data-safety.md`](store/play-data-safety.md) |
| Privacy policy URL | `https://d3d34d.github.io/pman/privacy.html` |
| App access (reviewer logins) | bottom of `store/play-listing.md` |
| Content rating | questionnaire → Business/Utility, expect *Everyone* |
| Target audience | 18+ |
| Ads | No ads |
| Financial features | **None** — the app records payments, it never moves money |

4. **Testing → Internal testing** → upload the `.aab` → add your own email as a
   tester → install from the Play link and re-run the step 3 checklist. Do not skip
   this; it is the only way to catch a Play-signed build behaving differently.
5. **Production → Create new release** → upload the same `.aab` → roll out.

First review typically takes 1–7 days. New developer accounts are sometimes held
longer.

---

## Step 6 — After it's live

- **Updates:** bump nothing by hand — `eas build --profile production`, then upload.
- **Over-the-air fixes:** `eas update --branch production` pushes JS-only changes in
  minutes without a Play review. Native or config changes still need a new build.
- **Back up the database.** Fly volumes are not backups:
  ```bash
  fly ssh console -C "cat /data/pman.db" > backup-$(date +%F).db
  ```
- **Watch it:** `fly logs`.

---

## Things that will get you rejected

| Problem | Fix |
|---|---|
| Reviewer can't log in | Seed the demo accounts on the **production** API and put them in App access |
| Privacy policy URL 404s | Confirm `https://d3d34d.github.io/pman/privacy.html` loads |
| Data safety contradicts the app | Use `store/play-data-safety.md` verbatim — it matches the code |
| App points at `localhost` | You skipped step 2 |
| Crash on launch | You skipped step 3 |
| No account deletion | Already built in (More/Account → Delete account) — just declare it |

---

## What's already done for you

- ✅ Release-safe API URL handling (fails loudly instead of silently using localhost)
- ✅ Human-readable network errors instead of "Network request failed"
- ✅ `Dockerfile`, `fly.toml`, `.env.example`, graceful shutdown, `/health`
- ✅ Real database migrations (`prisma migrate deploy`) instead of dev-only `db push`
- ✅ Uploads and database on one persistent volume
- ✅ CORS locked to an allowlist in production
- ✅ Privacy policy, published with the web build
- ✅ Data safety answers matching the actual schema
- ✅ Listing copy, feature graphic, icon, 6 phone screenshots (`npm run store:assets`)
- ✅ In-app account deletion, JWT expiry + revocation, bcrypt, rate limiting, signed file URLs
- ✅ 76 passing API tests
