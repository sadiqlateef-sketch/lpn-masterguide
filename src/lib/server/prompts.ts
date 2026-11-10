// Shared prompt text. Kept byte-stable so prompt caching can reuse it across calls.

export const LPN_SCOPE_RULES = `LPN/LVN scope of practice (every lesson and question must follow it):
- The LPN collects data and reports abnormal findings to the RN or provider; the RN does the initial assessment.
- The LPN reinforces teaching the RN or provider started; the LPN does not create the initial teaching plan.
- The LPN cares for stable clients with predictable outcomes. Unstable, new-admission or changing clients go to the RN.
- The LPN may assign UAPs only tasks in UAP scope (ADLs, vital signs on stable clients, ambulation, intake and output). Never delegate assessment, teaching, evaluation or care of unstable clients.
- Medication safety: the rights of medication administration, allergies, and hold parameters (apical pulse before digoxin, blood pressure before antihypertensives, potassium with loop diuretics). IV therapy limits vary by state.
- Priority frameworks: ABCs, Maslow, safety first, acute before chronic, actual before potential.`;

export const BLUEPRINT_GUIDE = `NCLEX-PN Client Needs ids (test plan weight):
- coordinated_care: Coordinated Care (18-24%): advocacy, client rights, confidentiality, consent, assignment to UAPs, continuity of care
- safety_infection: Safety and Infection Prevention and Control (10-16%): falls, restraints, precautions, error prevention, emergencies
- health_promotion: Health Promotion and Maintenance (6-12%): growth and development, prenatal to older adult, screenings, immunizations
- psychosocial: Psychosocial Integrity (9-15%): coping, grief, abuse, therapeutic communication, substance use, mental health
- basic_care: Basic Care and Comfort (7-13%): ADLs, mobility, elimination, nutrition, sleep, non-drug comfort
- pharm: Pharmacological and Parenteral Therapies (10-16%): medication administration, dosage, effects, side effects, monitoring
- risk_reduction: Reduction of Risk Potential (9-15%): changes in condition, lab values, diagnostic tests, procedure complications
- phys_adaptation: Physiological Adaptation (7-13%): acute, chronic and life-threatening conditions, fluid and electrolytes, emergencies

HESI PN domain ids: fundamentals, pharmacology, med_surg, maternity, pediatrics, mental_health, gerontology, nutrition, leadership

NGN clinical judgment step ids: recognize_cues, analyze_cues, prioritize_hypotheses, generate_solutions, take_action, evaluate_outcomes

Course ids: fundamentals, pharmacology, med_surg, maternal_peds`;
