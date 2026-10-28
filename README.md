# PIM — Property & Inventory Management, Municipal Government of Candoni

One app that merges the **Property Management System** (PMS / PPE Ledger) and the
**Inventory Management System** (IMS). Every delivery starts as an **Acceptance and Inspection
Report (AIR)** and ends as documents that Accounting has posted in the registry.

- **Backend:** Firebase (Authentication + Cloud Firestore). The free Spark plan is enough: no Cloud
  Functions, no Storage.
- **Hosting:** Netlify, with no build step. It serves the `public/` folder as it is.
- **Look:** the CBO palette (Candoni Financial Management System): a deep navy sidebar that collapses to an icon rail
  (remembered on each browser) and a navy header showing where you are, a **Back** button that returns to where you
  were (with the list's search and filters), steel-blue actions, teal accents; light content pages with KPI cards and a
  "Needs your attention" list on the dashboard, compact tables, and the Inter typeface. On phones the sidebar opens
  from the menu button.
- **Sign-in:** Google, or email and password.

---

## The flow

| Step | Who | What happens | Status |
| --- | --- | --- | --- |
| 1 | **End-User** | Encodes the AIR: fund, supplier, PO and invoice, and each item delivered with its unit, quantity and unit cost. Saves it as a draft, then **submits it to the GSO**. End-Users never number an AIR. | Draft → *For GSO Inspection* |
| 2 | **GSO** | Records the inspection (date, inspector, "found in order") and the acceptance (date received, complete or partial, custodian). Confirms each item's **classification** and **account code**, then **approves** — which gives the AIR its **number**. Or **returns** the AIR to the End-User with remarks; they correct it and resubmit. | *For Issuance* or *Returned* |
| 3 | **GSO** | Issues documents from the approved AIR:<br>• **PAR** for PPE<br>• **ICS** for Semi-Expendable property. Numbering is **SPLV** for a unit cost of ₱5,000 and below, **SPHV** above that. Mixed items are split into one ICS per class automatically.<br>• **RIS** for supplies that are consumed or distributed.<br>Partial quantities are allowed: for example, one laptop to each of two people, or 6 of 10 reams now and the rest later. | *Fully Issued* once every PPE and Semi-Expendable item is covered |
| 4 | **Accounting** | Marks each item as **posted in the registry**, with the posting date and JEV / reference number. One item per document: the **AIR supply receipt** (into the Supplies Ledger Card) and every **PAR, ICS and RIS**. Several can be posted at once under one JEV. | *Not posted* → *Partially posted* → *Fully posted* |

After issuance, PAR and ICS items live in the **property register**, where their life continues:

| Event | Who | Document | Effect |
| --- | --- | --- | --- |
| Transfer to another officer | GSO | **PTR** (PPE) / **ITR** (semi-expendable) | Accountable officer and location change. A *Donation* also takes the item out of the books (Accounting posts it). |
| Return to the GSO | GSO | **PRS** (PPE) / **RRSP** (semi-expendable) | The item goes into GSO custody with its condition. It can be re-issued later by transfer, or disposed of. |
| Disposal | GSO, then Accounting | Disposal report (mode, IIRUP / reference, carrying amount) | The item leaves the register; Accounting posts the derecognition. |
| Monthly depreciation | Accounting | JEV summary | Straight-line, as in PMS (see below), posted month by month. |
| Trial Balance check | Accounting | Reconciliation | Register vs Trial Balance, per account, at any month end. |

| Construction in Progress | Accounting | CIP Ledger Card | Projects with their contractor billings (by contract or by administration), each matched to its **SWA**. "Complete → transfer to PPE" turns the billed total into a new PPE record. |
| Repair | **End-User**, GSO, Accounting | History of Repair | Request → GSO pre-repair inspection → job order → GSO post-repair inspection (+ WMR) → Accounting posts → GSO verifies, and it joins the item's history. |

Semi-expendable items can be moved in part (for example 1 of 4 chairs); the record splits in two.
PPE always moves as a whole record.

**Classification rule** (the thresholds can be changed in Settings):
- Equipment or furniture with a unit cost of **₱50,000 or more** is **PPE** and gets a **PAR**.
- Equipment or furniture **below ₱50,000** is **Semi-Expendable** and gets an **ICS**.
- **Supplies** go to inventory and are issued with a **RIS**. Accounts `10402xxx` are
  *Distribution* (for example, welfare goods); other accounts are *Consumption*.

### Item No. filled in while encoding the AIR

On a new AIR, typing an item's description that was accepted before fills its **Item No.** (stock no.), unit and type
— the same item however it is typed (case, spaces and punctuation don't matter), using the latest delivery. Typing a
known Item No. fills the description. Suggestions appear as you type. The list grows on its own each time the GSO
approves an AIR (and when IMS supplies are imported); after updating, an administrator runs **Settings → Item list →
Update the item list from approved AIRs** once to add the earlier ones. The GSO can still correct the Item No. at inspection.

### Construction in Progress and SWA (same rules as PMS)

- **One project per CIP No.**, on one of the three CIP accounts (Land Improvements, Infrastructure,
  Buildings).
- **Billings:** each billing records its costs by contract and by administration (direct
  materials, labor, overhead, consultancy, others) plus transfers/adjustments. The CIP Ledger Card
  shows the running total.
- **SWA (Statement of Work Accomplished):** encoded by the GSO or Accounting, with its number, CIP
  No., contractor, cost, % accomplished and a link to the scanned document (for example Google
  Drive; no file storage is needed). Accounting matches each SWA to one billing. A matched SWA is
  locked until the billing releases it.
- **Status:** a billing marked *FINAL* flags the project "Complete — awaiting transfer". Accounting
  can also set this by hand.
- **Complete → transfer to PPE:** creates the PPE record for the billed total. Default accounts are
  Other Land Improvements, Other Infrastructure or Other Structures, as in PMS. The project closes.
- **Trial Balance:** until it is transferred, a project's billings count toward its CIP account in
  TB Reconciliation.

### History of Repair

1. **Request** (End-User for an item under their name, from Office Property or History of Repair; or the GSO for any
   item): complaints / defects, parts or components to repair or replace, and the nature and scope of the last repair
   (filled in from the item's last repair).
2. **Pre-repair inspection** (GSO): findings / observations, inspector and date — approve for repair, or return.
3. **Job order** (End-User or GSO, once approved): job order no. and date, repair shop, invoice, nature of repair,
   spare parts / materials / labor with costs, Prepared by and Noted by.
4. **Post-repair inspection** (GSO): findings / comments — accept, or return. If parts were replaced, a **Waste
   Materials Report** (place of storage, items for disposal with any sale's OR, how they were disposed of).
5. **Posting** (Accounting): posting date and JEV, from the repair or from **For Posting** (filter "Repairs").
6. **Verification** (GSO): the repair is locked and joins the item's history.

Prints: the **Pre-Repair and Post-Repair Inspection Report** (one page, as the municipal form, seal at the upper
centre), the **Waste Materials Report**, and the item's **History of Repair**. Repairs recorded before this flow
continue at step 4.

### Offices

- **Built-in list:** the system ships with the standard offices of the Municipal Government of
  Candoni (Office of the Municipal Mayor, Sangguniang Bayan, Municipal Health Office, General
  Services Office, and so on).
- **Where it's used:** it is a dropdown at registration, on the AIR, on PAR / ICS / RIS, on
  transfers and on repairs. Administrators can change the list in **Settings**.
- **Who sets a person's office:** the user picks it at registration. After approval, only an
  administrator can change it (Users & Roles), because the office decides which property an
  End-User can see.
- **Office Property:** End-Users see every item whose accountable office is theirs. The security
  rules enforce this, not just the menus.
- **Renaming an office** in Settings doesn't rename it on existing records. Move those with a
  transfer, or "Correct record" on the item.
- **Import:** the PMS import reads the office from the Location column ("MAYOR'S OFFICE",
  "SB OFFICE", "MSWDO" and so on). Items whose location is an address (mostly roads, buildings and
  land) get no office; the GSO can assign one with "Correct record".

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

- **Trial Balance gate (as in PMS):** a month can be posted only when the Trial Balance of the
  month before is entered and ties out on **PPE cost** (semi-expendable and inventory don't hold it).
  An Administrator can post anyway with a reason; the override is saved with the posting and in
  the audit trail. The JEV can be printed or downloaded as CSV.
- **Dated changes:** a revaluation, an impairment loss, an account reclassification or a fund
  transfer applies from its effective month, so earlier months, depreciation and reconciliation
  stay as they were.

### Property register (everything from PMS)

- **No adding items directly in the registry.** Items enter it only from a PAR / ICS posted by
  Accounting, from a completed CIP project, or in bulk through **Administration → Data Import**
  (property found at the station, donated, transferred in, or acquired before the system). The
  registry also has no "Issue PAR / ICS": everything in it is already covered by a PAR / ICS.
  After an import, **Correct record** adds the DV No., acquisition, remarks, links and card details.
- **Special card details** by account: Land (lot ID, classification, area, technical description),
  Road Network (road ID, type, length, width, thickness, and cost by component — the Road Lot is
  land, becomes the residual value and is never depreciated), Other Public Infrastructure,
  Buildings and Structures (ID, type, floor area, floors, components), Biological Assets.
- **Correct record:** descriptions and custody by the GSO; cost, account, date acquired and
  opening balances by Accounting, **locked once depreciation is posted** (use Revalue / Reclassify).
- **Accounting actions on each item:** Revalue, Ledger entry (adjustment or impairment loss),
  Reclassify (account and/or fund), Reactivate a disposed item. Each keeps a dated record shown
  under "Ledger changes".
- **Printed cards**, one or in bulk from any filtered list: Equipment Ledger Card, Property Card,
  Semi-Expendable Property Ledger Card and Property Card, Land and Land Improvements, Local Road
  Network, Other Public Infrastructure and Buildings and Structures (ledger and property cards,
  sectioned by component), Biological Assets Property Card. Rows come from the item's whole
  history: acquisition, balance forward, depreciation by month, revaluations and CIP additions,
  impairments, transfers, verified repairs, disposal and reactivation.
- **QR ID tags** (3 × 2 in. stickers), with the municipal seal above each QR code, that open the item's page when scanned.
  Anyone who scans a tag sees the item's basic details (Property No., description, account, fund, date acquired,
  accountable officer, office, location, condition and status) without signing in; cancelled items stay hidden, and
  the list of items still needs an account.
- **Transfers:** the printed details of a PTR / ITR / PRS / RRSP / disposal (reason, signatories,
  reference) can be edited without touching the items.
- **CIP completion** can split the cost by building or road component, or **add the project to an
  existing road** (dated "Addition — CIP transfer"). SWAs can be unmatched from the SWA page, and
  all CIP ledger cards printed at once.
- **Dashboard:** search across property, PAR / ICS / RIS, transfers, repairs, AIRs and CIP.
- **Reports:** Accountability (by officer / office / account / status, with CSV and bulk cards)
  and Disposed / Retired. **Settings → Download full backup (JSON).**
- **Chart of accounts** (Settings): every PPE, semi-expendable and inventory account with its code and group. Add an
  account the standard chart doesn't have, or change a standard account's name, group, useful life or expense
  account (and change it back). The AIR, imports, registries and cards all use it. The semi-expendable codes follow
  PMS (10405080 Disaster Response and Rescue … 10405100 Medical, Dental and Laboratory … 10405140 Construction).
- **Clear recorded data** (Super Administrator only, Settings): deletes every record in all funds — AIRs, PAR / ICS / RIS,
  the registries, transfers and disposals, repairs, CIP and SWA, depreciation, Trial Balances, attachments, the item list
  and the number series (numbering restarts at each "Start at"). Users, invitations, settings and the activity log stay.
  You must type `DELETE ALL RECORDS`; download the backup first. It cannot be undone.

### Inventory Registry and posting by AIR

- **Inventory Registry** (Property → Inventory Registry): every consumable and for-distribution item, one row per Stock
  No. — received on AIRs **once Accounting posts the AIR** (or brought over from IMS), issued on RIS, balance quantity and value, as of any date. Filter by
  type, account or balance; print the registry, or the Stock Cards / Supplies Ledger Cards of the items listed; open an
  item for its cards. PPE and semi-expendable property have their own registries.
- **Items enter the PPE / Semi-Expendable Registry when Accounting posts their PAR / ICS.** Until then they wait
  outside it: the registry says how many are waiting, the item's page says which PAR / ICS it waits for, End-Users see
  them in Office Property marked "Awaiting Accounting posting", and they aren't counted in depreciation, the
  reconciliation, reports or the dashboard, nor transferred, disposed of or revalued. Unposting takes them out again.
  Items brought in through Data Import or completed from CIP are in the registry from the start.
- **RIS from the Inventory Registry:** the GSO ticks items on hand in the Inventory Registry and clicks **Issue RIS**.
  Each quantity is drawn from the posted AIRs holding that stock number, oldest delivery first (one RIS may draw from
  several AIRs; the RIS shows which). Cancelling it returns the quantities to those AIRs.
- **Reserved, not deducted:** an RIS issued but not yet posted by Accounting does not reduce the Inventory Registry
  balance; it shows as **Reserved**, and **Available** = balance − reserved (what can still be issued). When Accounting
  posts the RIS it becomes an issue on the Stock Card and reduces the balance.
- **RIS posted only after its AIR:** the GSO may prepare and issue the RIS any time after approval, but Accounting can
  post an RIS (through its RSMI) only once its AIR is posted. An RIS issued before the AIR is posted counts in the
  Inventory Registry from when the AIR is posted.
- **RSMI — the GSO picks the RIS, Accounting posts them:** Reports → RSMI → New RSMI lists, by RIS date, the RIS that
  Accounting has **not yet posted** and that are on no other RSMI, for a month or any from–to date coverage. The GSO
  ticks the RIS to include and saves the RSMI (numbered like the other forms). Accounting then posts the RSMI — from the
  RSMI itself or from For Posting — and that posts every RIS on it with the same JEV; an RIS is never posted on its own.
  Each RIS's AIR must be posted first. A submitted RSMI can be cancelled by the GSO, which frees its RIS. The
  **recapitulation is the proposed accounting entry**: each expense account debited (e.g. 50203010 Office Supplies
  Expenses) and each inventory account credited, on screen and on the printed RSMI (A4 portrait).
- **Posting by AIR, with a checklist:** For Posting shows one row per AIR. Posting it lists the AIR and each PAR, ICS and
  ICS with a tick box, all ticked; everything ticked is posted under one JEV. RIS are posted through their RSMI (its own
  row in For Posting). Disposals and repairs are posted on their own rows.
- **Property No. / Inventory Item No.** are suggested on the PAR / ICS as *year purchased – asset group – sub-major
  account – general ledger – series*, e.g. 10705020 Office Equipment bought in 2026 → **2026-07-05-02-0001**; the series
  runs per year across all accounts, and a number can't be used twice.
- **The GSO corrects the items at inspection** (description, specifications, unit, quantity, unit cost); the change is
  recorded on the AIR. Stock numbers of supplies are suggested from the Inventory Registry: the item's own if it is
  already there, otherwise the next in its account's series.
- **Renumbering 2026 documents:** the GSO can change the number of an AIR, PAR, ICS or RIS **dated 2026** (Change
  number). The new number must be free in the fund; the old one is released, and the AIR No. on its PAR / ICS / RIS and
  the numbers on the items follow. The PAR / ICS / RIS list links each document to its AIR.

### Attachments (signed PAR / ICS / RIS and other documents)

**On the AIR**, End-Users of the office (and the GSO / Accounting) attach the **photo** and the **invoice** (also the
delivery receipt or PO). **An AIR can be submitted to the GSO only once a photo and an invoice (or delivery
receipt) are attached:** save it as a draft, attach both on its page, then submit. Once the GSO approves the AIR, each file is shown and downloaded as
*<AIR No.>-<type of document>*, e.g. `2026-10-0007-Invoice.pdf`. **On each SWA**, the GSO and Accounting upload the
scanned SWA; choosing an SWA on a CIP billing fills in its amount and particulars.

The GSO and Accounting can attach the signed copy — or any supporting document — to a **PAR, ICS or RIS**, a **PTR /
ITR / PRS / RRSP / disposal**, or an **item in the register**: a PDF, JPG or PNG up to 5 MB, or a link (e.g. Google
Drive). An item's page also shows what is attached to its PAR / ICS and its transfers, and the registries and the
PAR / ICS / RIS list mark what has an attachment. End-Users can open the attachments of their own office's documents
and property. Files are kept in Firestore itself (split into 600 KB pieces), because Firebase Storage needs a paid plan;
Firestore's free tier holds 1 GB.

### Trial Balance reconciliation

Paste the Trial Balance from Excel or upload the file (account code, name, debit, credit). For the
chosen month end the app compares, account by account:
- **PPE:** cost (debit) and accumulated depreciation (credit of the cost account + 1).
- **Semi-expendable property:** cost.
- **Inventory:** supplies on hand, valued from the Stock Cards.

Construction in Progress counts on its CIP account until it is transferred to PPE. Differences under
₱1 count as rounding. Tested with your **December 2025 Trial Balance** and the PMS
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
  Stock Card, the Supplies Ledger Card and the RSMI.

### Roles

| Role | Can do |
| --- | --- |
| **End-User** | Encode, submit and correct **their own** AIRs, and see every submitted AIR of **their office** (colleagues' drafts stay private). See **Office Property** (every item held by their office, their own marked "You") and the PAR / ICS / RIS of their office. Record **repairs** of items under their own name. |
| **GSO** | See all AIRs. Inspect, approve or return. Issue and cancel PAR, ICS and RIS. Transfers, returns and disposals. Verify repairs. Encode SWAs. Correct records, cards and QR tags. Registries and reports. |
| **Accounting** | See everything. Post and unpost documents and disposals. Depreciation. Trial Balance reconciliation. Construction in Progress (projects, billings, SWA matching, transfer to PPE). Correct cost and opening balances, revalue, impairments and adjustments, reclassify, reactivate. |
| **Admin** | Everything above, plus approving users, assigning End-User, GSO and Accounting roles, settings and the audit trail. |
| **Super Admin** | Everything, including assigning and removing **Admins**. |

The **Firestore security rules** (`firestore.rules`) enforce these on the server, not just in the
menus. For example, an End-User cannot read another office's AIR, and the GSO cannot mark a
document as posted.

### Screens

Dashboard · Office Property · New AIR / Office AIRs / All AIRs · For Inspection · For Issuance · PAR / ICS / RIS ·
PPE Registry · Semi-Expendable Registry · asset page (Property Card, history, depreciation) ·
Transfers, Returns & Disposals · History of Repair · CIP Projects · SWA · Inventory Registry of supplies — consumable and for distribution (Stock Card + Supplies Ledger Card) ·
For Posting · Posting Status · Depreciation · TB Reconciliation · Reports (RSMI, Summary by
Account, AIR Monitoring, Accountability, Disposed / Retired) · Users & Roles · Data Import · Settings · Audit Trail ·
My Profile.
Every list can be downloaded as a CSV. **Everything prints on A4**: forms such as the AIR, PAR, ICS, RIS, PTR and JEV
in portrait; the Inventory Registry — Supplies, Stock Cards, Supplies Ledger Cards and the RSMI in portrait;
Ledger / Property / CIP cards and the wide reports in landscape; ID tags on an A4 sheet. Chrome and
Edge pick A4 and the orientation automatically; Safari and Firefox show a reminder to choose A4 (and Landscape) in the
print dialog.

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
   disposed history. Items on a **Construction in Progress** account become **CIP projects**,
   with their cost as a "balance brought forward" billing.
5. Depreciation continues here from the following month.

**Accounts:** the PMS register export has no account code, only the account name ("Category"). Names are matched
ignoring case, punctuation and "&"/"and", including PMS's older semi-expendable names. Any account the file names
that is not in the chart, or rows with no account, are listed under **Accounts not recognised** in the preview:
choose the account for each and apply, and the file is read again. A missing account can be added in
**Settings → Chart of accounts** first.

**Pending PAR / ICS from PMS:** the PAR and ICS that PMS still shows as *Pending* (issued, not yet recorded in its
Asset Register).
1. Upload the PMS daily backup `firestore-export.json` (it has everything, including who received the property), or
   PMS's *PAR / ICS → Download CSV* with the status filter on Pending or All, or the template. The CSV has no
   "Received by" name, so the office stands in for it unless you add a *Received by* column.
2. PAR / ICS shown as *Recorded* in PMS are skipped: their items come in with the property register. Numbers
   already here are skipped too.
3. Each one keeps its PMS number and comes in as an issued PAR / ICS with no AIR, waiting for Accounting on
   **For Posting** (filter "PAR / ICS without an AIR (from PMS)"). Its item enters the registry once Accounting
   posts it. Until then the GSO can cancel it, and its item is cancelled with it.

**CIP from PMS:** upload the file you use with PMS's *Bulk import CIP billings* (one billing per
row, with its header row), or PMS's *CIP Projects → Export CSV* (one total per project). Projects
already transferred in PMS are skipped.

**SWA (bulk upload):** upload many Statements of Work Accomplished at once — one per row with Fund, Date, SWA No.,
CIP No., Contractor, Percent, Cost, Particulars, Document (link to the scanned SWA) and Remarks. Use the template, or
the **SWA → CSV** download. Each SWA comes in unmatched, for Accounting to match to its CIP billing; an SWA No. already
in the fund, or repeated in the file, is skipped.

**Supplies from IMS:**
1. In IMS, open the **Inventory Registry** and click **Download CSV**.
2. Upload it here with the date the balances are as of.
3. Each fund's supplies on hand become one already-posted **beginning-balance AIR**
   (`BB-<date>`). The GSO issues from it with a normal RIS, and the Stock Cards start from these
   balances.
4. A fund that already has a beginning balance can be imported into again (for supplies left out the first time):
   a warning shows, Import asks to confirm, and the file comes in as another beginning-balance AIR (`BB-<date>-2`, …)
   **added** to the first — it does not replace it, so import only what was not brought over yet.

Then check the result in **TB Reconciliation** against the Trial Balance of that month.

---

### 7. Bring over the PMS users and set the document numbers

**Users.** PMS runs on its own Firebase project (`mgo-candoni-ppe`), so its users are brought over from its files:
1. Get the PMS user list — either the PMS daily backup `firestore-export.json` (it holds `user_roles`), and/or the
   sign-in accounts, exported by the PMS project owner:
   `npx firebase auth:export pms-users.json --format=json --project mgo-candoni-ppe`.
2. In **Data Import → Users from PMS**, load the file(s) (or paste `email, name, role, office, position` lines), check
   each person's suggested role and office, and click **Bring over**. PMS Admins become Admin (only the Super
   Administrator can give that), PMS staff who edit the register / depreciation / reconciliation / CIP become
   Accounting, those who edit only PAR / ICS / PTR / ITR become GSO, view-only users start as End-User. Requests that
   were never approved in PMS are left unticked.
3. Each person gets an invitation. The first time they sign in here with that email — Google, or email and password
   once the email is confirmed — their account opens straight away with that role and office.

People keep their own Google sign-in. Email/password users create a password here the first time ("Create an account"
with the same email). To carry the PMS passwords over too, the Firebase project owner can run
`npx firebase auth:import pms-users.json --hash-algo=SCRYPT --rounds=8 --mem-cost=14 --hash-key=… --salt-separator=…
--project candoni-pms-ims`, using the password-hash parameters shown in the PMS project's Firebase console
(Authentication → Users → ⋮ → Password hash parameters).

**Document numbers.** In **Settings → Document numbering**, each document (AIR, PAR, ICS, RIS, PTR, ITR, PRS, RRSP,
disposal report) is either:
- **Automatic** — with its own format (`{YYYY}` `{YY}` `{MM}` `{FUND}` `{CLASS}` and `{####}` for the sequence, e.g.
  `PAR-{YYYY}-{#####}`), when the numbers restart (every month, every year, or never) and the starting number of each
  new series. Under it, **Next number of each series** lets you continue from the last number used in PMS (for
  example, set the next PAR to 58); or
- **Manual** — the person saving the document types the number (e.g. from a pre-numbered form). The AIR number is always
  given by the GSO when approving the AIR — the next in the series, or typed by the GSO when AIR numbering is manual.

Each fund has its own series, and every number — automatic or typed — is checked so it is never used twice in a fund.
The default is the PMS / IMS format: `2026-10-0001`, and `SPLV-` / `SPHV-2026-10-0001` for ICS.

## Data model (Firestore)

| Collection | One document per | Notes |
| --- | --- | --- |
| `users/{uid}` | person | `role`, `status` (pending / active / disabled / declined), office, position |
| `airs/{id}` | AIR | header, `lines[]` (category, account, stock no., **issuedQty**), `inspection`, `acceptance`, `status`, `posting` (supply receipt), `history[]` |
| `issuances/{id}` | PAR / ICS / RIS | `docType`, `number`, `airId`, `lines[]` (each linked to its AIR line), `recipient`, `status` (issued / cancelled), `posting` |
| `assets/{id}` | property record (PAR / ICS line, import row, or split part) | PPE or semi-expendable, cost, residual, useful life, holder, status (active / returned / disposed / cancelled), `depBaseline` (opening accumulated depreciation), `special` / `components` (card details), `revaluations[]`, `adjustments[]`, `accountChanges[]`, `fundChanges[]`, `reactivations[]`, `parIcs`, `history[]` |
| `movements/{id}` | PTR / ITR / PRS / RRSP / disposal | lines with the items moved; disposals and donations carry `posting` |
| `depreciation/{fund_YYYY-MM}` | posted month | JEV no., amount per item, summary by account |
| `tbSnapshots/{fund_YYYY-MM}` | Trial Balance | account → debit / credit |
| `cipProjects/{id}` | CIP project | `billings[]` (by contract / by administration, matched SWA), status, `completed` (transfer to PPE) |
| `swa/{id}` | Statement of Work Accomplished | SWA No., CIP No., cost, % done, document link, `matched` |
| `repairs/{id}` | repair job order | item, job order, supplier, `parts[]`, total, status (submitted / returned / verified) |
| `counters/{fund_TYPE_period}` | numbering series | per fund, document and month / year / running series; increases by one inside a transaction; the admin can set the next number |
| `docNumbers/{fund_type_number}` | number used | claimed once, with the document, so no number is ever used twice |
| `attachments/{id}` (+ `/chunks/{n}`) | attached document | label, file name, size, or link; the file in 600 KB pieces |
| `invites/{email}` | person brought over from PMS | role, office, position; used on their first sign-in |
| `settings/app` | — | entity, offices, thresholds, signatories |
| `auditLogs/{id}` | action | append-only; readable by admins |

Issuing a PAR, ICS or RIS runs in **one transaction** that reads the AIR, checks the remaining
quantity, takes the next number and saves both documents. Two GSO staff working at the same time
can never over-issue an item or get the same number.

## Repository layout

```
public/                 ← what Netlify serves
  index.html
  assets/app.css        ← design system (shell, components) + official form print styles
  js/firebase-config.js ← your project's web config (step 2)
  js/fb.js              ← Firebase SDK (v10.12.2 from gstatic)
  js/state.js           ← live listeners chosen by role
  js/data.js            ← every write (transactions)
  js/print.js           ← AIR, PAR, ICS, RIS, Stock Card, SLC, RSMI layouts
  js/core/catalog.js    ← funds, roles, thresholds, account catalogs (PPE, SX, Inventory)
  js/core/logic.js      ← AIR / issuance / posting rules (pure; shared with the tests)
  js/core/assets.js     ← depreciation, movements, reconciliation, TB gate, import parsing (pure)
  js/core/cards.js      ← Ledger / Property Card timeline, special card groups, search (pure)
  js/views/*.js         ← screens
firestore.rules         ← server-side access control
tests/                  ← logic tests + security-rules tests
netlify.toml, firebase.json, firestore.indexes.json
```

## Testing

```sh
npm install
npm run test:logic     # business rules: thresholds, numbering, issuance, stock cards, RSMI,
                       # depreciation, movements, TB parsing/reconciliation, PMS/IMS import,
                       # revaluation / reclassification / impairment, card timeline, TB gate
npm run test:rules     # security rules on the Firestore emulator (needs Java 11+)
```

To try the whole app locally without touching your real project:
```sh
npx firebase emulators:start --only auth,firestore --project demo-pmsims
npm run serve          # then open http://localhost:5173/?emulator
```
The `?emulator` switch works only on `localhost`.
