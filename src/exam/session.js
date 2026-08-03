/*
 * "Test me" - a timed AQA-style mock exam written from your own notes.
 *
 * Flow: setup card -> Gemini writes the paper -> full-screen timed exam ->
 * Gemini marks it against its own mark scheme -> results, with every focus
 * area and missed point filed permanently into the workspace.
 */
import { getPage, getChildren } from "../state.js";
import { escapeHtml, uid } from "../utils.js";
import { scheduleSave } from "../storage.js";
import { ui } from "../icons.js";
import {
  COMPONENTS,
  COMPONENT_ORDER,
  optionById,
  optionsForComponent,
  inferOption,
  HISTORY_TITLE_MATCH,
  MIN_NOTE_WORDS,
  formatDuration
} from "./aqaHistory.js";
import { collectNotes, titleCloud, subjectAncestor } from "./notes.js";
import { saveAttempt, getAttempt, recordFromAttempt, unfinishedAttemptForPage } from "./insights.js";

let session = null; // { attempt, view, timerId, error }
let onClose = () => {};

export function setTestCloseHandler(fn) {
  onClose = fn;
}

/* ------------------------------------------------------------------ *
 * Eligibility - AQA History pages only
 * ------------------------------------------------------------------ */

/**
 * Returns null when the page is not an AQA History page (so no button is
 * shown at all), otherwise a descriptor of what can be tested.
 */
export function testEligibility(pageId) {
  const page = getPage(pageId);
  if (!page) return null;

  const subject = subjectAncestor(pageId);
  if (!subject || subject.type !== "subject") return null;
  if (!HISTORY_TITLE_MATCH.test(subject.title || "")) return null;
  if (subject.examBoard !== "AQA") return null;

  const hasChildren = getChildren(pageId).length > 0;
  // Default scope is the page plus everything nested under it.
  const notes = collectNotes(pageId, hasChildren);

  const saved = page.examOptionId ? optionById(page.examOptionId) : null;
  const guess = saved ? { option: saved } : inferOption(titleCloud(pageId).concat([notes.text.slice(0, 4000)]));

  return {
    pageId,
    page,
    subject,
    hasChildren,
    words: notes.wordCount,
    enough: notes.wordCount >= MIN_NOTE_WORDS,
    option: guess ? guess.option : null,
    site: page.historicSite || subject.historicSite || ""
  };
}

/* ------------------------------------------------------------------ *
 * Setup card
 * ------------------------------------------------------------------ */

export function openTestSetup(pageId) {
  const el = testEligibility(pageId);
  if (!el) return;

  const existing = unfinishedAttemptForPage(pageId);
  const modal = document.createElement("div");
  modal.className = "modal-overlay exam-setup-overlay";
  modal.id = "exam-setup";
  modal.innerHTML = renderSetup(el, existing);
  document.getElementById("overlay-root").appendChild(modal);

  modal.addEventListener("mousedown", (e) => {
    if (e.target === modal) modal.remove();
  });

  modal.addEventListener("change", (e) => {
    const sel = e.target.closest("#exam-option");
    if (sel) {
      const opt = optionById(sel.value);
      const siteRow = modal.querySelector("#exam-site-row");
      if (siteRow) siteRow.hidden = !(opt && opt.siteRequired);
    }
  });

  modal.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-setup-act]");
    if (!btn) return;
    const act = btn.dataset.setupAct;
    if (act === "cancel") {
      modal.remove();
      return;
    }
    if (act === "resume") {
      modal.remove();
      resumeAttempt(btn.dataset.testId);
      return;
    }
    if (act === "discard") {
      const a = getAttempt(btn.dataset.testId);
      if (a) {
        a.status = "abandoned";
        saveAttempt(a);
      }
      modal.remove();
      openTestSetup(pageId);
      return;
    }
    if (act !== "start") return;

    const optionId = modal.querySelector("#exam-option").value;
    const option = optionById(optionId);
    if (!option) return;
    const siteInput = modal.querySelector("#exam-site");
    const site = siteInput ? siteInput.value.trim() : "";
    if (option.siteRequired && !site) {
      const warn = modal.querySelector("#exam-site-warn");
      if (warn) warn.hidden = false;
      if (siteInput) siteInput.focus();
      return;
    }
    const scopeEl = modal.querySelector('input[name="exam-scope"]:checked');
    const includeSubpages = scopeEl ? scopeEl.value === "tree" : el.hasChildren;

    // Remember the choices so the next test on this page is one click.
    el.page.examOptionId = option.id;
    if (option.siteRequired) {
      el.page.historicSite = site;
      el.subject.historicSite = site;
    }
    scheduleSave();

    modal.remove();
    startTest({ pageId, option, site, includeSubpages });
  });
}

function renderSetup(el, existing) {
  const component = el.option ? COMPONENTS[el.option.componentId] : null;
  const treeNotes = collectNotes(el.pageId, true);
  const pageNotes = collectNotes(el.pageId, false);

  let html = '<div class="modal exam-setup">';
  html +=
    '<div class="exam-setup-head">' +
    '<div class="exam-setup-badge">' + ui("target", 15) + "AQA GCSE History\u00a08145</div>" +
    "<h3>Test me</h3>" +
    "<p>Gemini writes a real-format mock from these notes, times you, then marks it against an AQA-style mark scheme.</p>" +
    "</div>";

  if (existing) {
    html +=
      '<div class="exam-resume">' +
      "<div><strong>You have an unfinished paper.</strong><span>" +
      escapeHtml(existing.optionLabel || "") +
      "</span></div>" +
      '<div class="exam-resume-actions">' +
      '<button class="btn-ghost" data-setup-act="discard" data-test-id="' + existing.id + '">Discard</button>' +
      '<button class="btn-primary" data-setup-act="resume" data-test-id="' + existing.id + '">Resume</button>' +
      "</div></div>";
  }

  html += '<label class="exam-field-label" for="exam-option">Which part of the course?</label>';
  html += '<select id="exam-option" class="exam-select">';
  COMPONENT_ORDER.forEach((cid) => {
    const c = COMPONENTS[cid];
    html += '<optgroup label="' + escapeHtml(c.label + " \u00b7 " + c.totalMarks + " marks") + '">';
    optionsForComponent(cid).forEach((o) => {
      const selected = el.option && el.option.id === o.id ? " selected" : "";
      html += '<option value="' + o.id + '"' + selected + ">" + escapeHtml(o.label) + "</option>";
    });
    html += "</optgroup>";
  });
  html += "</select>";
  html +=
    '<div class="exam-field-note">' +
    (el.option
      ? "Guessed from your page titles \u2014 change it if that's wrong."
      : "Pick the option you actually study.") +
    "</div>";

  const needsSite = el.option && el.option.siteRequired;
  html +=
    '<div id="exam-site-row" class="exam-site-row"' + (needsSite ? "" : " hidden") + ">" +
    '<label class="exam-field-label" for="exam-site">Your historic environment site this year</label>' +
    '<input id="exam-site" class="exam-input" type="text" spellcheck="false" placeholder="e.g. Pevensey Castle" value="' +
    escapeHtml(el.site || "") +
    '" />' +
    '<div class="exam-field-note">AQA changes the specified site each year, so question 4 needs yours.</div>' +
    '<div class="exam-warn" id="exam-site-warn" hidden>Enter your site before starting.</div>' +
    "</div>";

  html += '<label class="exam-field-label">What should it test?</label>';
  html += '<div class="exam-scope">';
  html += scopeRow("tree", "This page and its subpages", treeNotes, el.hasChildren, el.hasChildren);
  html += scopeRow("page", "Just this page", pageNotes, true, !el.hasChildren);
  html += "</div>";

  if (component) {
    html +=
      '<div class="exam-preview">' +
      '<div class="exam-preview-title">' + escapeHtml(component.section) + "</div>" +
      '<div class="exam-preview-rows">' +
      component.questions
        .map(
          (q) =>
            '<div class="exam-preview-row"><span class="qn">Q' + q.n + '</span><span class="marks">' +
            (q.marks + q.spag) + " marks" + (q.spag ? " (inc. " + q.spag + " SPaG)" : "") +
            '</span><span class="ao">' + q.ao + "</span></div>"
        )
        .join("") +
      "</div>" +
      '<div class="exam-preview-foot">' +
      component.totalMarks + " marks \u00b7 " + component.timeLimitMinutes + " minutes \u00b7 full screen, timed" +
      "</div></div>";
  }

  if (!el.enough) {
    html +=
      '<div class="exam-warn">These notes are short (' + el.words + " words). A paper built from them will be thin \u2014 add more first for a useful mock.</div>";
  }

  html +=
    '<div class="modal-actions">' +
    '<button class="btn-cancel" data-setup-act="cancel">Cancel</button>' +
    '<button class="btn-primary" data-setup-act="start">Start mock exam</button>' +
    "</div></div>";
  return html;
}

function scopeRow(value, label, notes, enabled, checked) {
  const pages = notes.pages.length;
  return (
    '<label class="exam-scope-row' + (enabled ? "" : " is-off") + '">' +
    '<input type="radio" name="exam-scope" value="' + value + '"' +
    (checked ? " checked" : "") + (enabled ? "" : " disabled") + " />" +
    "<span><strong>" + escapeHtml(label) + "</strong>" +
    '<span class="exam-scope-meta">' + notes.wordCount + " words" +
    (pages > 1 ? " \u00b7 " + pages + " pages" : "") + "</span></span></label>"
  );
}

/* ------------------------------------------------------------------ *
 * Running a test
 * ------------------------------------------------------------------ */

function overlayEl() {
  return document.getElementById("exam-overlay");
}

function mountOverlay(fullscreen) {
  let overlay = overlayEl();
  if (overlay) return overlay;
  overlay = document.createElement("div");
  overlay.className = "exam-overlay";
  overlay.id = "exam-overlay";
  document.getElementById("overlay-root").appendChild(overlay);
  overlay.addEventListener("click", handleOverlayClick);
  overlay.addEventListener("input", handleOverlayInput);
  document.addEventListener("keydown", handleKey, true);
  if (fullscreen) requestFullscreen(overlay);
  else exitFullscreen();
  return overlay;
}

// Real exam conditions: cover the browser chrome if the browser allows it.
function requestFullscreen(el) {
  try {
    const fn = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
    if (fn) {
      const p = fn.call(el, { navigationUI: "hide" });
      if (p && p.catch) p.catch(() => {});
    }
  } catch (e) {
    /* fullscreen refused - the overlay still covers the app */
  }
}

function exitFullscreen() {
  try {
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      const fn = document.exitFullscreen || document.webkitExitFullscreen;
      if (fn) {
        const p = fn.call(document);
        if (p && p.catch) p.catch(() => {});
      }
    }
  } catch (e) {
    /* ignore */
  }
}

export async function startTest(cfg) {
  const page = getPage(cfg.pageId);
  if (!page) return;
  const subject = subjectAncestor(cfg.pageId);
  const component = COMPONENTS[cfg.option.componentId];
  const notes = collectNotes(cfg.pageId, cfg.includeSubpages);

  const attempt = {
    id: uid(),
    pageId: cfg.pageId,
    pageTitle: page.title || "Untitled",
    subjectTitle: subject ? subject.title || "" : "",
    componentId: component.id,
    componentShort: component.short,
    optionId: cfg.option.id,
    optionLabel: cfg.option.label,
    site: cfg.site || "",
    includeSubpages: !!cfg.includeSubpages,
    startedAt: Date.now(),
    endsAt: null,
    status: "generating",
    answers: {},
    paper: null,
    result: null,
    timeUsedSeconds: 0
  };

  session = { attempt, view: "generating", error: null, timerId: null };
  mountOverlay(true);
  paint();

  try {
    const res = await postJson("/api/test/generate", {
      componentId: component.id,
      optionId: cfg.option.id,
      site: cfg.site || "",
      pageTitle: page.title || "Untitled",
      includedPages: notes.pages,
      notes: notes.text
    });
    if (!session || session.attempt.id !== attempt.id) return; // closed while waiting
    attempt.paper = res.paper;
    attempt.status = "in-progress";
    attempt.startedAt = Date.now();
    attempt.endsAt = attempt.startedAt + res.paper.timeLimitMinutes * 60000;
    saveAttempt(attempt);
    session.view = "exam";
    startTimer();
    paint();
  } catch (e) {
    if (!session) return;
    session.view = "error";
    session.error = e.message;
    paint();
  }
}

export function resumeAttempt(testId) {
  const attempt = getAttempt(testId);
  if (!attempt) return;
  if (attempt.status === "marked") {
    openResults(testId);
    return;
  }
  session = { attempt, view: "exam", error: null, timerId: null };
  mountOverlay(true);
  if (remainingSeconds() <= 0) {
    paint();
    submit(true);
    return;
  }
  startTimer();
  paint();
}

export function openResults(testId) {
  const attempt = getAttempt(testId);
  if (!attempt || !attempt.result) return;
  session = { attempt, view: "results", error: null, timerId: null };
  mountOverlay(false);
  paint();
}

function remainingSeconds() {
  if (!session || !session.attempt.endsAt) return 0;
  return Math.max(0, Math.round((session.attempt.endsAt - Date.now()) / 1000));
}

function startTimer() {
  stopTimer();
  session.timerId = setInterval(() => {
    const left = remainingSeconds();
    const el = document.getElementById("exam-timer");
    if (el) {
      el.textContent = clock(left);
      el.className = "exam-timer" + (left <= 120 ? " is-red" : left <= 600 ? " is-amber" : "");
    }
    if (left <= 0) {
      stopTimer();
      submit(true);
    }
  }, 1000);
}

function stopTimer() {
  if (session && session.timerId) clearInterval(session.timerId);
  if (session) session.timerId = null;
}

function clock(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
}

export function closeTest(force) {
  if (!session) return;
  const a = session.attempt;
  if (!force && a.status === "in-progress") {
    const el = document.getElementById("exam-leave");
    if (el) {
      el.hidden = false;
      return;
    }
  }
  stopTimer();
  if (a.status === "in-progress") saveAttempt(a);
  exitFullscreen();
  const overlay = overlayEl();
  if (overlay) overlay.remove();
  document.removeEventListener("keydown", handleKey, true);
  session = null;
  scheduleSave();
  onClose();
}

function handleKey(e) {
  if (!session) return;
  if (e.key === "Escape") {
    // Never let Escape dump you out of a live paper by accident.
    if (session.view === "exam") {
      e.preventDefault();
      const el = document.getElementById("exam-leave");
      if (el) el.hidden = false;
      return;
    }
    e.preventDefault();
    closeTest(true);
  }
}

function handleOverlayInput(e) {
  const ta = e.target.closest("[data-answer]");
  if (!ta || !session) return;
  const n = ta.dataset.answer;
  session.attempt.answers[n] = ta.value;
  const counter = document.querySelector('[data-words="' + n + '"]');
  if (counter) counter.textContent = wordCount(ta.value) + " words";
  scheduleSave();
}

function wordCount(text) {
  const t = String(text || "").trim();
  return t ? t.split(/\s+/).length : 0;
}

function handleOverlayClick(e) {
  const btn = e.target.closest("[data-exam-act]");
  if (!btn || !session) return;
  const act = btn.dataset.examAct;
  if (act === "close") closeTest(false);
  else if (act === "leave-cancel") {
    const el = document.getElementById("exam-leave");
    if (el) el.hidden = true;
  } else if (act === "leave-save") closeTest(true);
  else if (act === "submit") {
    const el = document.getElementById("exam-submit-confirm");
    if (el) el.hidden = false;
  } else if (act === "submit-cancel") {
    const el = document.getElementById("exam-submit-confirm");
    if (el) el.hidden = true;
  } else if (act === "submit-yes") submit(false);
  else if (act === "retry-mark") submit(false);
  else if (act === "jump") {
    const target = document.getElementById("exam-q-" + btn.dataset.q);
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

async function submit(auto) {
  if (!session || session.view === "marking") return;
  const attempt = session.attempt;
  stopTimer();
  attempt.timeUsedSeconds = Math.round((Date.now() - attempt.startedAt) / 1000);
  attempt.autoSubmitted = !!auto;
  attempt.status = "marking";
  saveAttempt(attempt);
  session.view = "marking";
  session.error = null;
  paint();

  try {
    const res = await postJson("/api/test/mark", {
      paper: attempt.paper,
      answers: attempt.answers,
      timeUsedSeconds: attempt.timeUsedSeconds
    });
    if (!session || session.attempt.id !== attempt.id) return;
    attempt.result = res.result;
    attempt.status = "marked";
    attempt.submittedAt = Date.now();
    saveAttempt(attempt);
    recordFromAttempt(attempt);
    session.view = "results";
    exitFullscreen(); // feedback is read normally, not under exam conditions
    paint();
  } catch (e) {
    if (!session) return;
    attempt.status = "in-progress";
    saveAttempt(attempt);
    session.view = "markError";
    session.error = e.message;
    paint();
  }
}

async function postJson(url, body) {
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  } catch (e) {
    throw new Error("No connection to the server. Test me needs to be online.");
  }
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    /* fall through */
  }
  if (!res.ok || !data || data.error) {
    throw new Error((data && data.error) || "The server returned an error (" + res.status + ").");
  }
  return data;
}

/* ------------------------------------------------------------------ *
 * Painting
 * ------------------------------------------------------------------ */

function paint() {
  const overlay = overlayEl();
  if (!overlay || !session) return;
  if (session.view === "generating") overlay.innerHTML = renderBusy("Writing your paper", "Gemini is reading your notes and setting questions in AQA's format. This takes around 20 seconds.");
  else if (session.view === "marking") overlay.innerHTML = renderBusy("Marking your script", "Every answer is being marked against the mark scheme that came with this paper.");
  else if (session.view === "error") overlay.innerHTML = renderError(session.error, false);
  else if (session.view === "markError") overlay.innerHTML = renderError(session.error, true);
  else if (session.view === "results") overlay.innerHTML = renderResults(session.attempt);
  else overlay.innerHTML = renderExam(session.attempt);

  if (session.view === "exam") {
    // Restore drafts after a re-render (resume, or returning from an error).
    overlay.querySelectorAll("[data-answer]").forEach((ta) => {
      const v = session.attempt.answers[ta.dataset.answer];
      if (v) ta.value = v;
    });
  }
}

function renderBusy(title, sub) {
  return (
    '<div class="exam-shell exam-centred">' +
    '<div class="exam-busy"><div class="exam-spinner"></div>' +
    "<h2>" + escapeHtml(title) + "</h2><p>" + escapeHtml(sub) + "</p>" +
    '<button class="btn-ghost" data-exam-act="close">Cancel</button>' +
    "</div></div>"
  );
}

function renderError(message, marking) {
  return (
    '<div class="exam-shell exam-centred">' +
    '<div class="exam-busy">' +
    '<div class="exam-error-icon">' + ui("warning", 30) + "</div>" +
    "<h2>" + (marking ? "Couldn\u2019t mark it" : "Couldn\u2019t build the paper") + "</h2>" +
    "<p>" + escapeHtml(message || "Something went wrong.") + "</p>" +
    (marking ? "<p class=\"exam-error-note\">Your answers are saved.</p>" : "") +
    '<div class="exam-busy-actions">' +
    (marking ? '<button class="btn-primary" data-exam-act="retry-mark">Try marking again</button>' : "") +
    '<button class="btn-ghost" data-exam-act="close">Close</button>' +
    "</div></div></div>"
  );
}

function renderExam(attempt) {
  const paper = attempt.paper;
  const left = remainingSeconds();

  let html = '<div class="exam-shell">';

  html +=
    '<div class="exam-bar">' +
    '<div class="exam-bar-left">' +
    '<div class="exam-bar-title">' + escapeHtml(paper.sectionTitle) + "</div>" +
    '<div class="exam-bar-sub">' + escapeHtml(paper.optionLabel) + " \u00b7 " + paper.totalMarks + " marks</div>" +
    "</div>" +
    '<div class="exam-timer' + (left <= 120 ? " is-red" : left <= 600 ? " is-amber" : "") + '" id="exam-timer">' + clock(left) + "</div>" +
    '<div class="exam-bar-right">' +
    '<button class="exam-submit-btn" data-exam-act="submit">Finish and mark</button>' +
    '<button class="exam-close" data-exam-act="close" title="Leave (your answers are saved)">' + ui("close", 16, 2.2) + "</button>" +
    "</div></div>";

  html += '<div class="exam-body">';

  html +=
    '<div class="exam-instructions">' +
    "<strong>" + escapeHtml(paper.paperTitle) + "</strong>" +
    "<span>Answer all questions. Time allowed: " + paper.timeLimitMinutes + " minutes. " +
    "The paper submits itself when the clock runs out.</span>" +
    "</div>";

  if (paper.sources && paper.sources.length) {
    html += '<div class="exam-sources">';
    paper.sources.forEach((s) => {
      html +=
        '<div class="exam-source">' +
        '<div class="exam-source-label">' + escapeHtml(s.label) + "</div>" +
        '<div class="exam-source-prov">' + escapeHtml(s.provenance) + "</div>" +
        '<div class="exam-source-body">' + escapeHtml(s.body) + "</div>" +
        "</div>";
    });
    html +=
      '<div class="exam-source-note">' + ui("warning", 12) +
      " Sources and interpretations here are written by AI in period style for practice \u2014 they are not genuine archive documents.</div>";
    html += "</div>";
  }

  paper.questions.forEach((q) => {
    const total = q.marks + (q.spagMarks || 0);
    html +=
      '<div class="exam-question" id="exam-q-' + q.number + '">' +
      '<div class="exam-q-head">' +
      '<div class="exam-q-num">' + q.number + "</div>" +
      '<div class="exam-q-marks">[' + total + " marks" + (q.spagMarks ? ", inc. " + q.spagMarks + " SPaG" : "") + "]</div>" +
      "</div>" +
      '<div class="exam-q-stem">' + escapeHtml(q.stem).replace(/\n/g, "<br>") + "</div>" +
      (q.usesSources && q.usesSources.length
        ? '<div class="exam-q-uses">Use ' + escapeHtml(q.usesSources.join(" and ")) + " above.</div>"
        : "") +
      '<textarea class="exam-answer" data-answer="' + q.number + '" rows="' + rowsFor(q) + '" ' +
      'spellcheck="false" autocorrect="off" autocapitalize="off" autocomplete="off" ' +
      'data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false" ' +
      'placeholder="Write your answer here\u2026"></textarea>' +
      '<div class="exam-q-foot">' +
      '<span class="exam-q-time">Spend about ' + q.guidanceMinutes + " minutes</span>" +
      '<span class="exam-q-words" data-words="' + q.number + '">' + wordCount(attempt.answers[q.number]) + " words</span>" +
      "</div></div>";
  });

  html +=
    '<div class="exam-end">' +
    '<button class="btn-primary exam-end-btn" data-exam-act="submit">Finish and mark my paper</button>' +
    "</div>";

  html += "</div>"; // body

  html +=
    '<div class="exam-confirm" id="exam-submit-confirm" hidden><div class="exam-confirm-card">' +
    "<h3>Finish the paper?</h3><p>Your script goes to the examiner and the clock stops. You can\u2019t add anything after this.</p>" +
    '<div class="modal-actions"><button class="btn-cancel" data-exam-act="submit-cancel">Keep writing</button>' +
    '<button class="btn-primary" data-exam-act="submit-yes">Finish and mark</button></div></div></div>';

  html +=
    '<div class="exam-confirm" id="exam-leave" hidden><div class="exam-confirm-card">' +
    "<h3>Leave this paper?</h3><p>Your answers are saved and the paper stays open, but the clock keeps running \u2014 just like the real thing.</p>" +
    '<div class="modal-actions"><button class="btn-cancel" data-exam-act="leave-cancel">Stay</button>' +
    '<button class="btn-danger" data-exam-act="leave-save">Leave</button></div></div></div>';

  html += "</div>";
  return html;
}

function rowsFor(q) {
  const total = q.marks + (q.spagMarks || 0);
  if (total >= 16) return 18;
  if (total >= 12) return 14;
  if (total >= 8) return 10;
  return 5;
}

/* ---------- results ---------- */

function renderResults(attempt) {
  const r = attempt.result;
  const paper = attempt.paper;
  const pct = r.percentage;

  let html = '<div class="exam-shell exam-results">';

  html +=
    '<div class="exam-bar">' +
    '<div class="exam-bar-left">' +
    '<div class="exam-bar-title">Marked \u00b7 ' + escapeHtml(paper.sectionTitle) + "</div>" +
    '<div class="exam-bar-sub">' + escapeHtml(paper.optionLabel) + "</div></div>" +
    '<div class="exam-bar-right">' +
    '<button class="exam-close" data-exam-act="close" title="Close">' + ui("close", 16, 2.2) + "</button>" +
    "</div></div>";

  html += '<div class="exam-body">';

  html +=
    '<div class="result-score">' +
    '<div class="result-mark"><span class="big">' + r.totalMark + '</span><span class="outof">/ ' + r.totalAvailable + "</span></div>" +
    '<div class="result-meta">' +
    '<div class="result-pct">' + pct + "%</div>" +
    '<div class="result-time">' + formatDuration(attempt.timeUsedSeconds) + " used" +
    (attempt.autoSubmitted ? " \u00b7 time ran out" : "") + "</div>" +
    "</div></div>";

  if (r.overallComment) html += '<div class="result-comment">' + escapeHtml(r.overallComment) + "</div>";

  html += '<div class="result-cols">';
  html += resultList("Strengths", "check", (r.strengths || []).map((s) => ({ text: s })), "good");
  html += resultList(
    "Focus areas",
    "target",
    (r.focusAreas || []).map((f) => ({ text: f.area, detail: [f.why, f.action].filter(Boolean).join(" ") })),
    "warn"
  );
  html += "</div>";

  if ((r.missedContent || []).length) {
    html +=
      '<div class="result-block"><div class="result-block-title">' + ui("bulb", 14) +
      " Points you missed</div><ul class=\"result-points\">" +
      r.missedContent.map((m) => "<li>" + escapeHtml(m) + "</li>").join("") +
      "</ul></div>";
  }

  if ((r.notesGaps || []).length) {
    html +=
      '<div class="result-block is-gap"><div class="result-block-title">' + ui("warning", 14) +
      " Missing from your notes</div><ul class=\"result-points\">" +
      r.notesGaps.map((m) => "<li>" + escapeHtml(m) + "</li>").join("") +
      "</ul></div>";
  }

  html += '<div class="result-section-label">Question by question</div>';
  (r.questions || []).forEach((q) => {
    const spec = paper.questions.find((x) => x.number === q.number) || {};
    const answer = attempt.answers[q.number] || "";
    const scored = q.mark + (q.spagMark || 0);
    const outOf = q.outOf + (q.spagOutOf || 0);
    html +=
      '<div class="result-q">' +
      '<div class="result-q-head">' +
      '<div class="result-q-num">Q' + q.number + "</div>" +
      '<div class="result-q-mark">' + scored + " / " + outOf + "</div>" +
      '<div class="result-q-level">' + escapeHtml(q.level || "") + "</div>" +
      "</div>" +
      '<div class="result-q-stem">' + escapeHtml(spec.stem || "").replace(/\n/g, "<br>") + "</div>" +
      '<div class="result-q-comment">' + escapeHtml(q.examinerComment || "") + "</div>" +
      (q.spagOutOf
        ? '<div class="result-spag">SPaG ' + (q.spagMark || 0) + " / " + q.spagOutOf +
          (q.spagComment ? " \u2014 " + escapeHtml(q.spagComment) : "") + "</div>"
        : "") +
      ((q.didWell || []).length
        ? '<div class="result-q-list good"><span class="rl-label">Did well</span><ul>' +
          q.didWell.map((d) => "<li>" + escapeHtml(d) + "</li>").join("") + "</ul></div>"
        : "") +
      ((q.missedPoints || []).length
        ? '<div class="result-q-list miss"><span class="rl-label">Missed</span><ul>' +
          q.missedPoints.map((d) => "<li>" + escapeHtml(d) + "</li>").join("") + "</ul></div>"
        : "") +
      '<details class="result-q-answer"><summary>Your answer (' + wordCount(answer) + " words)</summary><pre>" +
      escapeHtml(answer || "[No answer written]") + "</pre>" +
      (spec.markScheme && spec.markScheme.levels && spec.markScheme.levels.length
        ? '<div class="result-scheme"><div class="rs-title">Mark scheme</div>' +
          spec.markScheme.levels
            .map(
              (l) =>
                '<div class="rs-level"><strong>' + escapeHtml(l.level) + " (" + escapeHtml(l.markRange) +
                ")</strong> " + escapeHtml(l.descriptor) + "</div>"
            )
            .join("") +
          ((spec.markScheme.indicativeContent || []).length
            ? '<div class="rs-title">Indicative content</div><ul>' +
              spec.markScheme.indicativeContent.map((i) => "<li>" + escapeHtml(i) + "</li>").join("") +
              "</ul>"
            : "") +
          "</div>"
        : "") +
      "</details>" +
      "</div>";
  });

  html +=
    '<div class="result-foot">' +
    '<p>Your focus areas and missed points have been saved to <strong>Exam feedback</strong> on this page and on Today, so they don\u2019t vanish with this screen.</p>' +
    '<button class="btn-primary" data-exam-act="close">Done</button>' +
    "</div>";

  html += "</div></div>";
  return html;
}

function resultList(title, icon, items, tone) {
  if (!items.length) return "";
  return (
    '<div class="result-col tone-' + tone + '">' +
    '<div class="result-col-title">' + ui(icon, 14) + " " + title + "</div><ul>" +
    items
      .map(
        (i) =>
          "<li><span class=\"rc-main\">" + escapeHtml(i.text || "") + "</span>" +
          (i.detail ? '<span class="rc-detail">' + escapeHtml(i.detail) + "</span>" : "") + "</li>"
      )
      .join("") +
    "</ul></div>"
  );
}
