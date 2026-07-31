# Deploying the PMAN API to Fly.io — complete guide

Everything from zero to a live HTTPS API, including what each command does, what
the prompts look like, and how to fix it when it breaks.

**Time:** 20–30 minutes, most of it waiting on the first build.
**You need:** a terminal, Homebrew, and a payment card (Fly requires one on file
even for small usage).
**You do NOT need:** Docker. Fly builds the image on their servers.

---

## Why Fly for this app

PMAN stores two things that must survive a redeploy: the **SQLite database** and
**uploaded files** (payment screenshots, lease documents). Fly lets one small
persistent volume hold both, mounted at `/data`. That is the whole reason it's
recommended here — most "free" hosts give you an ephemeral filesystem, which
silently deletes your users' data on every deploy.

The repo already contains `fly.toml` and `Dockerfile`, both configured for this.

---

## Step 1 — Install flyctl

```bash
brew install flyctl
```

No Homebrew? Use the official installer:

```bash
curl -L https://fly.io/install.sh | sh
```

Verify:

```bash
fly version
```

---

## Step 2 — Create your Fly account

```bash
fly auth signup
```

This opens a browser. Sign up with GitHub or email, then **add a payment card** —
Fly won't let you create machines without one.

Already have an account:

```bash
fly auth login
```

Confirm you're signed in:

```bash
fly auth whoami
```

---

## Step 3 — Create the app

Run this from the **repo root** (`~/PMAN` — the folder containing `fly.toml`):

```bash
fly launch --no-deploy --copy-config
```

`--copy-config` tells it to use the `fly.toml` already in the repo instead of
guessing. `--no-deploy` stops it deploying before the volume and secret exist.

### What it asks

| Prompt | Answer | Why |
|---|---|---|
| "An existing fly.toml was found… copy its configuration?" | **Yes** | It's already correct for this app |
| "Would you like to tweak these settings before proceeding?" | **No** | Opens a browser editor you don't need |
| App name | `pman-api` is almost certainly taken — **accept the generated name** | Names are global across all Fly users |
| Region | Pick the one nearest your users — **write it down** | The volume must live in the same region |
| "Would you like to set up a Postgres database?" | **No** | You're using SQLite on the volume |
| "…Redis / Upstash / Tigris / Sentry?" | **No** to all | Not needed |

### Then check fly.toml

`fly launch` rewrites the top of the file. Open it and confirm:

```toml
app = "your-actual-app-name"     # whatever Fly assigned
primary_region = "iad"           # MUST equal the region you picked
```

If `primary_region` doesn't match what you chose, fix it now — a mismatch is the
single most common cause of "volume not found" later.

Find region codes any time with:

```bash
fly platform regions
```

---

## Step 4 — Create the storage volume

This is the part that keeps your data alive.

```bash
fly volumes create pman_data --size 1 --region iad
```

Replace `iad` with **your** region. `--size 1` is 1 GB, plenty to start.

- The name must be exactly **`pman_data`** — `fly.toml` mounts it by that name.
- It warns that a single volume isn't redundant and data could be lost if the
  host fails. That's expected for one machine; answer **yes**. (Step 9 covers
  backups, which is the real protection.)

Confirm:

```bash
fly volumes list
```

You want one volume, `pman_data`, in your app's region.

---

## Step 5 — Set the signing secret

```bash
fly secrets set JWT_SECRET="$(openssl rand -base64 48)"
```

This generates a strong random secret and stores it encrypted at Fly. **The API
refuses to boot in production without it** — that's deliberate, so a weak default
can never reach production.

You never need to read this value. To confirm it exists (names only, never values):

```bash
fly secrets list
```

> Changing this later logs out every user on every device, because it invalidates
> all existing session tokens.

---

## Step 6 — Deploy

```bash
fly deploy
```

First run takes **3–5 minutes**: Fly uploads the repo to a remote builder, builds
the Docker image, pushes it, starts a machine, applies database migrations, and
waits for `/health` to pass.

You'll see it end with something like `1 desired, 1 placed, 1 healthy`.

---

## Step 7 — Confirm it's actually working

**Health check** — replace with your app name:

```bash
curl https://YOUR-APP.fly.dev/health
```

Must print:

```json
{"ok":true,"paymentProvider":"MOCK"}
```

**Create the demo accounts** (Google's reviewer needs to log in, and so do you):

```bash
fly ssh console -C "npm --prefix /app/apps/api run seed"
```

> ⚠️ **Run this exactly once.** `seed` wipes the database and loads sample data.
> Never run it again once you have real users.

**Prove a real login works:**

```bash
curl -X POST https://YOUR-APP.fly.dev/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"manager@pman.dev","password":"password123"}'
```

A long `{"token":"eyJ..."}` response means the API is fully live. ✅

---

## Step 8 — Decide on cold starts

`fly.toml` currently has:

```toml
auto_stop_machines = "stop"
min_machines_running = 0
```

The machine sleeps when idle and wakes on the next request. Cheapest, but the
first request after a nap takes a second or two.

**For the Play review period**, consider keeping it always on so a reviewer never
hits a cold start:

```toml
min_machines_running = 1
```

then `fly deploy` again. Switch it back afterwards if you want to save money.

---

## Step 9 — Back up your data

Fly volumes are **storage, not backups**. Take one before any risky change, and
on a schedule:

```bash
fly ssh console -C "cat /data/pman.db" > backup-$(date +%F).db
```

Uploaded files live at `/data/uploads`. To pull one down:

```bash
fly ssh sftp get /data/uploads/FILENAME
```

Fly also takes daily volume snapshots (retained a few days):

```bash
fly volumes snapshots list <volume-id>
```

Don't rely on those alone — keep your own copies somewhere off Fly.

---

## Day-to-day commands

```bash
fly status                  # is it up? which machine, which region
fly logs                    # live logs (Ctrl-C to stop)
fly deploy                  # ship API changes
fly apps restart YOUR-APP   # bounce it
fly secrets list            # what's set (values hidden)
fly volumes list            # storage
fly ssh console             # shell inside the container
fly dashboard               # open the web UI
```

---

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `Error: volume 'pman_data' not found` | Volume is in a different region than `primary_region`, or misnamed. `fly volumes list`, then recreate in the right region. |
| Deploy succeeds, `/health` times out | `fly logs`. Almost always a missing `JWT_SECRET` — redo step 5. |
| `Error: no payment method` | Add a card at <https://fly.io/dashboard> → Billing. |
| Data disappears after each deploy | The `[[mounts]]` block is missing from `fly.toml`, or the volume isn't attached. `fly status` shows mounts. |
| `fly ssh console` hangs | The machine is asleep. `curl .../health` to wake it, then retry. |
| Build fails: "failed to fetch an image or build from source" | Usually a transient remote-builder issue — just run `fly deploy` again. |
| App name already taken | Names are global. Pick another and update `app =` in `fly.toml`. |
| Two machines appeared | SQLite allows **one writer**. Run `fly scale count 1` — never scale this app horizontally without moving to Postgres first. |
| Everyone got logged out | You changed `JWT_SECRET`. Expected — it revokes all sessions. |

---

## What it costs

Fly bills by usage. This app is one `shared-cpu-1x` / 512 MB machine plus a 1 GB
volume, which is at the very bottom of their pricing — **a few dollars a month**,
less if you leave `min_machines_running = 0` so it sleeps when idle.

Pricing changes, so check the current rates and your own usage:

- <https://fly.io/docs/about/pricing/>
- `fly dashboard` → Billing

Set a spending alert in the dashboard if you want a hard safety net.

---

## Shutting it down

If you want to stop paying entirely, this deletes the app **and its data**:

```bash
fly apps destroy YOUR-APP
```

Take a backup first (step 9). Deleting the app removes the volume with it.

---

## Optional — smoke-test it in Expo Go before building

Faster than waiting on an EAS build. The project targets **Expo SDK 54** so it
runs in the standard Expo Go from the Play Store.

```bash
cp apps/mobile/.env.example apps/mobile/.env
```

Edit `apps/mobile/.env` and set your real URL:

```bash
EXPO_PUBLIC_API_URL="https://YOUR-APP.fly.dev"
```

Then:

```bash
npm run mobile          # scan the QR with Expo Go
```

Or without a file, as a one-off:

```bash
EXPO_PUBLIC_API_URL="https://YOUR-APP.fly.dev" npm run mobile
```

> Expo inlines this value when Metro bundles. If you change it, restart Metro —
> `npx expo start --clear` if it seems stale. You do **not** need `npm run api`
> running; the phone talks straight to Fly.

### What this proves

- ✅ Login against the live API, both roles
- ✅ Real dashboard, rent roll and ledger numbers from your server
- ✅ Submitting a payment **with a screenshot** (picker + upload to the volume)
- ✅ Manager approving it and the ledger updating
- ✅ Messages, maintenance, documents, CSV export
- ✅ The in-app notification centre (it polls the API)

### What it does NOT prove

- ❌ **Remote push notifications** — Expo Go can't receive them on SDK 53+. Only a
  dev build or the real APK can.
- ❌ Release behaviour — Expo Go runs in dev mode, so the production-only guard
  that requires `EXPO_PUBLIC_API_URL` never fires there.
- ❌ Native config: permissions, adaptive icon, splash screen.
- ❌ The actual signed artifact Google will review.

So Expo Go is the fast way to confirm **your server integration is correct** — but
still do the `--profile preview` APK test in
[`SHIPPING-ANDROID.md`](SHIPPING-ANDROID.md) Part 3 before you submit.

---

## Next

Once `/health` and the login `curl` both work, go back to
[`SHIPPING-ANDROID.md`](SHIPPING-ANDROID.md) **Part 2** — put your
`https://YOUR-APP.fly.dev` URL into `apps/mobile/eas.json`, then build the APK.

Remember: `EXPO_PUBLIC_API_URL` is baked in **at build time**. Change the URL, and
you must rebuild the app for it to take effect.
