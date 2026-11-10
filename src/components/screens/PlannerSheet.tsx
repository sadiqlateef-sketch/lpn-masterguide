"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BellRing, CalendarPlus, Loader2, Plus, Trash2, X } from "lucide-react";
import type { PathView, StudyBlockView, StudyProfileView } from "@/lib/api-types";
import { api, deviceTimeZone } from "@/lib/client/api";
import { isNative } from "@/lib/client/native";
import { cn } from "@/lib/cn";
import { localDay, pace, reminderIcs, weeklyMinutesByCourse, type CourseProgress } from "@/lib/study-math";
import { courseStats } from "@/lib/ui/path-view";
import { formatMinutes, formatTime, paceMessage, WEEKDAYS, type PaceTone } from "@/lib/ui/planner-format";
import { GlassCard } from "@/components/glass/GlassCard";
import { GlossyButton } from "@/components/glass/GlossyButton";

// Exam dates, the review buffer, a daily reminder and the week's study times, with a live preview of the pace.

type Props = {
  open: boolean;
  path: PathView | null;
  onClose: () => void;
  onSaved: () => void;
};

const LENGTHS = [15, 20, 30, 45, 60, 90, 120, 180];
const BUFFERS = [0, 7, 14, 21, 30, 45, 60];
const ANY = "any";

const TONE: Record<PaceTone, string> = {
  good: "text-emerald-200",
  warn: "text-amber-200",
  bad: "text-rose-200",
  neutral: "text-white/75",
};

type Load = { state: "loading" } | { state: "ready" } | { state: "error"; message: string };

const inputClass =
  "min-h-11 w-full rounded-xl border border-white/15 bg-white/[0.06] px-3 text-base font-semibold text-white [color-scheme:dark] focus-visible:outline-2 focus-visible:outline-sky-300";

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function fromMinutes(total: number): string {
  const t = Math.min(Math.max(0, total), 23 * 60 + 45);
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

export function PlannerSheet({ open, path, onClose, onSaved }: Props) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [profile, setProfile] = useState<StudyProfileView | null>(null);
  const [blocks, setBlocks] = useState<StudyBlockView[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const native = useMemo(() => isNative(), []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoad({ state: "loading" });
    setSaveError(null);
    Promise.all([api.studyProfile(), api.studyBlocks()])
      .then(([p, b]) => {
        if (cancelled) return;
        // Until a time zone is saved, use the phone's.
        const tz = deviceTimeZone();
        setProfile(p.timezone === "UTC" && tz ? { ...p, timezone: tz } : p);
        setBlocks(b.blocks);
        setLoad({ state: "ready" });
      })
      .catch((e: unknown) => !cancelled && setLoad({ state: "error", message: e instanceof Error ? e.message : "Your plan didn't load." }));
    return () => {
      cancelled = true;
    };
  }, [open]);

  const courses: CourseProgress[] = useMemo(
    () =>
      (path?.courses ?? []).map((c) => {
        const stats = courseStats(c);
        return { id: c.id, name: c.name, total: stats.total, mastered: stats.mastered };
      }),
    [path],
  );
  const today = profile ? localDay(new Date(), profile.timezone) : null;

  const preview = useMemo(() => {
    if (!profile || !today) return null;
    return paceMessage(
      pace({
        today,
        nclexDate: profile.nclexDate,
        hesiDate: profile.hesiDate,
        bufferDays: profile.reviewBufferDays,
        remainingStones: courses.reduce((s, c) => s + c.total - c.mastered, 0),
        blocks,
      }),
    );
  }, [profile, today, courses, blocks]);

  const perCourse = useMemo(() => {
    const minutes = weeklyMinutesByCourse(blocks, courses);
    return courses.filter((c) => minutes.has(c.id)).map((c) => ({ name: c.name, minutes: minutes.get(c.id) ?? 0 }));
  }, [blocks, courses]);

  const update = (patch: Partial<StudyProfileView>) => setProfile((p) => (p ? { ...p, ...patch } : p));

  const addBlock = (weekday: number) =>
    setBlocks((all) => {
      const sameDay = all.filter((b) => b.weekday === weekday).sort((a, b) => a.start.localeCompare(b.start));
      const last = sameDay[sameDay.length - 1];
      const start = last ? fromMinutes(toMinutes(last.start) + last.minutes + 15) : "19:00";
      return [...all, { weekday, start, minutes: 30, courseId: null }];
    });
  const changeBlock = (index: number, patch: Partial<StudyBlockView>) => setBlocks((all) => all.map((b, i) => (i === index ? { ...b, ...patch } : b)));
  const removeBlock = (index: number) => setBlocks((all) => all.filter((_, i) => i !== index));

  const save = async () => {
    if (!profile) return;
    setSaving(true);
    setSaveError(null);
    try {
      await api.saveStudyProfile({
        nclexDate: profile.nclexDate || null,
        hesiDate: profile.hesiDate || null,
        reminderTime: profile.reminderTime || null,
        reviewBufferDays: profile.reviewBufferDays,
        timezone: profile.timezone,
      });
      await api.saveStudyBlocks(blocks);
      onSaved();
      onClose();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "That didn't save. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const downloadReminder = () => {
    if (!profile?.reminderTime || !today) return;
    const ics = reminderIcs({ time: profile.reminderTime, timeZone: profile.timezone, startDay: today, now: new Date(), uid: "study-reminder@lpn-masterguide" });
    const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "lpn-study-reminder.ics";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="planner-title"
          className="fixed inset-0 z-[60] flex flex-col bg-canvas/95 px-4 pb-[max(1.5rem,var(--safe-bottom))] pt-[max(1rem,var(--safe-top))] backdrop-blur-xl"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="mx-auto flex w-full max-w-md items-center justify-between">
            <h2 id="planner-title" className="text-xl font-bold">
              Study plan
            </h2>
            <GlossyButton size="icon" onClick={onClose} aria-label="Close study plan" icon={<X className="h-6 w-6" strokeWidth={2.5} />} />
          </div>

          <div className="mx-auto mt-4 flex w-full max-w-md flex-1 flex-col gap-4 overflow-y-auto overscroll-contain pb-4">
            {load.state === "loading" && (
              <div className="flex justify-center py-10" role="status" aria-label="Loading your plan">
                <Loader2 aria-hidden className="h-10 w-10 animate-spin text-sky-300" strokeWidth={2.5} />
              </div>
            )}
            {load.state === "error" && (
              <GlassCard glow="ruby" role="alert">
                <p className="text-lg font-semibold">{load.message}</p>
                <GlossyButton className="mt-4" onClick={onClose}>
                  Close
                </GlossyButton>
              </GlassCard>
            )}

            {load.state === "ready" && profile && (
              <>
                <GlassCard className="p-5">
                  <h3 className="text-lg font-bold">Exam dates</h3>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <label className="flex flex-col gap-1 text-sm font-semibold text-white/75">
                      NCLEX-PN
                      <input type="date" className={inputClass} value={profile.nclexDate ?? ""} onChange={(e) => update({ nclexDate: e.target.value || null })} />
                    </label>
                    <label className="flex flex-col gap-1 text-sm font-semibold text-white/75">
                      HESI
                      <input type="date" className={inputClass} value={profile.hesiDate ?? ""} onChange={(e) => update({ hesiDate: e.target.value || null })} />
                    </label>
                  </div>
                  <label className="mt-3 flex flex-col gap-1 text-sm font-semibold text-white/75">
                    Review only, no new stones, in the last
                    <select
                      className={inputClass}
                      value={profile.reviewBufferDays}
                      onChange={(e) => update({ reviewBufferDays: Number(e.target.value) })}
                    >
                      {BUFFERS.map((d) => (
                        <option key={d} value={d}>
                          {d === 0 ? "No review-only days" : `${d} days before the exam`}
                        </option>
                      ))}
                    </select>
                  </label>
                </GlassCard>

                <GlassCard className="p-5">
                  <h3 className="text-lg font-bold">Study times</h3>
                  <p className="mt-1 text-sm text-white/60">Each one studies a course, or whichever course is furthest behind.</p>
                  <ul className="mt-3 flex flex-col gap-3">
                    {WEEKDAYS.map((day) => {
                      const dayBlocks = blocks.map((b, index) => ({ b, index })).filter(({ b }) => b.weekday === day.iso);
                      return (
                        <li key={day.iso} className="rounded-2xl bg-white/[0.04] p-3">
                          <div className="flex items-center justify-between">
                            <p className="font-bold">{day.long}</p>
                            <button
                              type="button"
                              onClick={() => addBlock(day.iso)}
                              className="flex min-h-11 items-center gap-1 rounded-full px-3 text-sm font-bold text-sky-200 hover:bg-white/[0.06]"
                              aria-label={`Add a study time on ${day.long}`}
                            >
                              <Plus aria-hidden className="h-4 w-4" strokeWidth={3} />
                              Add
                            </button>
                          </div>
                          {dayBlocks.length === 0 ? (
                            <p className="text-sm text-white/45">Off</p>
                          ) : (
                            <ul className="mt-2 flex flex-col gap-2">
                              {dayBlocks.map(({ b, index }) => (
                                <li key={index} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
                                  <input
                                    type="time"
                                    aria-label={`${day.long} start time`}
                                    className={inputClass}
                                    value={b.start}
                                    onChange={(e) => e.target.value && changeBlock(index, { start: e.target.value })}
                                  />
                                  <select
                                    aria-label={`${day.long} length`}
                                    className={inputClass}
                                    value={b.minutes}
                                    onChange={(e) => changeBlock(index, { minutes: Number(e.target.value) })}
                                  >
                                    {(LENGTHS.includes(b.minutes) ? LENGTHS : [...LENGTHS, b.minutes].sort((x, y) => x - y)).map((m) => (
                                      <option key={m} value={m}>
                                        {formatMinutes(m)}
                                      </option>
                                    ))}
                                  </select>
                                  <button
                                    type="button"
                                    onClick={() => removeBlock(index)}
                                    aria-label={`Remove the ${formatTime(b.start)} study time on ${day.long}`}
                                    className="flex h-11 w-11 items-center justify-center rounded-full text-white/60 hover:bg-white/[0.06] hover:text-rose-200"
                                  >
                                    <Trash2 aria-hidden className="h-5 w-5" strokeWidth={2.5} />
                                  </button>
                                  <select
                                    aria-label={`${day.long} ${formatTime(b.start)} course`}
                                    className={cn(inputClass, "col-span-3")}
                                    value={b.courseId ?? ANY}
                                    onChange={(e) => changeBlock(index, { courseId: e.target.value === ANY ? null : e.target.value })}
                                  >
                                    <option value={ANY}>Any course (furthest behind)</option>
                                    {courses.map((c) => (
                                      <option key={c.id} value={c.id}>
                                        {c.name}
                                      </option>
                                    ))}
                                  </select>
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  {perCourse.length > 0 && (
                    <div className="mt-4">
                      <p className="text-xs font-bold uppercase tracking-wide text-white/55">Each week</p>
                      <ul className="mt-1 space-y-0.5 text-sm text-white/80">
                        {perCourse.map((c) => (
                          <li key={c.name}>
                            {c.name}: {formatMinutes(c.minutes)}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </GlassCard>

                <GlassCard className="p-5">
                  <h3 className="flex items-center gap-2 text-lg font-bold">
                    <BellRing aria-hidden className="h-5 w-5 text-amber-300" strokeWidth={2.5} />
                    Daily reminder
                  </h3>
                  <label className="mt-3 flex flex-col gap-1 text-sm font-semibold text-white/75">
                    Time
                    <input type="time" className={inputClass} value={profile.reminderTime ?? ""} onChange={(e) => update({ reminderTime: e.target.value || null })} />
                  </label>
                  {native ? (
                    <p className="mt-2 text-sm text-white/60">Phone notifications come in a later update. For now the time is saved with your plan.</p>
                  ) : (
                    <>
                      <p className="mt-2 text-sm text-white/60">Add it to your calendar and it reminds you every day.</p>
                      <GlossyButton
                        className="mt-3"
                        disabled={!profile.reminderTime}
                        onClick={downloadReminder}
                        icon={<CalendarPlus className="h-4 w-4" strokeWidth={2.5} />}
                      >
                        Add to calendar
                      </GlossyButton>
                    </>
                  )}
                </GlassCard>
              </>
            )}
          </div>

          {load.state === "ready" && profile && (
            <div className="mx-auto w-full max-w-md border-t border-white/10 pt-3">
              {preview && (
                <p className={cn("text-sm font-semibold", TONE[preview.tone])} aria-live="polite">
                  {preview.text}
                </p>
              )}
              {saveError && (
                <p role="alert" className="mt-1 text-sm font-semibold text-rose-200">
                  {saveError}
                </p>
              )}
              <GlossyButton variant="blue" size="lg" className="mt-3 w-full" onClick={() => void save()} disabled={saving}>
                {saving ? "Saving..." : "Save plan"}
              </GlossyButton>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
