# PMAN → Google Play: the complete guide

Every command, every prompt, in order. Nothing is assumed.

**You'll spend:** ~2 hours hands-on.
**You'll wait:** 1–7 days for review — **or ~14 days** if Google requires closed
testing first (see Part 0).
**You'll pay:** ~$0–3/month for hosting. Play Console you already have.

---

## Part 0 — Read this first

### The 12-tester rule

If your Play Console is a **personal** account created after **13 November 2023**,
Google requires a **closed test with at least 12 testers, opted in and running for
14 continuous days**, before you may apply for production access.

- **Organisation/company accounts are exempt** — they can go straight to production.
- Check: Play Console → **Settings → Developer account → Account details** → look at
  *Account type* and *Date created*.

If it applies, plan for it: line up 12 people (friends, family, a Discord/Reddit
group) with Google accounts. They must **install from the closed-testing link and
stay opted in** for the full 14 days. Start this as early as possible — it runs in
parallel with everything else.

### What you need

| Thing | Cost | Notes |
|---|---|---|
| Google Play Console | ✅ you have it | |
| Fly.io account | free tier, card required | hosts the API |
| Expo account | free | builds the app |
| Homebrew | free | to install `flyctl` |

You do **not** need Docker or Android Studio — Fly builds the image on their
servers, and EAS builds the app on theirs.

---

## Part 1 — Put the API online

Nothing else works until this does. A downloaded app has no dev server; it needs a
public HTTPS address.

> **Full walkthrough:** [`DEPLOY-FLY.md`](DEPLOY-FLY.md) covers every prompt,
> costs, backups, and troubleshooting. The steps below are the short version.

### 1.1 Install and sign in

```bash
brew install flyctl
fly auth signup     # already have an account? fly auth login
```

### 1.2 Create the app

From the **repo root** (`~/PMAN`):

```bash
fly launch --no-deploy --copy-config
```

What it asks:

| Prompt | Answer |
|---|---|
| "Would you like to tweak these settings…?" | **No** (`fly.toml` is already correct) |
| App name | `pman-api` is likely taken — accept the generated name |
| Region | pick the one nearest you, **and remember it** |
| Postgres / Redis / Tigris? | **No** to all — SQLite lives on your volume |

Open `fly.toml` and check two lines match what you chose:

```toml
app = "your-actual-app-name"
primary_region = "iad"          # ← must match the region you picked
```

### 1.3 Create the storage volume

This holds the database **and** every uploaded file. Without it, each deploy wipes
your users' data.

```bash
fly volumes create pman_data --size 1 --region iad
```

Use *your* region. It warns that single volumes aren't redundant — that's expected,
answer **yes**.

### 1.4 Set the signing secret

```bash
fly secrets set JWT_SECRET="$(openssl rand -base64 48)"
```

The server refuses to boot in production without this. You never need to see it.

### 1.5 Deploy

```bash
fly deploy
```

First build takes 3–5 minutes. Fly uses a remote builder, so no local Docker needed.

### 1.6 Confirm it's alive

```bash
curl https://YOUR-APP.fly.dev/health
```

Must print:

```json
{"ok":true,"paymentProvider":"MOCK"}
```

If it doesn't, run `fly logs` and see [Troubleshooting](#troubleshooting).

### 1.7 Create the demo accounts

Google's reviewer needs to log in, and you need a first account:

```bash
fly ssh console -C "npm --prefix /app/apps/api run seed"
```

> ⚠️ **Once only.** `seed` wipes the database and reloads sample data. Never run it
> again after you have real users.

Verify a real login works:

```bash
curl -X POST https://YOUR-APP.fly.dev/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"manager@pman.dev","password":"password123"}'
```

A long `{"token":"eyJ..."}` means the API is fully working. **Send me this URL and
I'll verify it end to end.**

---

## Part 2 — Point the app at your API

Edit `apps/mobile/eas.json` and replace **both** placeholders:

```jsonc
"preview":    { "env": { "EXPO_PUBLIC_API_URL": "https://YOUR-APP.fly.dev" } },
"production": { "env": { "EXPO_PUBLIC_API_URL": "https://YOUR-APP.fly.dev" } }
```

Rules: `https://`, **no trailing slash**. Android blocks plaintext HTTP in release
builds, which is correct behaviour.

---

## Part 3 — Build a test APK and try it on your phone

```bash
eas login              # eas-cli is already installed
eas build:configure    # links the project; choose Android. Run once.
```

`build:configure` adds a project ID to `app.json` — commit that change.

```bash
eas build --platform android --profile preview
```

Free-tier builds queue; 10–30 minutes is normal. EAS prints a QR code and URL when
done — open it on your phone and install (allow "install from unknown sources").

### 3.1 Back up your keystore — do not skip

EAS created the signing key on that first build. **Lose it and you can never update
your app under the same listing, ever.**

```bash
eas credentials
# → Android → production → Keystore → Download
```

Store the downloaded file somewhere safe and permanent.

### 3.2 Test on the real device

Work through all of these against the live API:

- [ ] Manager login (`manager@pman.dev` / `password123`)
- [ ] Dashboard shows real numbers
- [ ] Log out, log in as tenant (`tenant@pman.dev`)
- [ ] Tenant submits a payment **with a screenshot attached**
- [ ] Log back in as manager → Payment approvals shows it → **Approve**
- [ ] Tenant sees it approved, with a receipt
- [ ] Force-close the app, reopen — still signed in
- [ ] Turn off Wi-Fi and mobile data → you get "Can't reach the server", not a crash

Anything failing here fails for Google too. Fix before continuing.

---

## Part 4 — Fill in Play Console

You can do all of this **before** you have a release. In Play Console:
**Create app** → name `PMAN`, English (US), **App**, **Free**, accept declarations.

Then work down the "Set up your app" checklist:

| Task | Where the content is |
|---|---|
| App access | bottom of [`store/play-listing.md`](store/play-listing.md) — reviewer logins |
| Ads | **No, my app does not contain ads** |
| Content rating | questionnaire → Utility/Business; answer No to everything sensitive |
| Target audience | **18+** |
| News app | No |
| Data safety | [`store/play-data-safety.md`](store/play-data-safety.md) — follow it field by field |
| Government apps | No |
| Financial features | **My app doesn't have any financial features** |
| Health | No |
| Privacy policy | `https://d3d34d.github.io/pman/privacy.html` |

Then **Store presence → Main store listing**, from
[`store/play-listing.md`](store/play-listing.md):

| Field | Value |
|---|---|
| App name | `PMAN — Property Management` |
| Short description | the 73-character line |
| Full description | the long block |
| App icon | `store/assets/play-icon-512.png` |
| Feature graphic | `store/assets/feature-graphic.png` |
| Phone screenshots | all 6 in `store/assets/screenshots/` |

**Store settings** → Category **Business**, contact email, website
`https://d3d34d.github.io/pman/`.

> **Financial features must be "none".** The app records payments made elsewhere; it
> never moves money or touches card details. Ticking anything here drags you into
> Play's financial-services policy and can require licensing evidence.

---

## Part 5 — Build the release and go to testing

```bash
eas build --platform android --profile production
```

That produces an `.aab` (Play's required format). `autoIncrement` bumps the version
code automatically, so you'll never hit "version code already used".

### Internal testing (always do this)

**Testing → Internal testing → Create new release** → upload the `.aab` → add your
own email as a tester → install from the Play link → **re-run the Part 3.2
checklist**. This is the only way to catch a Play-signed build misbehaving.

### Closed testing (if the 12-tester rule applies to you)

**Testing → Closed testing → Create track** → upload the same `.aab` → add your 12+
testers by email → send them the opt-in link.

They must install and stay opted in for **14 continuous days**. Track the countdown
in Play Console; when it completes you'll be offered **Apply for production access**.

### Production

**Production → Create new release** → upload the `.aab` → write release notes →
**Start rollout to Production**.

First review is usually 1–7 days; new accounts sometimes take longer.

---

## Part 6 — After it's live

**Ship a JS-only fix in minutes, no review** — requires a one-time setup, because
`expo-updates` is not installed in this project yet:

```bash
npx expo install expo-updates
eas update:configure
eas build --platform android --profile production   # OTA needs a build that includes it
```

After that, and only after users are on a build containing `expo-updates`:

```bash
eas update --branch production --message "Fix rent roll date"
```

> Until you do this, `eas update` will not reach anyone — the current build has no
> updates client, so every change needs a new build and a Play release.

**Ship a real update** (native changes, new permissions, version bump):
```bash
eas build --platform android --profile production
# then upload to a new Production release
```

**Back up your database — Fly volumes are not backups:**
```bash
fly ssh console -C "cat /data/pman.db" > backup-$(date +%F).db
```
Do this weekly, or before any risky change.

**Watch it:** `fly logs` · **Restart:** `fly apps restart YOUR-APP`

---

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `/health` doesn't respond | `fly logs`. Usually `JWT_SECRET` missing → step 1.4 |
| `Error: Volume not found` | Volume name must be exactly `pman_data`, in the app's region |
| Deploy OK, but data vanishes | `[[mounts]]` missing from `fly.toml`, or volume in the wrong region |
| App shows "Can't reach the server" | `EXPO_PUBLIC_API_URL` wrong/missing → Part 2, then **rebuild** (env is baked in at build time) |
| Login fails on device but curl works | You built before setting the URL. Rebuild. |
| `fly ssh console` hangs | Machine is asleep. `curl .../health` to wake it, then retry |
| EAS build fails on credentials | `eas credentials` → let EAS generate a new keystore (only safe **before** first publish) |
| Play: "Upload a privacy policy" | Paste the URL into **App content → Privacy policy**, not just the listing |
| Play: "Your app targets an old API level" | Not applicable — Expo SDK 54 targets API 35 |
| Rejected: reviewer couldn't log in | The demo accounts must exist on your **production** API (step 1.7) and be listed under App access |

---

## Quick reference

```bash
# API
fly deploy                      # ship API changes
fly logs                        # tail logs
fly status                      # is it up?
fly secrets list                # what's set (values hidden)

# App
eas build -p android --profile preview      # testable APK
eas build -p android --profile production   # .aab for Play
eas update --branch production              # JS-only fix (needs expo-updates first)
eas credentials                             # keystore backup

# Local
npm test                        # 76 API tests
npm run store:assets            # regenerate all store graphics
```
