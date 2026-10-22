// Reference data shared by the website and the tests: funds, roles, thresholds and the
// chart-of-accounts catalogs carried over from PMS (PPE + Semi-Expendable) and IMS (Inventory).

export const SUPERADMIN_EMAILS = ["npp@mgocandoniaccounting.org"]; // must match firestore.rules

export const FUNDS = [
  { code: "GF", name: "General Fund" },
  { code: "SEF", name: "Special Education Fund" },
  { code: "TF", name: "Trust Fund" }
];
export const fundName = code => (FUNDS.find(f => f.code === code) || { name: code || "" }).name;

export const ROLES = ["superadmin", "admin", "accounting", "gso", "enduser"];
export const ROLE_NAMES = {
  superadmin: "Super Administrator", admin: "Administrator", accounting: "Accounting",
  gso: "General Services Office", enduser: "End-User"
};

/** COA thresholds: PPE is capitalised at ₱50,000 and up; Semi-Expendable below that is split
 *  into Low Value (≤ ₱5,000, SPLV) and High Value (> ₱5,000, SPHV) — the same split PMS uses. */
export const DEFAULT_THRESHOLDS = { capitalization: 50000, sxHighValue: 5000 };

/** The three kinds of AIR line and the document the GSO issues for each. */
export const CATEGORIES = {
  ppe: { label: "Property, Plant & Equipment", short: "PPE", doc: "par" },
  sx: { label: "Semi-Expendable Property", short: "Semi-Expendable", doc: "ics" },
  cons: { label: "Supplies / Inventory (consumed or distributed)", short: "Supplies", doc: "ris" }
};
export const DOC_TYPES = {
  par: { label: "Property Acknowledgment Receipt", short: "PAR", category: "ppe", registry: "PPE Ledger Card / Property Card" },
  ics: { label: "Inventory Custodian Slip", short: "ICS", category: "sx", registry: "Semi-Expendable Property Ledger Card / RegSPI" },
  ris: { label: "Requisition and Issue Slip", short: "RIS", category: "cons", registry: "Supplies Ledger Card / RSMI" }
};

// PPE accounts — the full PMS catalog: [group, code, name, depreciable, depreciation expense code, default useful life (years)].
// Default lives are the ones used most in the MGO Candoni PMS register (Dec 2025 baseline); every asset keeps its own,
// editable useful life. The accumulated depreciation account is always the cost account + 1 (e.g. 10705020 → 10705021).
export const PPE_ACCOUNTS = [
  ["Land & Land Improvements", "10701010", "Land", false, "", 0],
  ["Land & Land Improvements", "10702010", "Land Improvements, Aquaculture Structures", true, "50501020", 10],
  ["Land & Land Improvements", "10702990", "Other Land Improvements", true, "50501020", 10],
  ["Infrastructure Assets", "10703010", "Road Networks", true, "50501030", 20],
  ["Infrastructure Assets", "10703020", "Flood Control Systems", true, "50501030", 20],
  ["Infrastructure Assets", "10703030", "Sewer Systems", true, "50501030", 20],
  ["Infrastructure Assets", "10703040", "Water Supply Systems", true, "50501030", 20],
  ["Infrastructure Assets", "10703050", "Power Supply Systems", true, "50501030", 20],
  ["Infrastructure Assets", "10703060", "Communication Networks", true, "50501030", 20],
  ["Infrastructure Assets", "10703070", "Seaport Systems", true, "50501030", 20],
  ["Infrastructure Assets", "10703080", "Airport Systems", true, "50501030", 20],
  ["Infrastructure Assets", "10703090", "Parks, Plazas and Monuments", true, "50501030", 20],
  ["Infrastructure Assets", "10703990", "Other Infrastructure Assets", true, "50501030", 20],
  ["Buildings & Structures", "10704010", "Buildings", true, "50501040", 30],
  ["Buildings & Structures", "10704020", "School Buildings", true, "50501040", 30],
  ["Buildings & Structures", "10704030", "Hospitals and Health Centers", true, "50501040", 30],
  ["Buildings & Structures", "10704040", "Markets", true, "50501040", 30],
  ["Buildings & Structures", "10704050", "Slaughterhouses", true, "50501040", 30],
  ["Buildings & Structures", "10704060", "Hostels and Dormitories", true, "50501040", 30],
  ["Buildings & Structures", "10704990", "Other Structures", true, "50501040", 20],
  ["Machinery & Equipment", "10705010", "Machinery", true, "50501050", 10],
  ["Machinery & Equipment", "10705020", "Office Equipment", true, "50501050", 5],
  ["Machinery & Equipment", "10705030", "Information and Communication Technology Equipment", true, "50501050", 5],
  ["Machinery & Equipment", "10705040", "Agricultural and Forestry Equipment", true, "50501050", 10],
  ["Machinery & Equipment", "10705050", "Marine and Fishery Equipment", true, "50501050", 10],
  ["Machinery & Equipment", "10705060", "Airport Equipment", true, "50501050", 10],
  ["Machinery & Equipment", "10705070", "Communication Equipment", true, "50501050", 5],
  ["Machinery & Equipment", "10705080", "Construction and Heavy Equipment", true, "50501050", 10],
  ["Machinery & Equipment", "10705090", "Disaster Response and Rescue Equipment", true, "50501050", 5],
  ["Machinery & Equipment", "10705100", "Military, Police and Security Equipment", true, "50501050", 5],
  ["Machinery & Equipment", "10705110", "Medical Equipment", true, "50501050", 5],
  ["Machinery & Equipment", "10705120", "Printing Equipment", true, "50501050", 5],
  ["Machinery & Equipment", "10705130", "Sports Equipment", true, "50501050", 5],
  ["Machinery & Equipment", "10705140", "Technical and Scientific Equipment", true, "50501050", 5],
  ["Machinery & Equipment", "10705990", "Other Machinery and Equipment", true, "50501050", 5],
  ["Transportation Equipment", "10706010", "Motor Vehicles", true, "50501060", 7],
  ["Transportation Equipment", "10706020", "Trains", true, "50501060", 7],
  ["Transportation Equipment", "10706030", "Aircrafts and Aircrafts Ground Equipment", true, "50501060", 7],
  ["Transportation Equipment", "10706040", "Watercrafts", true, "50501060", 7],
  ["Transportation Equipment", "10706990", "Other Transportation Equipment", true, "50501060", 7],
  ["Furniture, Fixtures & Books", "10707010", "Furniture and Fixtures", true, "50501070", 5],
  ["Furniture, Fixtures & Books", "10707020", "Books", true, "50501070", 5],
  ["Construction in Progress", "10710010", "Construction in Progress - Land Improvements", false, "", 0],
  ["Construction in Progress", "10710020", "Construction in Progress - Infrastructure Assets", false, "", 0],
  ["Construction in Progress", "10710030", "Construction in Progress - Buildings and Other Structures", false, "", 0],
  ["Other PPE", "10799010", "Work/Zoo Animals", true, "50501990", 10],
  ["Other PPE", "10799990", "Other Property, Plant and Equipment", true, "50501990", 10],
  ["Biological Assets", "10801020", "Plants and Trees", false, "", 0],
  ["Intangible Assets", "10901010", "Patents/Copyrights", true, "50502010", 5],
  ["Intangible Assets", "10901020", "Computer Software", true, "50502010", 5],
  ["Intangible Assets", "10901990", "Other Intangible Assets", true, "50502010", 5],
];
export const DEP_EXPENSE_NAMES = {
  "50501020": "Depreciation - Land Improvements",
  "50501030": "Depreciation - Infrastructure Assets",
  "50501040": "Depreciation - Buildings and Other Structures",
  "50501050": "Depreciation - Machinery and Equipment",
  "50501060": "Depreciation - Transportation Equipment",
  "50501070": "Depreciation - Furniture, Fixtures and Books",
  "50501990": "Depreciation - Other Property, Plant and Equipment",
  "50502010": "Amortization - Intangible Assets"
};
/** Infrastructure accounts carry a zero residual value (PMS rule); every other PPE account 5% of cost. */
export const ZERO_RESIDUAL_ACCOUNTS = ["10703010", "10703020", "10703030", "10703040", "10703050", "10703060", "10703070", "10703080", "10703090", "10703990"];


// Semi-Expendable accounts (PMS SX_ACCOUNT_CATALOG, with the 2026-09 relabel applied).
export const SX_ACCOUNTS = [
  ["Semi-Expendable Machinery and Equipment", "10405010", "Semi-Expendable Machinery"],
  ["Semi-Expendable Machinery and Equipment", "10405020", "Semi-Expendable Office Equipment"],
  ["Semi-Expendable Machinery and Equipment", "10405030", "Semi-Expendable Information and Communications Technology Equipment"],
  ["Semi-Expendable Machinery and Equipment", "10405040", "Semi-Expendable Agricultural and Forestry Equipment"],
  ["Semi-Expendable Machinery and Equipment", "10405050", "Semi-Expendable Marine and Fishery Equipment"],
  ["Semi-Expendable Machinery and Equipment", "10405060", "Semi-Expendable Airport Equipment"],
  ["Semi-Expendable Machinery and Equipment", "10405070", "Semi-Expendable Communications Equipment"],
  ["Semi-Expendable Machinery and Equipment", "10405080", "Semi-Expendable Construction and Heavy Equipment"],
  ["Semi-Expendable Machinery and Equipment", "10405090", "Semi-Expendable Disaster Response and Rescue Equipment"],
  ["Semi-Expendable Machinery and Equipment", "10405100", "Semi-Expendable Military, Police and Security Equipment"],
  ["Semi-Expendable Machinery and Equipment", "10405110", "Semi-Expendable Medical Equipment"],
  ["Semi-Expendable Machinery and Equipment", "10405120", "Semi-Expendable Printing Equipment"],
  ["Semi-Expendable Machinery and Equipment", "10405130", "Semi-Expendable Sports Equipment"],
  ["Semi-Expendable Machinery and Equipment", "10405140", "Semi-Expendable Technical and Scientific Equipment"],
  ["Semi-Expendable Machinery and Equipment", "10405990", "Semi-Expendable Other Machinery and Equipment"],
  ["Semi-Expendable Furniture, Fixtures and Books", "10406010", "Semi-Expendable Furniture and Fixtures"],
  ["Semi-Expendable Furniture, Fixtures and Books", "10406020", "Semi-Expendable Books"]
];

// Inventory accounts (IMS ACCOUNT_CATALOG) with the suggested expense account on issue.
export const INV_ACCOUNTS = [
  ["Inventory Held for Distribution", "10402010", "Food Supplies for Distribution", "50299080"],
  ["Inventory Held for Distribution", "10402020", "Welfare Goods for Distribution", "50203060"],
  ["Inventory Held for Distribution", "10402030", "Drugs and Medicines for Distribution", "50203070"],
  ["Inventory Held for Distribution", "10402040", "Medical, Dental and Laboratory Supplies for Distribution", "50203080"],
  ["Inventory Held for Distribution", "10402050", "Agricultural and Marine Supplies for Distribution", "50203100"],
  ["Inventory Held for Distribution", "10402070", "Textbooks and Instructional Materials for Distribution", "50203110"],
  ["Inventory Held for Distribution", "10402080", "Construction Materials for Distribution", ""],
  ["Inventory Held for Distribution", "10402990", "Other Supplies and Materials for Distribution", "50203990"],
  ["Inventory Held for Consumption", "10404010", "Office Supplies Inventory", "50203010"],
  ["Inventory Held for Consumption", "10404020", "Accountable Forms, Plates and Stickers", "50203020"],
  ["Inventory Held for Consumption", "10404030", "Non-Accountable Forms Inventory", "50203030"],
  ["Inventory Held for Consumption", "10404040", "Animal/Zoological Supplies Inventory", "50203040"],
  ["Inventory Held for Consumption", "10404050", "Food Supplies Inventory", "50203050"],
  ["Inventory Held for Consumption", "10404060", "Drugs and Medicines Inventory", "50203070"],
  ["Inventory Held for Consumption", "10404070", "Medical, Dental and Laboratory Supplies Inventory", "50203080"],
  ["Inventory Held for Consumption", "10404080", "Fuel, Oil and Lubricants Inventory", "50203090"],
  ["Inventory Held for Consumption", "10404090", "Agricultural and Marine Supplies Inventory", "50203100"],
  ["Inventory Held for Consumption", "10404100", "Textbooks and Instructional Materials Inventory", "50203110"],
  ["Inventory Held for Consumption", "10404110", "Military, Police and Traffic Supplies Inventory", "50203120"],
  ["Inventory Held for Consumption", "10404120", "Chemical and Filtering Supplies Inventory", "50203130"],
  ["Inventory Held for Consumption", "10404130", "Construction Materials Inventory", ""],
  ["Inventory Held for Consumption", "10404990", "Other Supplies and Materials Inventory", "50203990"]
];

export const ACCOUNTS_BY_CATEGORY = { ppe: PPE_ACCOUNTS, sx: SX_ACCOUNTS, cons: INV_ACCOUNTS };
const ALL = [...PPE_ACCOUNTS, ...SX_ACCOUNTS, ...INV_ACCOUNTS];
export const accountName = code => (ALL.find(a => a[1] === String(code)) || [])[2] || "";
/** PPE account details: { group, code, name, depreciable, expCode, expName, adCode, life }. */
export function ppeAccount(code) {
  const r = PPE_ACCOUNTS.find(a => a[1] === String(code));
  if (!r) return null;
  return { group: r[0], code: r[1], name: r[2], depreciable: r[3], expCode: r[4], expName: DEP_EXPENSE_NAMES[r[4]] || "", adCode: String(Number(r[1]) + 1), life: r[5] };
}
export const isSxAccount = code => SX_ACCOUNTS.some(a => a[1] === String(code));
/** Looks an account up by its code or, failing that, by its exact name (PMS exports carry the name only). */
export function accountByCodeOrName(code, name) {
  const c = String(code || "").replace(/\.0+$/, "").trim();
  if (c && ALL.some(a => a[1] === c)) return c;
  const n = String(name || "").trim().toLowerCase();
  const hit = n && ALL.find(a => a[2].toLowerCase() === n);
  return hit ? hit[1] : "";
}
export const accountCategory = code => {
  const c = String(code || "");
  if (PPE_ACCOUNTS.some(a => a[1] === c)) return "ppe";
  if (SX_ACCOUNTS.some(a => a[1] === c)) return "sx";
  if (INV_ACCOUNTS.some(a => a[1] === c)) return "cons";
  return "";
};
/** A distribution account (1040 2xxx) means a RIS issue is a Distribution, else a Consumption. */
export const isDistributionAccount = code => String(code || "").startsWith("10402");

/** Offices of the Municipal Government of Candoni, offered as a dropdown everywhere an office is chosen
 *  (registration, AIR, PAR/ICS/RIS, transfers). Administrators can change the list in Settings. Office
 *  names must match exactly: End-Users see the property of their own office by this name. */
export const DEFAULT_OFFICES = [
  "Office of the Municipal Mayor",
  "Office of the Municipal Vice Mayor",
  "Sangguniang Bayan",
  "Municipal Administrator's Office",
  "Human Resource Management Office",
  "Municipal Planning and Development Office",
  "Municipal Budget Office",
  "Municipal Accounting Office",
  "Municipal Treasurer's Office",
  "Municipal Assessor's Office",
  "Municipal Civil Registrar's Office",
  "General Services Office",
  "Municipal Engineering Office",
  "Municipal Health Office",
  "Municipal Social Welfare and Development Office",
  "Municipal Agriculture Office",
  "Municipal Disaster Risk Reduction and Management Office",
  "Municipal Environment and Natural Resources Office",
  "Business Permits and Licensing Office",
  "Municipal Tourism Office",
  "Public Employment Service Office",
  "Municipal Economic Enterprise (Public Market)"
];
/** How offices are written in the PMS register's Location column → the standard name. */
const OFFICE_ALIASES = [
  [/\b(mayor'?s? office|office of the (municipal )?mayor|mayor'?s motorpool|mayors office)/i, "Office of the Municipal Mayor"],
  [/\bvice mayor/i, "Office of the Municipal Vice Mayor"],
  [/\b(sb office|sangguniang bayan)/i, "Sangguniang Bayan"],
  [/\bdisaster risk|\bmdrrmo|\bldrrmo/i, "Municipal Disaster Risk Reduction and Management Office"],
  [/\b(municipal health|rhu\b|rural health)/i, "Municipal Health Office"],
  [/\b(mswdo|social welfare)/i, "Municipal Social Welfare and Development Office"],
  [/\bagricultur/i, "Municipal Agriculture Office"],
  [/\btreasur/i, "Municipal Treasurer's Office"],
  [/\b(human resource|hrmo)/i, "Human Resource Management Office"],
  [/\b(planning and development|mpdo)/i, "Municipal Planning and Development Office"],
  [/\baccounting/i, "Municipal Accounting Office"],
  [/\bbudget/i, "Municipal Budget Office"],
  [/\bassessor/i, "Municipal Assessor's Office"],
  [/\bcivil regist/i, "Municipal Civil Registrar's Office"],
  [/\b(general services|gso\b)/i, "General Services Office"],
  [/\bengineer/i, "Municipal Engineering Office"],
  [/\b(environment and natural|menro)/i, "Municipal Environment and Natural Resources Office"],
  [/\b(business permit|bplo)/i, "Business Permits and Licensing Office"],
  [/\btourism/i, "Municipal Tourism Office"],
  [/\b(public employment|peso\b)/i, "Public Employment Service Office"],
  [/\bpublic market|economic enterprise/i, "Municipal Economic Enterprise (Public Market)"]
];
/** The standard office named in a free-text location/office ("MAYORS OFFICE - MTP" → "Office of the Municipal Mayor"), or "". */
export function officeFromText(text, offices = DEFAULT_OFFICES) {
  const t = String(text || "").trim();
  if (!t) return "";
  const exact = offices.find(o => o.toLowerCase() === t.toLowerCase());
  if (exact) return exact;
  const hit = OFFICE_ALIASES.find(([re]) => re.test(t));
  return hit && offices.includes(hit[1]) ? hit[1] : "";
}
