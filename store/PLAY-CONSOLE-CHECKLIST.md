# Play Console — field-by-field checklist

Every field, in the order Play Console asks for it, with the exact value to enter.
Tick as you go. Nothing here needs another document open.

**Before you start you need:** the `.aab` from `eas build --platform android
--profile production`.

---

## 0. Create the app

**Play Console → All apps → Create app**

| Field | Value |
|---|---|
| App name | `PMAN: Your Property Manager` |
| Package name | `com.pman` — **permanent, can never be changed** |
| Default language | English (United States) |
| App or game | **App** |
| Free or paid | **Free** *(cannot be changed to paid later)* |
| Declarations | Tick both (developer programme policies, US export laws) |

---

## 1. App content (left nav → **Policy → App content**)

Work down the list. Every one must go green before you can publish.

### 1.1 Privacy policy
```
https://d3d34d.github.io/pman/privacy.html
```
- [ ] Pasted and saved

### 1.2 App access
Choose **All or some functionality is restricted**, add an instruction, paste:

| Field | Value |
|---|---|
| Name | `Demo accounts (manager + tenant)` |
| Username | `manager@pman.dev` |
| Password | `password123` |

In **Any other instructions**:
```
PMAN has two separate sign-in areas.

Property Manager: manager@pman.dev / password123
Tenant:           tenant@pman.dev / password123

Both accounts are pre-loaded with sample properties, leases and payments.
There is no paywall and no in-app purchase.

A browser version of the same app (sample data, no server) is available at
https://d3d34d.github.io/pman/ if that is easier to inspect.
```
- [ ] Saved

> These accounts are live on the production API. Verify they still work before
> submitting: `curl -X POST https://pman-api.fly.dev/auth/login -H 'content-type: application/json' -d '{"email":"manager@pman.dev","password":"password123"}'`

### 1.3 Ads
- [ ] **No, my app does not contain ads**

### 1.3b Advertising ID *(Play blocks release without this)*

**App content → Advertising ID**

- [ ] **No, my app does not use advertising ID**

Verified against the built bundle: the manifest contains **no**
`com.google.android.gms.permission.AD_ID` permission, and the app has no ads,
analytics or attribution SDKs. So "No" is the correct and truthful answer.

> If you ever answer "Yes" here, Play then requires the `AD_ID` permission to be
> declared in the manifest — the two must agree or the release is rejected.

### 1.4 Content rating
Start questionnaire.

| Field | Value |
|---|---|
| Email | `rronyy001@gmail.com` |
| Category | **Utility, Productivity, Communication or Other** |

Answer **No** to: violence, sexuality, language, controlled substances,
gambling, digital purchases, **sharing location**.

Answer **YES** to these two — the app really does have them, and answering "No"
would be a false declaration that a reviewer can disprove by opening the
Messages tab:

| Question | Answer | Why |
|---|---|---|
| Can users interact or communicate with each other? | **Yes** | Tenant ↔ manager messaging and property announcements |
| Can users share personal information with other users? | **Yes** | A tenant's name, email and phone are visible to their manager |

Expected result: still a low rating (**Everyone / PEGI 3**) with a
*"Users Interact"* descriptor. Being truthful here costs you nothing; a false
IARC answer can invalidate the rating or trigger account-level enforcement.

- [ ] Submitted

### 1.5 Target audience and content
| Field | Value |
|---|---|
| Target age groups | **18 and over** only |
| Appeal to children | **No** |
- [ ] Saved

### 1.6 Data safety
The long one. Full answers are in
[`play-data-safety.md`](play-data-safety.md) — follow it exactly; it was written
against the actual database schema so your declaration matches the app.

Summary of what you'll declare:

| Question | Answer |
|---|---|
| Does your app collect or share user data? | **Yes** |
| Encrypted in transit? | **Yes** |
| Can users request deletion? | **Yes** |

Data types to mark **Collected · Not shared · App functionality**:
Name · Email address · Phone number *(optional)* · Other personal info *(emergency
contact, optional)* · Other financial info *(rent charged/paid)* · Photos · Files
and docs · Other in-app messages

Mark **NOT collected**: location, contacts, calendar, health, browsing history,
app interactions, crash logs, purchase history, **payment info**, device IDs.

- [ ] Completed and saved

### 1.7 The remaining declarations
- [ ] News app → **No**
- [ ] Government app → **No**
- [ ] Financial features → **My app doesn't have any financial features**
- [ ] Health apps → **No**
- [ ] Data deletion → in-app deletion **Yes**; URL: `https://d3d34d.github.io/pman/privacy.html`

> **Financial features must be "none".** PMAN records payments made elsewhere; it
> never moves money or touches card data. Ticking anything here pulls you into
> Play's financial-services policy, which can demand licensing evidence.

---

## 2. Main store listing (**Grow → Store presence → Main store listing**)

### App name (30 max)
```
PMAN: Your Property Manager
```

### Short description (80 max)
```
Landlord app to track rent, leases & tenants — with a free tenant portal.
```

### Full description (4000 max)
Copy the fenced block under "Full description" in
[`play-listing.md`](play-listing.md). Paste as plain text — Play strips most
formatting but keeps line breaks.

- [ ] All three text fields saved

### Graphics
| Asset | File |
|---|---|
| App icon (512×512) | `store/assets/play-icon-512.png` |
| Feature graphic (1024×500) | `store/assets/feature-graphic.png` |
| Phone screenshots (need ≥2, upload all 6) | `store/assets/screenshots/01…06` |

- [ ] Uploaded, screenshots in order 01 → 06

> Tablet screenshots aren't required. If Play warns your app "isn't optimised for
> tablets", that's advisory — it won't block release.

---

## 3. Store settings (**Grow → Store presence → Store settings**)

| Field | Value |
|---|---|
| App category | **Business** |
| Tags | Property management · Rentals · Real estate |
| Email | `rronyy001@gmail.com` |
| Website | `https://d3d34d.github.io/pman/` |
| Phone | optional — leave blank |

- [ ] Saved

---

## 4. Internal testing FIRST (**Testing → Internal testing**)

Do not go straight to production. This is free, takes ten minutes, and is the
only way to see a Play-signed build behave.

1. **Create new release** → upload your `.aab`
2. Release name: `1.0.0 (1)` · Release notes: `First release.`
3. **Testers** tab → create a list with your own email → save
4. Copy the opt-in URL, open it on your phone, install

### Re-test on the installed build
- [ ] Manager login against the live API
- [ ] Tenant login
- [ ] Tenant submits a payment **with a screenshot**
- [ ] Manager approves it; ledger updates
- [ ] **Push notification arrives** — this only works in a real build, never in Expo Go
- [ ] Force-close and reopen — still signed in
- [ ] Aeroplane mode → "Can't reach the server", not a crash

---

## 5. Closed testing — only if the 12-tester rule applies

**Check first:** Settings → Developer account → Account details.

If **Account type = Personal** and it was created **after 13 Nov 2023**, Google
requires a closed test with **12 testers opted in for 14 continuous days** before
you may apply for production. Organisation accounts are exempt.

- [ ] Checked which applies to me

If it applies: **Testing → Closed testing → Create track**, upload the same
`.aab`, add 12+ tester emails, send the opt-in link. The 14 days start when they
install. Plan around it.

---

## 6. Production (**Production → Create new release**)

1. Upload the `.aab` *(same file — don't rebuild)*
2. Release name `1.0.0 (1)`
3. Release notes:
```
First release of PMAN.

• Rent roll — see who has paid, who is short, and who is late
• Leases, rent changes and automatic late fees
• Tenants submit payment proof; you approve it into the ledger
• Maintenance, expenses, documents and CSV export
• Free tenant portal with balances, receipts and messaging
```
4. **Start rollout to Production**

- [ ] Rolled out

Review is usually 1–7 days; first-time accounts often take longer.

---

## After it's live

- [ ] **Create your own manager account with a strong password.** Do not put real
      property data in `manager@pman.dev` — that password is public in your listing.
- [ ] Back up the database: `fly ssh console -C "cat /data/pman.db" > backups/pman-$(date +%F).db`
- [ ] Watch for crashes: Play Console → Quality → Android vitals
- [ ] Reply to every review — replies are indexed and lift your rating

---

## What can be automated later

Once you've published manually once, `eas submit` can handle future uploads:

1. Play Console → Setup → API access → create a **service account**, grant it
   *Release manager*, download the JSON key
2. Save it **outside the repo** (it's a credential — never commit it)
3. Add to `apps/mobile/eas.json`:
   ```jsonc
   "submit": {
     "production": {
       "android": {
         "serviceAccountKeyPath": "/absolute/path/to/key.json",
         "track": "internal"
       }
     }
   }
   ```
4. Then: `eas submit --platform android --profile production`

This automates the **upload** only. Listing text, graphics and the policy
declarations stay manual — Google requires the developer to make them.
