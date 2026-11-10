import type { PracticeView, SkillCheckView, SkillConfidence, SkillRunResult, SkillStepView, SkillSummary, SkillView } from "@/lib/api-types";
import { ApiError } from "./http";
import { PRACTICE_COLUMNS, toPracticeView, type PracticeRow } from "./practice";
import { findSkill, SKILLS, type Skill } from "./skills/bank";
import { check, type UserContext } from "./supabase";

// Skills checklists (F17). The checklists are written in code (skills/bank.ts); the student's runs
// and sign-offs are saved, and each skill ends with its two NCLEX-style questions.

type CheckRow = {
  id: string;
  skill_id: string;
  steps_total: number;
  steps_done: number;
  missed_steps: number[];
  confidence: SkillConfidence;
  checked_at: string;
};

const CHECK_COLUMNS = "id, skill_id, steps_total, steps_done, missed_steps, confidence, checked_at";

function toCheckView(row: CheckRow): SkillCheckView {
  return {
    id: row.id,
    stepsDone: row.steps_done,
    stepsTotal: row.steps_total,
    missedSteps: row.missed_steps ?? [],
    confidence: row.confidence,
    checkedAt: row.checked_at,
  };
}

export function stepViews(skill: Skill): SkillStepView[] {
  return skill.steps.map((s, i) => ({ n: i + 1, text: s.text, why: s.why, critical: Boolean(s.critical) }));
}

function requireSkill(id: string): Skill {
  const skill = findSkill(id);
  if (!skill) throw new ApiError(404, "That skill isn't in the app.", "not_found");
  return skill;
}

export async function listSkills(ctx: UserContext): Promise<SkillSummary[]> {
  const [checks, signoffs] = await Promise.all([
    ctx.supabase.from("skill_checks").select(CHECK_COLUMNS).order("checked_at", { ascending: false }).limit(1000),
    ctx.supabase.from("skill_signoffs").select("skill_id, signed_off_on"),
  ]);
  const checkRows = check(checks, "load skill checks") as CheckRow[];
  const signRows = check(signoffs, "load sign-offs") as { skill_id: string; signed_off_on: string }[];
  return SKILLS.map((skill) => {
    const mine = checkRows.filter((r) => r.skill_id === skill.id);
    return {
      id: skill.id,
      title: skill.title,
      blurb: skill.blurb,
      stepCount: skill.steps.length,
      runs: mine.length,
      lastCheck: mine[0] ? toCheckView(mine[0]) : null,
      signedOffOn: signRows.find((s) => s.skill_id === skill.id)?.signed_off_on ?? null,
    };
  });
}

// The skill's two questions as the student's own practice items, made the first time they're needed.
export async function skillQuestions(ctx: UserContext, skill: Skill): Promise<PracticeView[]> {
  const load = async () =>
    check(
      await ctx.supabase.from("practice_items").select(PRACTICE_COLUMNS).eq("item_type", "skill_mcq").eq("payload->>skill", skill.id).order("created_at"),
      "load skill questions",
    ) as PracticeRow[];
  let rows = await load();
  const keyOf = (r: PracticeRow) => (r.payload as { key?: string }).key ?? "";
  const missing = skill.questions.filter((q) => !rows.some((r) => keyOf(r) === q.key));
  if (missing.length) {
    check(
      await ctx.supabase.from("practice_items").insert(
        missing.map(({ client_need_id, ...q }) => ({
          user_id: ctx.user.id,
          stone_id: null,
          client_need_id,
          item_type: "skill_mcq",
          ngn_step_id: "take_action",
          payload: { ...q, skill: skill.id },
        })),
      ),
      "save skill questions",
    );
    rows = await load();
  }
  // One per question, in the bank's order, even if two tabs made a copy at the same moment.
  return skill.questions.map((q) => rows.find((r) => keyOf(r) === q.key)).filter((r): r is PracticeRow => Boolean(r)).map(toPracticeView);
}

export async function getSkill(ctx: UserContext, id: string): Promise<SkillView> {
  const skill = requireSkill(id);
  const [checks, signoff, questions] = await Promise.all([
    ctx.supabase.from("skill_checks").select(CHECK_COLUMNS).eq("skill_id", id).order("checked_at", { ascending: false }).limit(5),
    ctx.supabase.from("skill_signoffs").select("signed_off_on").eq("skill_id", id).maybeSingle(),
    skillQuestions(ctx, skill),
  ]);
  return {
    id: skill.id,
    title: skill.title,
    blurb: skill.blurb,
    steps: stepViews(skill),
    history: (check(checks, "load skill checks") as CheckRow[]).map(toCheckView),
    signedOffOn: (check(signoff, "load sign-off") as { signed_off_on: string } | null)?.signed_off_on ?? null,
    questions,
  };
}

// Saves one run through the checklist: which steps were done, and how sure the student felt.
export async function recordSkillRun(ctx: UserContext, id: string, done: readonly number[], confidence: SkillConfidence): Promise<SkillRunResult> {
  const skill = requireSkill(id);
  const total = skill.steps.length;
  const ticked = new Set(done);
  if ([...ticked].some((n) => !Number.isInteger(n) || n < 1 || n > total)) throw new ApiError(400, "That step isn't in this checklist.", "bad_step");
  const steps = stepViews(skill);
  const missed = steps.filter((s) => !ticked.has(s.n));
  const row = check(
    await ctx.supabase
      .from("skill_checks")
      .insert({
        user_id: ctx.user.id,
        skill_id: id,
        steps_total: total,
        steps_done: total - missed.length,
        missed_steps: missed.map((s) => s.n),
        confidence,
      })
      .select(CHECK_COLUMNS)
      .single(),
    "save skill check",
  ) as CheckRow;
  return { check: toCheckView(row), missedCritical: missed.filter((s) => s.critical), questions: await skillQuestions(ctx, skill) };
}

// Records (or clears) the day an instructor signed the skill off.
export async function setSkillSignoff(ctx: UserContext, id: string, signedOffOn: string | null): Promise<{ signedOffOn: string | null }> {
  requireSkill(id);
  if (signedOffOn === null) {
    check(await ctx.supabase.from("skill_signoffs").delete().eq("skill_id", id), "clear sign-off");
    return { signedOffOn: null };
  }
  check(
    await ctx.supabase.from("skill_signoffs").upsert({ user_id: ctx.user.id, skill_id: id, signed_off_on: signedOffOn }, { onConflict: "user_id,skill_id" }),
    "save sign-off",
  );
  return { signedOffOn };
}
