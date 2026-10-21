# PMS-IMS — Property and Inventory Management, MGO Candoni

One app that merges the **Property Management System** (PMS / PPE Ledger) and the
**Inventory Management System** (IMS). Every delivery starts as an **Acceptance and Inspection
Report (AIR)** and ends as documents that Accounting has posted in the registry.

- **Backend:** Firebase (Authentication + Cloud Firestore). The free Spark plan is enough: no Cloud
  Functions, no Storage.
- **Hosting:** Netlify, with no build step. It serves the `public/` folder as it is.
- **Look:** the same design as the TOSCAN Portal: black and gold top bar and sidebar, a dashboard
  with "Needs your attention" and "At a glance" panels, and the Inter typeface.
- **Sign-in:** Google, or email and password.

---

## The flow

| Step | Who | What happens | Status |
| --- | --- | --- | --- |
| 1 | **End-User** | Encodes the AIR: fund, supplier, PO and invoice, and each item delivered with its unit, quantity and unit cost. Saves it as a draft, then **submits it to the GSO**. The AIR number is assigned on submission. | Draft → *For GSO Inspection* |
| 2 | **GSO** | Records the inspection (date, inspector, "found in order") and the acceptance (date received, complete or partial, custodian). Confirms each item's **classification** and **account code**, then **approves**. Or **returns** the AIR to the End-User with remarks; they correct it and resubmit. | *For Issuance* or *Returned* |
| 3 | **GSO** | Issues documents from the approved AIR:<br>• **PAR** (Appendix 51) for PPE<br>• **ICS** (Annex A.3) for Semi-Expendable property. Numbering is **SPLV** for a unit cost of ₱5,000 and below, **SPHV** above that. Mixed items are split into one ICS per class automatically.<br>• **RIS** (Appendix 48) for supplies that are consumed or distributed.<br>Partial quantities are allowed: for example, one laptop to each of two people, or 6 of 10 reams now and the rest later. | *Fully Issued* once every PPE and Semi-Expendable item is covered |
| 4 | **Accounting** | Marks each item as **posted in the registry**, with the posting date and JEV / reference number. One item per document: the **AIR supply receipt** (into the Supplies Ledger Card) and every **PAR, ICS and RIS**. Several can be posted at once under one JEV. | *Not posted* → *Partially posted* → *Fully posted* |

**Classification rule** (the thresholds can be changed in Settings):
- Equipment or furniture with a unit cost of **₱50,000 or more** is **PPE** and gets a **PAR**.
- Equipment or furniture **below ₱50,000** is **Semi-Expendable** and gets an **ICS**.
- **Supplies** go to inventory and are issued with a **RIS**. Accounts `10402xxx` are
  *Distribution* (for example, welfare goods); other accounts are *Consumption*.

### What changed from the current PMS and IMS flow

- **One starting point.** In IMS the GSO encoded the AIR, and in PMS the PAR or ICS was keyed in
  separately. Now the **End-User encodes the AIR** and every PAR, ICS and RIS is **issued from
  that AIR**, so quantities and costs are never retyped and never exceed what was delivered.
- **Inspection is a real step.** The GSO approves or returns the AIR, and the reason for a return
  is recorded.
- **Accounting no longer creates registry items by hand.** Accounting marks each document as
  posted (date + JEV no.) instead of re-encoding it. Posting can be undone only by Accounting;
  a posted document cannot be cancelled by the GSO.
- **Cancellation instead of deletion.** A wrong PAR, ICS or RIS is cancelled (with a reason) before
  posting. Its quantities return to the AIR for re-issue, and its number stays used.
- **Exact supply costing.** Each RIS line draws from a specific AIR line, so the Stock Card and
  Supplies Ledger Card balances in pesos are exact.
- **Kept as they were:** the GF / SEF / TF fund switcher, the account catalogs (PPE,
  Semi-Expendable, Inventory), the PAR / ICS / RIS numbering, the printed form layouts, the Stock
  Card (Appendix 53), the Supplies Ledger Card (Appendix 9) and the RSMI (Appendix 40).

### Roles

| Role | Can do |
| --- | --- |
| **End-User** | Encode, submit and correct **their own** AIRs. See the PAR, ICS and RIS issued from them. |
| **GSO** | See all AIRs. Inspect, approve or return. Issue and cancel PAR, ICS and RIS. Registries and reports. |
| **Accounting** | See all AIRs and documents. Post and unpost. Registries and reports. |
| **Admin** | Everything above, plus approving users, assigning End-User, GSO and Accounting roles, settings and the audit trail. |
| **Super Admin** | Everything, including assigning and removing **Admins**. |

The **Firestore security rules** (`firestore.rules`) enforce these on the server, not just in the
menus. For example, an End-User cannot read another office's AIR, and the GSO cannot mark a
document as posted.

### Screens

Dashboard · New AIR / My AIRs / All AIRs · For Inspection · For Issuance · PAR / ICS / RIS ·
For Posting · Posting Status · Property (PPE) registry · Semi-Expendable registry · Supplies Stock
Cards (Stock Card + Supplies Ledger Card) · Reports (RSMI, Summary by Account for Trial Balance
reconciliation, AIR Monitoring) · Users & Roles · Settings · Audit Trail · My Profile.
Every list can be downloaded as a CSV, and every form prints on A4.

---

## Setup — from zero to a live site

### 1. Create the Firebase project

1. Go to <https://console.firebase.google.com> and click **Add project**. Use a new project (for
   example `mgo-candoni-pmsims`); do not reuse the PMS, IMS or TOSCAN project.
2. Go to **Build → Firestore Database → Create database**. Choose **Production mode** and the
   location **asia-southeast1 (Singapore)**.
3. Go to **Build → Authentication → Get started → Sign-in method** and enable:
   - **Email/Password**
   - **Google** (pick a support email)
4. Go to **Authentication → Settings → Authorized domains → Add domain** and add your Netlify
   address, for example `pms-ims.netlify.app`, plus your custom domain if you have one.
   Google sign-in fails on any domain not listed here.

### 2. Paste the web config

**Project settings (gear icon) → General → Your apps → Add app → Web (`</>`)**. Copy the
`firebaseConfig` values into **`public/js/firebase-config.js`**. These values are not secret.

### 3. Publish the security rules

Either:
- Open **Firestore Database → Rules**, paste the whole of `firestore.rules`, and click **Publish**.

or, with the Firebase CLI:
```sh
npm install
cp .firebaserc.example .firebaserc     # then put your project id in it
npx firebase login
npx firebase deploy --only firestore:rules,firestore:indexes
```

> The Super Administrator email is written in **two places** that must match: `firestore.rules`
> (`bootstrapEmail()`) and `public/js/core/catalog.js` (`SUPERADMIN_EMAILS`). It is set to
> `npp@mgocandoniaccounting.org`.

### 4. Deploy on Netlify

1. Push this repository to GitHub.
2. In <https://app.netlify.com>, go to **Add new site → Import an existing project → GitHub** and
   pick this repo.
3. The build settings come from `netlify.toml`: **publish directory `public`**, **no build
   command**. Click **Deploy**.
4. Every later `git push` redeploys automatically.

### 5. First sign-in and setting up users

1. Open the site and sign in as **npp@mgocandoniaccounting.org**. Google sign-in is easiest. With
   email/password, first confirm the email address using the verification link.
2. Fill in your name and office, then click **Claim Super Administrator access**.
3. Go to **Settings** and enter the **offices list** (one per line) and the **default
   signatories**: Property Custodian, Inspection Committee, the RIS approver and Accounting.
4. Staff then open the site, choose **Create an account** or **Continue with Google**, and fill in
   their office. They wait as *Pending approval*.
5. In **Users & Roles**, open each person, choose their role (End-User, GSO or Accounting; Admin
   only as Super Admin) and set the status to **Active**. Their access starts at once, with no
   redeploy.

---

## Data model (Firestore)

| Collection | One document per | Notes |
| --- | --- | --- |
| `users/{uid}` | person | `role`, `status` (pending / active / disabled / declined), office, position |
| `airs/{id}` | AIR | header, `lines[]` (category, account, stock no., **issuedQty**), `inspection`, `acceptance`, `status`, `posting` (supply receipt), `history[]` |
| `issuances/{id}` | PAR / ICS / RIS | `docType`, `number`, `airId`, `lines[]` (each linked to its AIR line), `recipient`, `status` (issued / cancelled), `posting` |
| `counters/{fund_TYPE_YYYY-MM}` | numbering sequence | increases by exactly one, inside a transaction |
| `settings/app` | — | entity, offices, thresholds, signatories |
| `auditLogs/{id}` | action | append-only; readable by admins |

Issuing a PAR, ICS or RIS runs in **one transaction** that reads the AIR, checks the remaining
quantity, takes the next number and saves both documents. Two GSO staff working at the same time
can never over-issue an item or get the same number.

## Repository layout

```
public/                 ← what Netlify serves
  index.html
  assets/app.css        ← TOSCAN design system + official form print styles
  js/firebase-config.js ← your project's web config (step 2)
  js/fb.js              ← Firebase SDK (v10.12.2 from gstatic)
  js/state.js           ← live listeners chosen by role
  js/data.js            ← every write (transactions)
  js/print.js           ← AIR, PAR, ICS, RIS, Stock Card, SLC, RSMI layouts
  js/core/catalog.js    ← funds, roles, thresholds, account catalogs (PPE, SX, Inventory)
  js/core/logic.js      ← business rules (pure; shared with the tests)
  js/views/*.js         ← screens
firestore.rules         ← server-side access control
tests/                  ← logic tests + security-rules tests
netlify.toml, firebase.json, firestore.indexes.json
```

## Testing

```sh
npm install
npm run test:logic     # business rules: thresholds, numbering, issuance limits, stock cards, RSMI
npm run test:rules     # security rules on the Firestore emulator (needs Java 11+)
```

To try the whole app locally without touching your real project:
```sh
npx firebase emulators:start --only auth,firestore --project demo-pmsims
npm run serve          # then open http://localhost:5173/?emulator
```
The `?emulator` switch works only on `localhost`.

## Not included yet

- **Importing existing PMS and IMS data** (the asset register, supplies balances). The two old
  apps keep working on their own Firebase projects. A one-time import can be added once this flow
  is confirmed.
- **Transfers (PTR / ITR), returns (RRSP / RRPPE), depreciation and Trial Balance
  reconciliation.** These stay in PMS for now. The *Summary by Account* report gives the received,
  issued and posted totals per account to reconcile against.
