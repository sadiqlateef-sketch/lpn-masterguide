import { describe, expect, it } from "vitest";
import type { PaceView } from "@/lib/api-types";
import { dueLabel, formatDay, formatMinutes, formatTime, paceMessage, plural } from "@/lib/ui/planner-format";

const base: PaceView = {
  exam: { kind: "nclex", date: "2027-03-01", daysLeft: 111 },
  learnBy: "2027-02-14",
  studyDaysLeft: 40,
  remainingStones: 60,
  stonesPerStudyDay: 2,
  capacityPerStudyDay: 3,
  status: "on_track",
};

describe("planner labels", () => {
  it("formats times, days and lengths", () => {
    expect(formatTime("19:30", "en-US")).toBe("7:30 PM");
    expect(formatTime("07:05", "en-GB")).toMatch(/^0?7:05$/);
    expect(formatTime("bad")).toBe("bad");
    expect(formatDay("2026-11-17", "en-US")).toBe("Tue, Nov 17");
    expect(formatMinutes(45)).toBe("45 min");
    expect(formatMinutes(90)).toBe("1 h 30 min");
    expect(formatMinutes(120)).toBe("2 h");
    expect(formatMinutes(-5)).toBe("0 min");
    expect(plural(1, "stone")).toBe("1 stone");
    expect(plural(3, "stone")).toBe("3 stones");
  });

  it("says when a review is due the way a person would", () => {
    expect(dueLabel("2026-11-10", "2026-11-10")).toBe("today");
    expect(dueLabel("2026-11-09", "2026-11-10")).toBe("today");
    expect(dueLabel("2026-11-11", "2026-11-10")).toBe("tomorrow");
    expect(dueLabel("2026-11-16", "2026-11-10", "en-US")).toBe("in 6 days, Mon, Nov 16");
    expect(dueLabel("2026-12-01", "2026-11-10", "en-US")).toBe("Tue, Dec 1");
  });

  it("puts the pace in one line with a tone", () => {
    expect(paceMessage(base, "en-US")).toEqual({ tone: "good", text: "On track for the NCLEX-PN on Mon, Mar 1: 2 stones a study day." });
    expect(paceMessage({ ...base, status: "tight" }, "en-US").tone).toBe("warn");
    expect(paceMessage({ ...base, status: "behind", stonesPerStudyDay: 5 }, "en-US").text).toBe(
      "Behind for the NCLEX-PN on Mon, Mar 1: 5 stones a study day needed, about 3 fit. Add study time.",
    );
    expect(paceMessage({ ...base, status: "behind", studyDaysLeft: 0 }, "en-US").text).toMatch(/is close/);
    expect(paceMessage({ ...base, exam: null, learnBy: null, status: "no_exam" }).tone).toBe("neutral");
    expect(paceMessage({ ...base, exam: { kind: "hesi", date: "2026-12-04", daysLeft: 24 }, status: "done" }, "en-US").text).toBe(
      "Every stone is mastered. Reviews carry you to the HESI on Fri, Dec 4.",
    );
  });
});
