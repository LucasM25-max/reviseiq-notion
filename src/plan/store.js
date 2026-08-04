/*
 * Planner state: your settings, the generated schedule, and what you have
 * actually ticked off. The schedule can always be rebuilt; the record of what
 * you did cannot, so `done` and `skipped` are the parts we guard.
 */
import { store } from "../state.js";
import { scheduleSave } from "../storage.js";
import { todayKey } from "../srs.js";
import { addDays, buildSchedule, capacityFor, dueTasksForToday, planHealth, weekdayOf } from "./engine.js";

const CARRY_BACK_DAYS = 3;

/* Sunday-first, matching Date#getDay. Nothing is assumed about your week
   until you have been through setup. */
export const DEFAULT_MINUTES = [60, 45, 45, 45, 45, 45, 60];

export function ensurePlan() {
  const s = store.state;
  if (!s.plan || typeof s.plan !== "object") s.plan = {};
  const p = s.plan;
  if (!p.settings || typeof p.settings !== "object") p.settings = {};
  const st = p.settings;
  if (!Array.isArray(st.minutesByWeekday) || st.minutesByWeekday.length !== 7) {
    st.minutesByWeekday = DEFAULT_MINUTES.slice();
  }
  st.minutesByWeekday = st.minutesByWeekday.map((v) => {
    const n = Number(v);
    return isFinite(n) && n > 0 ? Math.min(360, Math.round(n)) : 0;
  });
  if (typeof st.mode !== "string") st.mode = "split";
  if (typeof st.autoScheduleTests !== "boolean") st.autoScheduleTests = true;
  if (typeof st.maxSubjectsPerDay !== "number") st.maxSubjectsPerDay = 3;
  if (typeof p.setupDone !== "boolean") p.setupDone = false;
  if (!p.days || typeof p.days !== "object") p.days = {};
  if (!p.done || typeof p.done !== "object") p.done = {};
  if (!p.skipped || typeof p.skipped !== "object") p.skipped = {};
  // Work you chose to bring forward, keyed by the day you moved it to.
  if (!p.pulled || typeof p.pulled !== "object") p.pulled = {};
  if (typeof p.generatedFor !== "string") p.generatedFor = "";
  return p;
}

export function planSettings() {
  return ensurePlan().settings;
}

export function isSetupDone() {
  return ensurePlan().setupDone === true;
}

/**
 * Saves the answers from the setup card (or the settings popover) and rebuilds
 * the schedule around them.
 */
export function saveSetup(next) {
  const p = ensurePlan();
  const st = p.settings;
  if (next && typeof next === "object") {
    if (typeof next.mode === "string") st.mode = next.mode;
    if (Array.isArray(next.minutesByWeekday)) {
      st.minutesByWeekday = next.minutesByWeekday.map((v) => {
        const n = Number(v);
        return isFinite(n) && n > 0 ? Math.min(360, Math.round(n)) : 0;
      });
    }
    if (typeof next.autoScheduleTests === "boolean") st.autoScheduleTests = next.autoScheduleTests;
    if (typeof next.maxSubjectsPerDay === "number") st.maxSubjectsPerDay = next.maxSubjectsPerDay;
  }
  p.setupDone = true;
  regeneratePlan(true);
  scheduleSave();
  return p;
}

/** Applies one minutes value in whichever shape the chosen mode implies. */
export function minutesForMode(mode, values) {
  if (mode === "same") {
    const v = Number(values.every) || 0;
    return [v, v, v, v, v, v, v];
  }
  if (mode === "split") {
    const wk = Number(values.weekday) || 0;
    const we = Number(values.weekend) || 0;
    return [we, wk, wk, wk, wk, wk, we];
  }
  const out = [];
  for (let i = 0; i < 7; i++) out.push(Number(values["d" + i]) || 0);
  return out;
}

/* ---------- generating ---------- */

export function regeneratePlan(force) {
  const p = ensurePlan();
  const today = todayKey();
  if (!force && p.generatedFor === today) return p;

  const carried = collectCarryOver(p, today);
  const schedule = buildSchedule(p.settings, today);

  // Days before today are history and are left exactly as they were.
  const kept = {};
  for (const k in p.days) {
    if (k < today) kept[k] = p.days[k];
  }
  for (const k in schedule.days) kept[k] = schedule.days[k];

  if (carried.length) {
    const list = kept[today] || (kept[today] = []);
    const have = {};
    list.forEach((t) => (have[t.id] = true));
    carried.forEach((t) => {
      if (!have[t.id]) list.unshift(t);
    });
  }

  for (const k in p.pulled) {
    if (k < today) delete p.pulled[k];
  }

  p.days = kept;
  p.generatedFor = today;
  p.horizon = schedule.horizon;
  p.dropped = (schedule.dropped || []).map((t) => ({
    id: t.id,
    title: t.title,
    subjectTitle: t.subjectTitle,
    minutes: t.minutes,
    kind: t.kind
  }));
  scheduleSave();
  return p;
}

/* Anything left undone in the last few days comes back today, flagged, rather
   than quietly disappearing. */
function collectCarryOver(p, today) {
  const out = [];
  for (let i = 1; i <= CARRY_BACK_DAYS; i++) {
    const key = addDays(today, -i);
    const list = p.days[key];
    if (!Array.isArray(list)) continue;
    list.forEach((t) => {
      if (!t || t.kind === "due") return;
      if (isTaskDone(key, t.id) || isTaskSkipped(key, t.id)) return;
      out.push(Object.assign({}, t, { carriedFrom: key }));
    });
  }
  // Keep a bad week from turning into an impossible day.
  return out.slice(0, 4);
}

/* ---------- reading ---------- */

/* Ids of every task that has been pulled forward, so it does not also show on
   the day it was originally scheduled for. */
function pulledIds() {
  const p = ensurePlan();
  const ids = {};
  for (const k in p.pulled) {
    (p.pulled[k] || []).forEach((t) => {
      if (t && t.id) ids[t.id] = true;
    });
  }
  return ids;
}

export function tasksFor(dateKey) {
  const p = ensurePlan();
  const moved = pulledIds();
  const own = (p.pulled[dateKey] || []).slice();
  const stored = Array.isArray(p.days[dateKey])
    ? p.days[dateKey].filter((t) => t && t.kind !== "due" && !moved[t.id])
    : [];
  const list = own.concat(stored);
  if (dateKey !== todayKey()) return list;
  // Due cards are worked out live: we cannot know what will be due in future.
  return dueTasksForToday().concat(list);
}

/* ---------- pulling work forward (always your choice, never automatic) ---------- */

function nextPullable() {
  const p = ensurePlan();
  const today = todayKey();
  const moved = pulledIds();
  const keys = Object.keys(p.days)
    .filter((k) => k > today)
    .sort();
  for (let i = 0; i < keys.length; i++) {
    const list = p.days[keys[i]] || [];
    for (let j = 0; j < list.length; j++) {
      const t = list[j];
      if (!t || moved[t.id]) continue;
      if (isTaskDone(keys[i], t.id) || isTaskSkipped(keys[i], t.id)) continue;
      return { date: keys[i], task: t };
    }
  }
  return null;
}

/** What would come forward next, for labelling the button. Null when nothing. */
export function pullPreview() {
  const next = nextPullable();
  return next ? { date: next.date, title: next.task.title, kind: next.task.kind, minutes: next.task.minutes } : null;
}

/** Brings the next scheduled task into today. Returns it, or null. */
export function pullForward() {
  const next = nextPullable();
  if (!next) return null;
  const p = ensurePlan();
  const today = todayKey();
  if (!p.pulled[today]) p.pulled[today] = [];
  const task = Object.assign({}, next.task, { pulledFrom: next.date });
  p.pulled[today].push(task);
  scheduleSave();
  return task;
}

/** Sends a pulled task back to the day it came from. */
export function undoPull(taskId) {
  const p = ensurePlan();
  const today = todayKey();
  const list = p.pulled[today] || [];
  const i = list.findIndex((t) => t && t.id === taskId);
  if (i > -1) {
    list.splice(i, 1);
    scheduleSave();
    return true;
  }
  return false;
}

export function todayTasks() {
  return tasksFor(todayKey());
}

export function isTaskDone(dateKey, taskId) {
  const p = ensurePlan();
  return !!(p.done[dateKey] && p.done[dateKey][taskId]);
}

export function isTaskSkipped(dateKey, taskId) {
  const p = ensurePlan();
  return !!(p.skipped[dateKey] && p.skipped[dateKey][taskId]);
}

export function markTaskDone(dateKey, taskId, minutes) {
  const p = ensurePlan();
  if (!p.done[dateKey]) p.done[dateKey] = {};
  p.done[dateKey][taskId] = { at: Date.now(), minutes: Number(minutes) || 0 };
  if (p.skipped[dateKey]) delete p.skipped[dateKey][taskId];
  scheduleSave();
}

export function unmarkTaskDone(dateKey, taskId) {
  const p = ensurePlan();
  if (p.done[dateKey]) delete p.done[dateKey][taskId];
  scheduleSave();
}

export function toggleTaskDone(dateKey, taskId, minutes) {
  if (isTaskDone(dateKey, taskId)) unmarkTaskDone(dateKey, taskId);
  else markTaskDone(dateKey, taskId, minutes);
}

export function skipTask(dateKey, taskId) {
  const p = ensurePlan();
  if (!p.skipped[dateKey]) p.skipped[dateKey] = {};
  p.skipped[dateKey][taskId] = { at: Date.now() };
  scheduleSave();
}

/**
 * Finishing a quiz, a paper or a flashcard session should tick the matching
 * task off without the student having to remember to.
 */
export function completeTaskForPage(pageId, kinds) {
  const key = todayKey();
  const list = tasksFor(key);
  let ticked = 0;
  list.forEach((t) => {
    if (t.pageId !== pageId) return;
    if (kinds && kinds.indexOf(t.kind) === -1) return;
    if (isTaskDone(key, t.id)) return;
    markTaskDone(key, t.id, t.minutes);
    ticked += 1;
  });
  return ticked;
}

export function minutesPlanned(dateKey) {
  return tasksFor(dateKey).reduce((sum, t) => sum + (t.minutes || 0), 0);
}

export function minutesDone(dateKey) {
  const p = ensurePlan();
  const map = p.done[dateKey] || {};
  let sum = 0;
  for (const id in map) sum += Number(map[id].minutes) || 0;
  return sum;
}

export function capacityOn(dateKey) {
  return capacityFor(ensurePlan().settings, dateKey);
}

/** The next seven days, for the little week strip. */
export function weekOverview() {
  const today = todayKey();
  const out = [];
  for (let i = 0; i < 7; i++) {
    const key = addDays(today, i);
    const tasks = tasksFor(key);
    out.push({
      date: key,
      weekday: weekdayOf(key),
      isToday: i === 0,
      tasks: tasks.length,
      planned: tasks.reduce((s, t) => s + (t.minutes || 0), 0),
      done: minutesDone(key),
      capacity: capacityOn(key)
    });
  }
  return out;
}

/** Days from today to the end of the plan that actually have work on them. */
export function upcomingDays(limit) {
  const p = ensurePlan();
  const today = todayKey();
  const keys = Object.keys(p.days)
    .filter((k) => k > today)
    .sort();
  const out = [];
  for (let i = 0; i < keys.length && out.length < (limit || 14); i++) {
    const tasks = tasksFor(keys[i]);
    if (!tasks.length) continue;
    out.push({ date: keys[i], tasks: tasks });
  }
  return out;
}

export function health() {
  const p = ensurePlan();
  return planHealth(
    { days: p.days, horizon: p.horizon || 21, dropped: p.dropped || [], generatedFor: p.generatedFor || todayKey() },
    p.settings
  );
}
