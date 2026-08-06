/*
 * Usage limits for the three Gemini generation endpoints: quiz, practise,
 * test. Two independent checks, both backed by Firestore (the project's
 * only persistent store - there's no database beyond it and no admin SDK,
 * so this talks to the plain Firestore REST API with fetch, the same way
 * api/_lib/auth.js verifies tokens without one).
 *
 *  1. Per-user daily and monthly quotas, kept at
 *     users/{uid}/usage/limits - already covered by the existing
 *     firestore.rules ("a user can read/write everything under their own
 *     users/{uid} document"), so no rule changes are needed for this half.
 *     Written using the *caller's own* ID token, exactly like every other
 *     write the app already makes to that document tree.
 *
 *  2. A shared "how many generations are running right now" counter per
 *     feature, kept at usage_global/{feature}. This has to be visible
 *     across every signed-in AND signed-out caller, so it lives outside
 *     users/{uid} and needs one small addition to firestore.rules (see the
 *     updated file shipped alongside this change). It is deliberately just
 *     a number with no personal data in it.
 *
 * Both checks fail OPEN: if Firestore is unreachable, unconfigured, or
 * returns something unexpected, the request is allowed through rather than
 * blocked. A missing/broken usage counter should never be the reason a
 * student can't generate a quiz - it only ever narrows an already-working
 * limit, never invents a new way to say no.
 */

const DAILY_LIMITS = { quiz: 8, practise: 4, test: 2 };
const MONTHLY_LIMITS = { quiz: 150, practise: 75, test: 20 };
const CONCURRENCY_LIMIT = 10;

const FEATURE_LABEL_PLURAL = { quiz: "quizzes", practise: "practises", test: "tests" };

function projectId() {
  return process.env.FIREBASE_PROJECT_ID || "";
}

function databaseId() {
  return (process.env.FIREBASE_DATABASE_ID || "(default)").trim() || "(default)";
}

function firestoreConfigured() {
  return Boolean(projectId());
}

function docUrl(path) {
  return (
    "https://firestore.googleapis.com/v1/projects/" +
    encodeURIComponent(projectId()) +
    "/databases/" +
    encodeURIComponent(databaseId()) +
    "/documents/" +
    path
  );
}

function commitUrl() {
  return (
    "https://firestore.googleapis.com/v1/projects/" +
    encodeURIComponent(projectId()) +
    "/databases/" +
    encodeURIComponent(databaseId()) +
    "/documents:commit"
  );
}

function authedHeaders(idToken) {
  const headers = { "Content-Type": "application/json" };
  if (idToken) headers.Authorization = "Bearer " + idToken;
  return headers;
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10); // "2026-08-06"
}

function monthUtc() {
  return new Date().toISOString().slice(0, 7); // "2026-08"
}

/* ---------- tiny Firestore value (de)serialisation ---------- */

function fv(value) {
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "number") return { integerValue: String(Math.trunc(value)) };
  return { nullValue: null };
}

function readInt(mapFields, key, fallback) {
  const v = mapFields && mapFields[key] && mapFields[key].integerValue;
  return v != null ? Number(v) : fallback;
}

function readStr(mapFields, key, fallback) {
  const v = mapFields && mapFields[key] && mapFields[key].stringValue;
  return typeof v === "string" ? v : fallback;
}

/* ---------- per-user daily/monthly quota ---------- */

/**
 * Checks (without writing) whether `uid` still has quota left for
 * `feature` today and this month. Returns { allowed, message, state },
 * where `state` is the feature's current counters so recordUsage() below
 * doesn't have to re-fetch them.
 */
export async function checkUserQuota(uid, idToken, feature) {
  if (!uid || !firestoreConfigured()) return { allowed: true, state: null };

  let fields = null;
  try {
    const res = await fetch(docUrl("users/" + encodeURIComponent(uid) + "/usage/limits"), {
      method: "GET",
      headers: authedHeaders(idToken)
    });
    if (res.status === 404) {
      fields = {};
    } else if (res.ok) {
      const body = await res.json();
      fields = (body && body.fields) || {};
    } else {
      return { allowed: true, state: null }; // fail open
    }
  } catch (e) {
    return { allowed: true, state: null }; // fail open
  }

  const featureMap = (fields[feature] && fields[feature].mapValue && fields[feature].mapValue.fields) || {};
  const day = todayUtc();
  const month = monthUtc();
  const dayCount = readStr(featureMap, "day", "") === day ? readInt(featureMap, "dayCount", 0) : 0;
  const monthCount = readStr(featureMap, "month", "") === month ? readInt(featureMap, "monthCount", 0) : 0;

  const dailyLimit = DAILY_LIMITS[feature];
  const monthlyLimit = MONTHLY_LIMITS[feature];
  const plural = FEATURE_LABEL_PLURAL[feature];

  if (dayCount >= dailyLimit) {
    return {
      allowed: false,
      message:
        "You've used all " + dailyLimit + " " + plural + " for today. Your daily limit resets tomorrow.",
      state: { day, month, dayCount, monthCount }
    };
  }
  if (monthCount >= monthlyLimit) {
    return {
      allowed: false,
      message:
        "You've reached this month's limit of " + monthlyLimit + " " + plural + ". It resets next month.",
      state: { day, month, dayCount, monthCount }
    };
  }

  return { allowed: true, state: { day, month, dayCount, monthCount } };
}

/**
 * Records one successful generation for `uid`/`feature`. Call this only
 * after Gemini has actually returned something usable - a failed or
 * rejected attempt shouldn't cost the student part of their quota.
 */
export async function recordUsage(uid, idToken, feature, state) {
  if (!uid || !firestoreConfigured()) return;
  const day = todayUtc();
  const month = monthUtc();
  const prev = state || { day: "", month: "", dayCount: 0, monthCount: 0 };
  const nextDayCount = prev.day === day ? prev.dayCount + 1 : 1;
  const nextMonthCount = prev.month === month ? prev.monthCount + 1 : 1;

  const body = {
    fields: {
      [feature]: {
        mapValue: {
          fields: {
            day: fv(day),
            dayCount: fv(nextDayCount),
            month: fv(month),
            monthCount: fv(nextMonthCount)
          }
        }
      }
    }
  };

  try {
    await fetch(
      docUrl("users/" + encodeURIComponent(uid) + "/usage/limits") +
        "?updateMask.fieldPaths=" +
        encodeURIComponent(feature),
      { method: "PATCH", headers: authedHeaders(idToken), body: JSON.stringify(body) }
    );
  } catch (e) {
    /* best-effort - a missed write just means one fewer generation is
       counted against the quota, never one that shouldn't have run */
  }
}

/* ---------- shared concurrency counter ---------- */

/**
 * Atomically bumps usage_global/{feature}.inFlight by `delta` and returns
 * the new value, or null if Firestore isn't configured/reachable (fails
 * open - the caller treats null as "allow").
 */
async function bumpInFlight(feature, delta) {
  if (!firestoreConfigured()) return null;
  const write = {
    update: { name: docNameFor("usage_global/" + feature), fields: {} },
    updateMask: { fieldPaths: [] },
    updateTransforms: [{ fieldPath: "inFlight", increment: { integerValue: String(delta) } }]
  };
  try {
    const res = await fetch(commitUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ writes: [write] })
    });
    if (!res.ok) return null;
    const body = await res.json();
    const result = body && body.writeResults && body.writeResults[0] && body.writeResults[0].transformResults;
    const val = result && result[0] && result[0].integerValue;
    return val != null ? Number(val) : null;
  } catch (e) {
    return null;
  }
}

function docNameFor(path) {
  return (
    "projects/" + projectId() + "/databases/" + databaseId() + "/documents/" + path
  );
}

/**
 * Claims one of CONCURRENCY_LIMIT concurrent generation slots for
 * `feature`. Always pair a truthy result with a matching releaseSlot()
 * call once the request is done, success or failure.
 */
export async function acquireSlot(feature) {
  const value = await bumpInFlight(feature, 1);
  if (value == null) return { ok: true }; // Firestore unavailable - fail open
  if (value > CONCURRENCY_LIMIT) {
    // Over the limit - give back the slot we just (over-)claimed.
    bumpInFlight(feature, -1).catch(() => {});
    return { ok: false };
  }
  return { ok: true };
}

export async function releaseSlot(feature) {
  await bumpInFlight(feature, -1);
}

export function highUsageMessage() {
  return "There's high usage right now \u2014 try again in 30 seconds.";
}
