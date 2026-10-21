# PMS-IMS — Property and Inventory Management, MGO Candoni

One app that merges the **Property Management System** (PMS / PPE Ledger) and the
**Inventory Management System** (IMS). Every delivery starts as an **Acceptance and Inspection
Report (AIR)** and ends as documents that Accounting has posted in the registry.

- **Backend:** Firebase (Authentication + Cloud Firestore). The free Spark plan is enough: no Cloud
  Functions, no Storage.
- **Hosting:** Netlify, with no build step. It serves the `public/` folder as it is.
- **Look:** the TOSCAN Portal layout in **green and gold**: a top bar and sidebar, a dashboard
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

After issuance, PAR and ICS items live in the **property register**, where their life continues:

| Event | Who | Document | Effect |
| --- | --- | --- | --- |
| Transfer to another officer | GSO | **PTR** (PPE) / **ITR** (Annex A.5, semi-expendable) | Accountable officer and location change. A *Donation* also takes the item out of the books (Accounting posts it). |
| Return to the GSO | GSO | **PRS** (PPE) / **RRSP** (Annex A.4, semi-expendable) | The item goes into GSO custody with its condition. It can be re-issued later by transfer, or disposed of. |
| Disposal | GSO, then Accounting | Disposal report (mode, IIRUP / reference, carrying amount) | The item leaves the register; Accounting posts the derecognition. |
| Monthly depreciation | Accounting | JEV summary | Straight-line, as in PMS (see below), posted month by month. |
| Trial Balance check | Accounting | Reconciliation | Register vs Trial Balance, per account, at any month end. |

Semi-expendable items can be moved in part (for example 1 of 4 chairs); the record splits in two.
PPE always moves as a whole record.

**Classification rule** (the thresholds can be changed in Settings):
- Equipment or furniture with a unit cost of **₱50,000 or more** is **PPE** and gets a **PAR**.
- Equipment or furniture **below ₱50,000** is **Semi-Expendable** and gets an **ICS**.
- **Supplies** go to inventory and are issued with a **RIS**. Accounts `10402xxx` are
  *Distribution* (for example, welfare goods); other accounts are *Consumption*.

### Depreciation (same method as PMS)

- **Straight-line, monthly:** (cost − residual value) ÷ (useful life × 12).
- **Residual value:** 5% of cost, or zero for Infrastructure accounts.
- **Start:** the month **after** acquisition. For imported PMS records, the month after the
  imported balance.
- **Stop:** at the residual value, or in the month of disposal.
- **Default useful lives:** the ones used most in your PMS register (Infrastructure 20, Buildings 30,
  Office/ICT equipment 5, Motor vehicles 7, and so on). Every record keeps its own life, which
  Accounting can correct.
- **Not depreciated:** Land, Construction in Progress and Biological Assets.
- **Posting:** periods are posted **in order**. Each posting saves the JEV number and the amount
  for every item, and only the latest month can be unposted. The accumulated-depreciation account
  is the cost account + 1, for example `10705020` → `10705021`, as in PMS.

### Trial Balance reconciliation

Paste the Trial Balance from Excel or upload the file (account code, name, debit, credit). For the
chosen month end the app compares, account by account:
- **PPE:** cost (debit) and accumulated depreciation (credit of the cost account + 1).
- **Semi-expendable property:** cost.
- **Inventory:** supplies on hand, valued from the Stock Cards.

Differences under ₱1 count as rounding. Tested with your **December 2025 Trial Balance** and the PMS
baseline register: 27 of 29 accounts tie out exactly. The two that don't (Land, and Plants and
Trees) differ in the source data itself.

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
- **One property register for both systems.** PAR / ICS issuance, transfers, returns, disposals
  and depreciation all act on the same records, and every record keeps its full history on its
  Property Card.
- **Kept as they were:** the GF / SEF / TF fund switcher, the full PMS account catalog, the
  depreciation method, the PAR / ICS / PTR / ITR / RIS numbering, the printed form layouts, the
  Stock Card (Appendix 53), the Supplies Ledger Card (Appendix 9) and the RSMI (Appendix 40).

### Roles

| Role | Can do |
| --- | --- |
| **End-User** | Encode, submit and correct **their own** AIRs. See the PAR, ICS and RIS issued from them, and **My Property** (items under their name). |
| **GSO** | See all AIRs. Inspect, approve or return. Issue and cancel PAR, ICS and RIS. Transfers, returns and disposals. Registries and reports. |
| **Accounting** | See everything. Post and unpost documents and disposals. Depreciation. Trial Balance reconciliation. Correct useful lives and residual values. |
| **Admin** | Everything above, plus approving users, assigning End-User, GSO and Accounting roles, settings and the audit trail. |
| **Super Admin** | Everything, including assigning and removing **Admins**. |

The **Firestore security rules** (`firestore.rules`) enforce these on the server, not just in the
menus. For example, an End-User cannot read another office's AIR, and the GSO cannot mark a
document as posted.

### Screens

Dashboard · New AIR / My AIRs / All AIRs · For Inspection · For Issuance · PAR / ICS / RIS ·
PPE Registry · Semi-Expendable Registry · asset page (Property Card, history, depreciation) ·
Transfers, Returns & Disposals · Supplies Stock Cards (Stock Card + Supplies Ledger Card) ·
For Posting · Posting Status · Depreciation · TB Reconciliation · Reports (RSMI, Summary by
Account, AIR Monitoring) · My Property · Users & Roles · Data Import · Settings · Audit Trail ·
My Profile.
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

### 6. Bring over your PMS and IMS records (one time)

Go to **Administration → Data Import**. Every file shows a preview first: what will come in, rows
with problems, and duplicates that will be skipped.

**Property from PMS:**
1. In PMS, open the **Asset Register**. For each fund, switch to it and click **Export CSV**. The
   PMS `data/seed_assets.json` file also works.
2. **Stop posting in PMS.** Note the **last month posted** there. The "Accum. Depr." column in the
   export is the balance as of that month.
3. Here, choose that month under *Accumulated depreciation as of*, choose the fund (if the file has
   no Fund column) and upload the file.
4. PPE and semi-expendable items are told apart by their account code. Retired items come in as
   disposed history.
5. Depreciation continues here from the following month.

**Supplies from IMS:**
1. In IMS, open the **Inventory Registry** and click **Download CSV**.
2. Upload it here with the date the balances are as of.
3. Each fund's supplies on hand become one already-posted **beginning-balance AIR**
   (`BB-<date>`). The GSO issues from it with a normal RIS, and the Stock Cards start from these
   balances.

Then check the result in **TB Reconciliation** against the Trial Balance of that month.

---

## Data model (Firestore)

| Collection | One document per | Notes |
| --- | --- | --- |
| `users/{uid}` | person | `role`, `status` (pending / active / disabled / declined), office, position |
| `airs/{id}` | AIR | header, `lines[]` (category, account, stock no., **issuedQty**), `inspection`, `acceptance`, `status`, `posting` (supply receipt), `history[]` |
| `issuances/{id}` | PAR / ICS / RIS | `docType`, `number`, `airId`, `lines[]` (each linked to its AIR line), `recipient`, `status` (issued / cancelled), `posting` |
| `assets/{id}` | property record (PAR / ICS line, import row, or split part) | PPE or semi-expendable, cost, residual, useful life, holder, status (active / returned / disposed / cancelled), `depBaseline` (imported accumulated depreciation), `history[]` |
| `movements/{id}` | PTR / ITR / PRS / RRSP / disposal | lines with the items moved; disposals and donations carry `posting` |
| `depreciation/{fund_YYYY-MM}` | posted month | JEV no., amount per item, summary by account |
| `tbSnapshots/{fund_YYYY-MM}` | Trial Balance | account → debit / credit |
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
  js/core/logic.js      ← AIR / issuance / posting rules (pure; shared with the tests)
  js/core/assets.js     ← depreciation, movements, reconciliation, import parsing (pure)
  js/views/*.js         ← screens
firestore.rules         ← server-side access control
tests/                  ← logic tests + security-rules tests
netlify.toml, firebase.json, firestore.indexes.json
```

## Testing

```sh
npm install
npm run test:logic     # business rules: thresholds, numbering, issuance, stock cards, RSMI,
                       # depreciation, movements, TB parsing/reconciliation, PMS/IMS import
npm run test:rules     # security rules on the Firestore emulator (needs Java 11+)
```

To try the whole app locally without touching your real project:
```sh
npx firebase emulators:start --only auth,firestore --project demo-pmsims
npm run serve          # then open http://localhost:5173/?emulator
```
The `?emulator` switch works only on `localhost`.
