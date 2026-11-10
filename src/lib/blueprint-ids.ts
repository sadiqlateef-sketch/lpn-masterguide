// Ids of the hand-seeded blueprint rows in supabase/migrations/001_initial_schema.sql.
// tests/blueprint-ids.test.ts fails if these drift from the migration.

export const COURSE_IDS = ["fundamentals", "pharmacology", "med_surg", "maternal_peds"] as const;

export const CLIENT_NEED_IDS = [
  "coordinated_care",
  "safety_infection",
  "health_promotion",
  "psychosocial",
  "basic_care",
  "pharm",
  "risk_reduction",
  "phys_adaptation",
] as const;

export const HESI_DOMAIN_IDS = [
  "fundamentals",
  "pharmacology",
  "med_surg",
  "maternity",
  "pediatrics",
  "mental_health",
  "gerontology",
  "nutrition",
  "leadership",
] as const;

export const NGN_STEP_IDS = [
  "recognize_cues",
  "analyze_cues",
  "prioritize_hypotheses",
  "generate_solutions",
  "take_action",
  "evaluate_outcomes",
] as const;

export type CourseId = (typeof COURSE_IDS)[number];
export type ClientNeedId = (typeof CLIENT_NEED_IDS)[number];
export type HesiDomainId = (typeof HESI_DOMAIN_IDS)[number];
export type NgnStepId = (typeof NGN_STEP_IDS)[number];
