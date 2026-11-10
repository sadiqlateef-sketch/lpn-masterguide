import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CLIENT_NEED_IDS, COURSE_IDS, HESI_DOMAIN_IDS, NGN_STEP_IDS } from "@/lib/blueprint-ids";
import { checkBlueprint, type Blueprint } from "@/lib/server/blueprint";
import { BLUEPRINT_GUIDE } from "@/lib/server/prompts";

const migration = readFileSync(new URL("../supabase/migrations/001_initial_schema.sql", import.meta.url), "utf8");

function seededIds(table: string): string[] {
  const start = migration.indexOf(`insert into ${table}`);
  const end = migration.indexOf(");\n", start);
  const block = migration.slice(start, end);
  return [...block.matchAll(/^\s*\('([a-z_]+)'/gm)].map((m) => m[1]);
}

describe("blueprint ids", () => {
  it("match the seed data in the migration", () => {
    expect(seededIds("nclex_client_needs")).toEqual([...CLIENT_NEED_IDS]);
    expect(seededIds("hesi_pn_domains")).toEqual([...HESI_DOMAIN_IDS]);
    expect(seededIds("ngn_clinical_judgment_steps")).toEqual([...NGN_STEP_IDS]);
    expect(seededIds("courses")).toEqual([...COURSE_IDS]);
  });

  it("all appear in the prompt guide Claude sees", () => {
    for (const id of [...CLIENT_NEED_IDS, ...HESI_DOMAIN_IDS, ...NGN_STEP_IDS, ...COURSE_IDS]) {
      expect(BLUEPRINT_GUIDE).toContain(id);
    }
  });
});

describe("checkBlueprint", () => {
  const blueprint: Blueprint = {
    testPlan: { id: "pn-2026", label: "x", effective_date: "2026-04-01", source_url: "" },
    clientNeeds: CLIENT_NEED_IDS.map((id, i) => ({ id, parent_category: "", name: id, min_pct: 10, max_pct: 15, lpn_focus: "", sort_order: i })),
    ngnSteps: NGN_STEP_IDS.map((id, i) => ({ id, step_order: i, name: id, question: "", lpn_example: "" })),
    hesiDomains: HESI_DOMAIN_IDS.map((id, i) => ({ id, name: id, priority: "high", classic_hint: "", sort_order: i })),
    hesiBenchmarks: [],
    courses: COURSE_IDS.map((id, i) => ({ id, name: id, sort_order: i, default_hesi_domain_id: null })),
  };

  it("passes when ids and weights line up", () => {
    expect(checkBlueprint(blueprint)).toEqual({ ok: true, problems: [] });
  });

  it("reports missing ids and impossible weights", () => {
    const broken = { ...blueprint, clientNeeds: blueprint.clientNeeds.slice(1).map((n) => ({ ...n, min_pct: 20, max_pct: 25 })) };
    const result = checkBlueprint(broken);
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toMatch(/coordinated_care/);
    expect(result.problems.join(" ")).toMatch(/can't add up to 100/);
  });
});
