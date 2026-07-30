# Google Play — Data Safety form answers

Copy these into **Play Console → App content → Data safety**. They match what the
code actually does (verified against `apps/api/prisma/schema.prisma` and the
upload/notification paths), so the declaration and the app agree — a mismatch is a
common rejection reason.

---

## Section 1 — Data collection and security

| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | **Yes** |
| Is all of the user data collected by your app encrypted in transit? | **Yes** (HTTPS only) |
| Do you provide a way for users to request that their data is deleted? | **Yes** — in-app, plus an email route in the privacy policy |

**Account deletion URL** (Play asks for this when you offer account creation):
`https://d3d34d.github.io/pman/privacy.html#deleting-your-account-and-data`
— or link the privacy page and point to the "Deleting your account and data" section.

---

## Section 2 — Data types

For **every** type below the answers to the shared columns are the same:

- **Collected:** Yes · **Shared:** No
- **Processed ephemerally:** No · **Required or optional:** Required (unless noted)
- **Purposes:** *App functionality* only
  (do **not** tick Analytics, Advertising, Personalisation, or Fraud prevention —
  the app does none of these)

### Personal info
| Type | Collected | Optional? | Purpose |
|---|---|---|---|
| Name | Yes | Required | App functionality |
| Email address | Yes | Required | App functionality |
| Phone number | Yes | **Optional** | App functionality |
| Other info (emergency contact name/number) | Yes | **Optional** | App functionality |

### Financial info
| Type | Collected | Notes |
|---|---|---|
| Purchase history | **No** | — |
| Payment info (card/bank) | **No** | The app never handles card or bank credentials |
| Other financial info | **Yes** | Rent charged, payments recorded, balances and late fees. Purpose: App functionality |

> The app has **no card processing**. Tenants pay outside the app and record the
> payment for their manager to approve, so no payment credentials are collected.

### Photos and videos
| Type | Collected | Notes |
|---|---|---|
| Photos | **Yes** | Only files the user explicitly picks: payment screenshots and maintenance photos. Purpose: App functionality |

### Files and docs
| Type | Collected | Notes |
|---|---|---|
| Files and docs | **Yes** | Lease/tenancy documents uploaded by the manager. Purpose: App functionality |

### Messages
| Type | Collected | Notes |
|---|---|---|
| Other in-app messages | **Yes** | Tenant ↔ manager messages and property announcements. Purpose: App functionality |

### App activity / Device IDs
| Type | Collected | Notes |
|---|---|---|
| App interactions | **No** | No analytics SDK |
| Crash logs / diagnostics | **No** | Not wired up |
| Device or other IDs | **No** | The Expo push token is a notification address, not an advertising or device identifier. If the reviewer form pushes you, declare it under *Device or other IDs → App functionality*, never Advertising. |

### Location, Contacts, Calendar, Health, Audio, Browsing
**Not collected** — none of these are accessed.

---

## Section 3 — Sensitive permissions justification

Declared in `apps/mobile/app.json`:

| Permission | Why | What to tell the reviewer |
|---|---|---|
| `INTERNET` | Talks to the PMAN API | Core functionality |
| `POST_NOTIFICATIONS` | Payment submitted / approved / declined alerts | User-facing transactional alerts only |
| `READ_MEDIA_IMAGES` | Attach a payment screenshot or maintenance photo | Only invoked from an explicit "attach" tap; no library scanning |
| `VIBRATE` | Notification haptics | Standard notification behaviour |

There is **no** `QUERY_ALL_PACKAGES`, no background location, no SMS/Call Log —
none of the permission classes that trigger a Play policy declaration.

---

## Section 4 — Other App content declarations

| Item | Answer |
|---|---|
| Ads | **No ads** |
| Content rating questionnaire | Utility / Productivity; no violence, no user-generated public content, no gambling → expect **Everyone / PEGI 3** |
| Target audience | **18+** (business tool for landlords and tenants) — avoids Families policy requirements |
| News app | No |
| COVID-19 contact tracing | No |
| Data safety: third-party SDKs | Expo/React Native runtime and Expo push only |
| Government app | No |
| Financial features | **No** — declare *none*. The app records payments made elsewhere; it does not process, transmit or store funds or card data. |
| Health apps | No |

> The **Financial features** answer matters. Ticking anything here pulls you into
> Play's financial-services policy (which can require licensing evidence). PMAN is a
> record-keeping tool, so the correct answer is that it offers no financial products.

---

## Section 5 — Account deletion policy (required)

Play requires apps that support account creation to offer in-app deletion **and** a
web-reachable request path. Both exist:

- **In-app:** Manager → *More → Delete account*; Tenant → *Account → Delete account*.
  Requires password re-entry, then permanently deletes the login, profile, push
  tokens and notifications, and revokes all sessions.
- **Web:** the "Deleting your account and data" section of the privacy policy gives an
  email route for users who cannot sign in.
