import { CLIENT_NEED_IDS, COURSE_IDS, HESI_DOMAIN_IDS, NGN_STEP_IDS } from "@/lib/blueprint-ids";
import { generateStructured } from "./anthropic";
import { StoneTagsSchema } from "./ai-schemas";
import { ApiError } from "./http";
import { addTwinPractice } from "./ingest/uworld";
import { relinkAndPractice } from "./path";
import { BLUEPRINT_GUIDE, LPN_SCOPE_RULES } from "./prompts";
import { check, type UserContext } from "./supabase";

export type Blueprint = {
  testPlan: { id: string; label: string; effective_date: string; source_url: string };
  clientNeeds: { id: string; parent_category: string; name: string; min_pct: number; max_pct: number; lpn_focus: string; sort_order: number }[];
  ngnSteps: { id: string; step_order: number; name: string; question: string; lpn_example: string }[];
  hesiDomains: { id: string; name: string; priority: string; classic_hint: string; sort_order: number }[];
  hesiBenchmarks: { id: string; min_score: number; max_score: number | null; label: string; meaning: string }[];
  courses: { id: string; name: string; sort_order: number; default_hesi_domain_id: string | null }[];
};

export type BlueprintCheck = {
  ok: boolean;
  problems: string[];
};

// Reads the hand-seeded reference data. Nothing here is scraped or generated.
export async function loadBlueprint(ctx: UserContext): Promise<Blueprint> {
  const [plans, needs, steps, domains, benchmarks, courses] = await Promise.all([
    ctx.supabase.from("nclex_test_plans").select("id, label, effective_date, source_url").eq("is_current", true),
    ctx.supabase.from("nclex_client_needs").select("id, test_plan_id, parent_category, name, min_pct, max_pct, lpn_focus, sort_order").order("sort_order"),
    ctx.supabase.from("ngn_clinical_judgment_steps").select("id, step_order, name, question, lpn_example").order("step_order"),
    ctx.supabase.from("hesi_pn_domains").select("id, name, priority, classic_hint, sort_order").order("sort_order"),
    ctx.supabase.from("hesi_score_benchmarks").select("id, min_score, max_score, label, meaning").order("min_score", { ascending: false }),
    ctx.supabase.from("courses").select("id, name, sort_order, default_hesi_domain_id").order("sort_order"),
  ]);

  const currentPlans = check(plans, "load test plan") as Blueprint["testPlan"][];
  if (currentPlans.length !== 1) {
    throw new ApiError(500, "The exam blueprint isn't set up. Run the database migrations.", "no_blueprint");
  }
  const testPlan = currentPlans[0];
  const allNeeds = check(needs, "load client needs") as (Blueprint["clientNeeds"][number] & { test_plan_id: string })[];

  return {
    testPlan,
    clientNeeds: allNeeds
      .filter((n) => n.test_plan_id === testPlan.id)
      .map(({ test_plan_id: _plan, ...n }) => ({ ...n, min_pct: Number(n.min_pct), max_pct: Number(n.max_pct) })),
    ngnSteps: check(steps, "load NGN steps") as Blueprint["ngnSteps"],
    hesiDomains: check(domains, "load HESI domains") as Blueprint["hesiDomains"],
    hesiBenchmarks: check(benchmarks, "load HESI benchmarks") as Blueprint["hesiBenchmarks"],
    courses: check(courses, "load courses") as Blueprint["courses"],
  };
}

// Confirms the database matches the ids the app's prompts and schemas rely on.
export function checkBlueprint(blueprint: Blueprint): BlueprintCheck {
  const problems: string[] = [];
  const compare = (label: string, expected: readonly string[], actual: string[]) => {
    const missing = expected.filter((id) => !actual.includes(id));
    const extra = actual.filter((id) => !expected.includes(id));
    if (missing.length) problems.push(`${label} missing in database: ${missing.join(", ")}`);
    if (extra.length) problems.push(`${label} in database but unknown to the app: ${extra.join(", ")}`);
  };
  compare("Client needs", CLIENT_NEED_IDS, blueprint.clientNeeds.map((n) => n.id));
  compare("HESI domains", HESI_DOMAIN_IDS, blueprint.hesiDomains.map((d) => d.id));
  compare("NGN steps", NGN_STEP_IDS, blueprint.ngnSteps.map((s) => s.id));
  compare("Courses", COURSE_IDS, blueprint.courses.map((c) => c.id));

  const low = blueprint.clientNeeds.reduce((sum, n) => sum + n.min_pct, 0);
  const high = blueprint.clientNeeds.reduce((sum, n) => sum + n.max_pct, 0);
  if (low > 100 || high < 100) problems.push(`Client need weights (${low}-${high}%) can't add up to 100%.`);
  for (const n of blueprint.clientNeeds) {
    if (n.min_pct > n.max_pct) problems.push(`${n.name} has min weight above max weight.`);
  }
  return { ok: problems.length === 0, problems };
}

// ---------------------------------------------------------------------------
// Re-tagging stones that have no blueprint tags
// ---------------------------------------------------------------------------

const TAG_BATCH = 40;

type UntaggedStone = { id: string; title: string; summary: string | null; key_topics: string[] };

async function untaggedStones(ctx: UserContext): Promise<UntaggedStone[]> {
  const stones = check(
    await ctx.supabase.from("stepping_stones").select("id, title, summary, key_topics, stone_blueprint_tags(stone_id)").eq("user_id", ctx.user.id),
    "load stones",
  ) as (UntaggedStone & { stone_blueprint_tags: { stone_id: string }[] })[];
  return stones.filter((s) => s.stone_blueprint_tags.length === 0).map(({ stone_blueprint_tags: _tags, ...s }) => s);
}

async function tagBatch(ctx: UserContext, batch: UntaggedStone[]): Promise<number> {
  const listing = batch
    .map((s, i) => `[${i}] ${s.title}: ${s.summary ?? ""}${s.key_topics.length ? ` (${s.key_topics.join(", ")})` : ""}`)
    .join("\n");
  const { stones } = await generateStructured({
    what: "retag-stones",
    schema: StoneTagsSchema,
    system: `You tag LPN/LVN lessons with the NCLEX-PN client needs (1 or 2) and the one HESI PN domain each lesson best fits, with relevance from 0 to 1.\n\n${LPN_SCOPE_RULES}\n\n${BLUEPRINT_GUIDE}`,
    effort: "low",
    maxTokens: 16000,
    content: `Tag every lesson below by its index.\n\n${listing}`,
  });

  const rows = stones.flatMap((entry) => {
    const stone = batch[entry.stone_index];
    if (!stone) return [];
    const seen = new Set<string>();
    return entry.tags
      .filter((t) => !seen.has(`${t.client_need_id}/${t.hesi_domain_id}`) && seen.add(`${t.client_need_id}/${t.hesi_domain_id}`))
      .slice(0, 3)
      .map((t) => ({
        stone_id: stone.id,
        user_id: ctx.user.id,
        client_need_id: t.client_need_id,
        hesi_domain_id: t.hesi_domain_id,
        relevance: Math.min(1, Math.max(0, t.relevance)),
      }));
  });
  if (rows.length) {
    check(await ctx.supabase.from("stone_blueprint_tags").upsert(rows, { ignoreDuplicates: true }), "save tags");
  }
  return new Set(rows.map((r) => r.stone_id)).size;
}

export type SyncResult = {
  check: BlueprintCheck;
  stonesTagged: number;
  notesLinked: number;
  questionsLinked: number;
  practiceAdded: number;
};

// Makes the student's path consistent with the blueprint: tags untagged stones and links stray notes and questions.
export async function syncStudentPath(ctx: UserContext): Promise<SyncResult> {
  const blueprint = await loadBlueprint(ctx);
  const result = checkBlueprint(blueprint);
  if (!result.ok) {
    console.error("Blueprint check failed", result.problems);
    return { check: result, stonesTagged: 0, notesLinked: 0, questionsLinked: 0, practiceAdded: 0 };
  }

  const untagged = await untaggedStones(ctx);
  let stonesTagged = 0;
  for (let i = 0; i < untagged.length; i += TAG_BATCH) {
    stonesTagged += await tagBatch(ctx, untagged.slice(i, i + TAG_BATCH));
  }

  const linked = await relinkAndPractice(ctx, (c, id) => addTwinPractice(c, id));
  return {
    check: result,
    stonesTagged,
    notesLinked: linked.notesLinked,
    questionsLinked: linked.questionsLinked,
    practiceAdded: linked.practiceAdded,
  };
}
