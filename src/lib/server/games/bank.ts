// Fixed content for the games that don't need the student's own stones: PPE order, isolation
// precautions, LPN/RN/UAP scope and lab values. These follow common NCLEX-PN teaching; a course's
// own numbers or state rules win where they differ, and the screens say so.

export type PpeStep = { id: string; text: string; why: string };

// CDC sequence for putting on and taking off PPE (doffing example 1), with hand hygiene at both ends.
export const PPE_DONNING: PpeStep[] = [
  { id: "hh", text: "Hand hygiene", why: "Clean hands before touching clean PPE." },
  { id: "gown", text: "Gown", why: "The gown goes on first so everything else layers over it." },
  { id: "mask", text: "Mask or respirator", why: "Fit the mask or N95 before eye protection, which sits over its straps." },
  { id: "eyes", text: "Goggles or face shield", why: "Eye protection goes on over the mask." },
  { id: "gloves", text: "Gloves", why: "Gloves go on last and pull over the gown's cuffs." },
];

export const PPE_DOFFING: PpeStep[] = [
  { id: "gloves", text: "Gloves", why: "Gloves are the most contaminated, so they come off first." },
  { id: "eyes", text: "Goggles or face shield", why: "Remove by the clean strap or earpieces, without touching the front." },
  { id: "gown", text: "Gown", why: "Pull it away from the body, rolling the outside inward." },
  { id: "mask", text: "Mask or respirator", why: "Touch only the ties or straps. Take off a respirator after leaving the room." },
  { id: "hh", text: "Hand hygiene", why: "Clean hands right after removing all PPE." },
];

export type Precaution = "contact" | "droplet" | "airborne";

export const PRECAUTION_LABELS: Record<Precaution, string> = {
  contact: "Contact",
  droplet: "Droplet",
  airborne: "Airborne",
};

export const PRECAUTION_WHY: Record<Precaution, string> = {
  contact: "Contact: gown and gloves, and dedicated equipment such as a stethoscope.",
  droplet: "Droplet: a surgical mask when close to the client, and a private room or cohorting.",
  airborne: "Airborne: an N95 respirator and an airborne infection isolation (negative-pressure) room with the door closed.",
};

export const ISOLATION_CARDS: { id: string; text: string; precaution: Precaution; extra?: string }[] = [
  { id: "tb", text: "Pulmonary tuberculosis", precaution: "airborne" },
  { id: "measles", text: "Measles (rubeola)", precaution: "airborne" },
  { id: "varicella", text: "Chickenpox (varicella)", precaution: "airborne", extra: "Contact precautions are added until the lesions crust." },
  { id: "zoster", text: "Disseminated shingles (herpes zoster)", precaution: "airborne", extra: "Contact precautions are added too." },
  { id: "flu", text: "Influenza", precaution: "droplet" },
  { id: "pertussis", text: "Pertussis (whooping cough)", precaution: "droplet" },
  { id: "mumps", text: "Mumps", precaution: "droplet" },
  { id: "rubella", text: "Rubella (German measles)", precaution: "droplet" },
  { id: "meningitis", text: "Bacterial meningitis (Neisseria meningitidis)", precaution: "droplet" },
  { id: "mycoplasma", text: "Mycoplasma pneumonia", precaution: "droplet" },
  { id: "cdiff", text: "Clostridioides difficile (C. diff)", precaution: "contact", extra: "Wash hands with soap and water: alcohol rub doesn't kill the spores." },
  { id: "mrsa", text: "MRSA wound infection", precaution: "contact" },
  { id: "vre", text: "Vancomycin-resistant enterococcus (VRE)", precaution: "contact" },
  { id: "scabies", text: "Scabies", precaution: "contact" },
  { id: "lice", text: "Head lice", precaution: "contact" },
  { id: "noro", text: "Norovirus diarrhea in an incontinent client", precaution: "contact" },
];

export type Role = "lpn" | "rn" | "uap";

export const ROLE_LABELS: Record<Role, string> = { lpn: "LPN", rn: "RN", uap: "UAP" };

export const SCOPE_CARDS: { id: string; text: string; role: Role; why: string }[] = [
  { id: "admit", text: "Do the admission assessment on a new client", role: "rn", why: "The initial assessment belongs to the RN; the LPN collects data." },
  { id: "careplan", text: "Write the initial nursing care plan", role: "rn", why: "Planning care starts with the RN; the LPN contributes to it." },
  { id: "teachnew", text: "Teach a client newly diagnosed with diabetes how to inject insulin", role: "rn", why: "Initial teaching is the RN's; the LPN reinforces it afterward." },
  { id: "unstable", text: "Care for a client whose blood pressure fell from 128/80 to 86/50 in an hour", role: "rn", why: "An unstable, changing client goes to the RN." },
  { id: "evaluate", text: "Evaluate whether the care plan's goals were met", role: "rn", why: "Evaluation is an RN responsibility." },
  { id: "blood", text: "Start a blood transfusion and assess for a reaction in the first 15 minutes", role: "rn", why: "Starting blood and the first assessment are RN tasks in most states." },
  { id: "ivpush", text: "Give an IV push medication", role: "rn", why: "Most states keep IV push medications out of LPN scope." },
  { id: "oralmeds", text: "Give scheduled oral medications to a stable client", role: "lpn", why: "Medication administration to stable clients is LPN work." },
  { id: "insulin", text: "Give a scheduled subcutaneous insulin dose to a client with stable diabetes", role: "lpn", why: "The LPN gives subcutaneous and IM medications to stable clients." },
  { id: "dressing", text: "Change a sterile dressing on a healing surgical wound", role: "lpn", why: "Sterile dressing changes on a stable wound are within LPN scope." },
  { id: "foley", text: "Insert an indwelling urinary catheter", role: "lpn", why: "Catheter insertion is a sterile skill the LPN performs." },
  { id: "trach", text: "Suction an established tracheostomy on a stable client", role: "lpn", why: "Routine trach care on a stable client fits LPN scope." },
  { id: "reinforce", text: "Reinforce the RN's teaching about a low-sodium diet", role: "lpn", why: "The LPN reinforces teaching the RN or provider started." },
  { id: "gtube", text: "Give a feeding through an established gastrostomy tube", role: "lpn", why: "Tube feedings through an established tube are LPN tasks." },
  { id: "lungs", text: "Collect lung sounds on a stable client and report changes", role: "lpn", why: "The LPN collects data and reports abnormal findings to the RN." },
  { id: "vitals", text: "Take vital signs on a stable client", role: "uap", why: "Routine vital signs on a stable client can go to a UAP." },
  { id: "bath", text: "Help a client with a bath and oral care", role: "uap", why: "Hygiene and ADLs are UAP tasks." },
  { id: "ambulate", text: "Walk a client who has a steady gait", role: "uap", why: "Ambulating a stable client is a UAP task." },
  { id: "io", text: "Measure and record intake and output", role: "uap", why: "Recording intake and output can be assigned to a UAP; the nurse reviews it." },
  { id: "feed", text: "Feed a client who has no swallowing problems", role: "uap", why: "Feeding a client with no swallowing risk is a UAP task." },
  { id: "turn", text: "Turn and reposition a client every 2 hours", role: "uap", why: "Repositioning a stable client is a UAP task." },
];

export type LabBand = "low" | "normal" | "high";

export const LAB_BAND_LABELS: Record<LabBand, string> = { low: "Low", normal: "Normal or in range", high: "High" };

export type Lab = {
  id: string;
  name: string;
  unit: string;
  range: string;
  samples: Record<LabBand, number[]>;
  low: string;
  high: string;
};

// Adult reference ranges as most nursing textbooks teach them. Sample values sit clearly in a band.
export const LABS: Lab[] = [
  { id: "k", name: "Potassium", unit: "mEq/L", range: "3.5 to 5.0", samples: { low: [2.8, 3.1, 3.2], normal: [3.8, 4.2, 4.6], high: [5.6, 5.9, 6.3] }, low: "Report it; low potassium raises the risk of digoxin toxicity and dysrhythmias.", high: "Report it to the RN now; high potassium can cause dangerous dysrhythmias." },
  { id: "na", name: "Sodium", unit: "mEq/L", range: "135 to 145", samples: { low: [125, 128, 131], normal: [137, 140, 143], high: [149, 152, 155] }, low: "Report it and watch for confusion and seizures.", high: "Report it and watch for thirst, confusion and signs of dehydration." },
  { id: "glu", name: "Fasting blood glucose", unit: "mg/dL", range: "70 to 100", samples: { low: [48, 55, 62], normal: [78, 85, 94], high: [180, 220, 260] }, low: "If the client can swallow, give 15 g of fast-acting carbohydrate, recheck in 15 minutes and report.", high: "Report it and follow the sliding-scale or provider orders." },
  { id: "bun", name: "BUN", unit: "mg/dL", range: "10 to 20", samples: { low: [5, 6, 7], normal: [12, 15, 18], high: [32, 40, 48] }, low: "Report it; it can reflect overhydration or poor intake.", high: "Report it; it can reflect dehydration or kidney problems." },
  { id: "cr", name: "Creatinine", unit: "mg/dL", range: "0.6 to 1.2", samples: { low: [0.3, 0.4], normal: [0.7, 0.9, 1.1], high: [2.1, 2.8, 3.4] }, low: "Report it; it can reflect low muscle mass.", high: "Report it; kidney function is falling, which affects many medication doses." },
  { id: "hgb", name: "Hemoglobin (adult female)", unit: "g/dL", range: "12 to 16", samples: { low: [8.2, 9.0, 10.1], normal: [12.8, 13.5, 14.6], high: [17.5, 18.4] }, low: "Report it; watch for fatigue, pallor and bleeding, and rise slowly to prevent falls.", high: "Report it; it can reflect dehydration." },
  { id: "wbc", name: "White blood cells", unit: "/mm³", range: "5,000 to 10,000", samples: { low: [2100, 3000], normal: [6200, 7800, 9100], high: [14500, 18000] }, low: "Report it; protect the client from infection (neutropenic precautions if ordered).", high: "Report it; check for fever and other signs of infection." },
  { id: "plt", name: "Platelets", unit: "/mm³", range: "150,000 to 400,000", samples: { low: [42000, 88000, 110000], normal: [190000, 250000, 320000], high: [520000, 610000] }, low: "Report it; use bleeding precautions (soft toothbrush, electric razor, no IM injections if avoidable).", high: "Report it; watch for clotting." },
  { id: "inr", name: "INR, client on warfarin (goal 2 to 3)", unit: "", range: "2.0 to 3.0", samples: { low: [1.2, 1.4], normal: [2.2, 2.5, 2.8], high: [4.1, 4.8, 5.5] }, low: "Report it; the client is at risk of clotting.", high: "Hold the warfarin dose, report it and check for bleeding." },
  { id: "ca", name: "Calcium", unit: "mg/dL", range: "9.0 to 10.5", samples: { low: [7.2, 7.8, 8.1], normal: [9.2, 9.6, 10.1], high: [11.4, 12.0] }, low: "Report it; check for tingling, muscle cramps and Chvostek's or Trousseau's sign.", high: "Report it; watch for weakness, constipation and dysrhythmias." },
  { id: "mg", name: "Magnesium", unit: "mEq/L", range: "1.3 to 2.1", samples: { low: [0.9, 1.0], normal: [1.5, 1.8, 2.0], high: [2.8, 3.5] }, low: "Report it; watch for tremors and dysrhythmias.", high: "Report it; check reflexes and respirations, which slow down." },
  { id: "ph", name: "Arterial pH", unit: "", range: "7.35 to 7.45", samples: { low: [7.22, 7.28, 7.31], normal: [7.37, 7.4, 7.43], high: [7.49, 7.52, 7.56] }, low: "Acidosis: report it to the RN now.", high: "Alkalosis: report it to the RN now." },
  { id: "paco2", name: "PaCO₂", unit: "mm Hg", range: "35 to 45", samples: { low: [26, 30, 32], normal: [37, 40, 43], high: [50, 55, 60] }, low: "The client is blowing off CO₂ (often from hyperventilation); report it.", high: "CO₂ is building up (hypoventilation); report it and check breathing." },
  { id: "hco3", name: "Bicarbonate (HCO₃)", unit: "mEq/L", range: "22 to 26", samples: { low: [16, 18, 20], normal: [23, 24, 25], high: [29, 31, 34] }, low: "Points toward metabolic acidosis; report it.", high: "Points toward metabolic alkalosis; report it." },
  { id: "dig", name: "Digoxin level", unit: "ng/mL", range: "0.5 to 2.0", samples: { low: [0.2, 0.3], normal: [0.8, 1.2, 1.6], high: [2.4, 2.8, 3.2] }, low: "Report it; the dose may not be working.", high: "Hold the dose, report it and watch for nausea, vision changes and a slow pulse." },
  { id: "li", name: "Lithium level", unit: "mEq/L", range: "0.6 to 1.2", samples: { low: [0.3, 0.4], normal: [0.7, 0.9, 1.1], high: [1.6, 2.0, 2.4] }, low: "Report it; the dose may not be working.", high: "Hold the dose, report it and watch for vomiting, diarrhea and tremors." },
];
