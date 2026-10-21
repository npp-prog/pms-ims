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

// [group, code, name] — PPE accounts (from PMS ACCOUNT_CATALOG, finished-asset accounts only;
// Construction in Progress is not delivered through an AIR).
export const PPE_ACCOUNTS = [
  ["Land & Land Improvements", "10702010", "Land Improvements, Aquaculture Structures"],
  ["Land & Land Improvements", "10702990", "Other Land Improvements"],
  ["Infrastructure Assets", "10703010", "Road Networks"],
  ["Infrastructure Assets", "10703020", "Flood Control Systems"],
  ["Infrastructure Assets", "10703040", "Water Supply Systems"],
  ["Infrastructure Assets", "10703050", "Power Supply Systems"],
  ["Infrastructure Assets", "10703060", "Communication Networks"],
  ["Infrastructure Assets", "10703990", "Other Infrastructure Assets"],
  ["Buildings & Structures", "10704010", "Buildings"],
  ["Buildings & Structures", "10704020", "School Buildings"],
  ["Buildings & Structures", "10704030", "Hospitals and Health Centers"],
  ["Buildings & Structures", "10704990", "Other Structures"],
  ["Machinery & Equipment", "10705010", "Machinery"],
  ["Machinery & Equipment", "10705020", "Office Equipment"],
  ["Machinery & Equipment", "10705030", "Information and Communication Technology Equipment"],
  ["Machinery & Equipment", "10705040", "Agricultural and Forestry Equipment"],
  ["Machinery & Equipment", "10705050", "Marine and Fishery Equipment"],
  ["Machinery & Equipment", "10705070", "Communication Equipment"],
  ["Machinery & Equipment", "10705080", "Construction and Heavy Equipment"],
  ["Machinery & Equipment", "10705090", "Disaster Response and Rescue Equipment"],
  ["Machinery & Equipment", "10705100", "Military, Police and Security Equipment"],
  ["Machinery & Equipment", "10705110", "Medical Equipment"],
  ["Machinery & Equipment", "10705120", "Printing Equipment"],
  ["Machinery & Equipment", "10705130", "Sports Equipment"],
  ["Machinery & Equipment", "10705140", "Technical and Scientific Equipment"],
  ["Machinery & Equipment", "10705990", "Other Machinery and Equipment"],
  ["Transportation Equipment", "10706010", "Motor Vehicles"],
  ["Transportation Equipment", "10706040", "Watercrafts"],
  ["Transportation Equipment", "10706990", "Other Transportation Equipment"],
  ["Furniture, Fixtures & Books", "10707010", "Furniture and Fixtures"],
  ["Furniture, Fixtures & Books", "10707020", "Books"],
  ["Other PPE", "10799990", "Other Property, Plant and Equipment"],
  ["Intangible Assets", "10901020", "Computer Software"]
];

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
export const accountCategory = code => {
  const c = String(code || "");
  if (PPE_ACCOUNTS.some(a => a[1] === c)) return "ppe";
  if (SX_ACCOUNTS.some(a => a[1] === c)) return "sx";
  if (INV_ACCOUNTS.some(a => a[1] === c)) return "cons";
  return "";
};
/** A distribution account (1040 2xxx) means a RIS issue is a Distribution, else a Consumption. */
export const isDistributionAccount = code => String(code || "").startsWith("10402");
