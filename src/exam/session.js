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
import { collectNotes, titleCloud, subjectAncestor, pageWordCount } from "./notes.js";
import { saveAttempt, getAttempt, recordFromAttempt, unfinishedAttemptForPage } from "./insights.js";
import { authHeaders } from "../cloud/auth.js";
import { generateFlashcardsFromMisses } from "../quiz/flashcards.js";
import { completeTaskForPage } from "../plan/store.js";

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
 * Full papers (subject level)
 * ------------------------------------------------------------------ */

/*
 * A real AQA History paper is two sections sat back to back, one hour each.
 * On a subject page you can therefore sit the whole two hour paper: pick
 * Paper 1 (Section A + Section B) or Paper 2 (Section A + Section B), then
 * choose which of your topic pages each section is written from.
 */
const SECTION_LETTERS = ["A", "B"];

export const PAPER_PAIRS = [
  { key: "P1", label: "Paper 1: Understanding the modern world", sections: ["P1SA", "P1SB"] },
  { key: "P2", label: "Paper 2: Shaping the nation", sections: ["P2SA", "P2SB"] }
];

export function paperPairByKey(key) {
  return PAPER_PAIRS.filter((p) => p.key === key)[0] || null;
}

function pairMinutes(pair) {
  return pair.sections.reduce((sum, cid) => sum + COMPONENTS[cid].timeLimitMinutes, 0);
}

/**
 * Null unless this is a top level AQA History subject page with at least two
 * topic pages worth examining. Otherwise { subject, topics: [...] }.
 */
export function fullPaperEligibility(pageId) {
  const page = getPage(pageId);
  if (!page || page.type !== "subject") return null;
  if (!HISTORY_TITLE_MATCH.test(page.title || "")) return null;
  if (page.examBoard !== "AQA") return null;

  const topics = [];
  getChildren(pageId).forEach((child) => {
    const notes = collectNotes(child.id, true);
    if (notes.wordCount < MIN_NOTE_WORDS) return;
    const saved = child.examOptionId ? optionById(child.examOptionId) : null;
    const guess = saved ? { option: saved } : inferOption(titleCloud(child.id).concat([notes.text.slice(0, 4000)]));
    topics.push({
      pageId: child.id,
      title: child.title || "Untitled",
      words: notes.wordCount,
      ownWords: pageWordCount(child.id),
      optionId: guess && guess.option ? guess.option.id : ""
    });
  });

  if (topics.length < 2) return null;
  return { subject: page, topics: topics };
}

/* ------------------------------------------------------------------ *
 * Setup card
 * ------------------------------------------------------------------ */

export function openTestSetup(pageId) {
  const el = testEligibility(pageId);
  if (!el) return;

  const existing = unfinishedAttemptForPage(pageId);
  const full = fullPaperEligibility(pageId);
  const modal = document.createElement("div");
  modal.className = "modal-overlay exam-setup-overlay";
  modal.id = "exam-setup";
  modal.innerHTML = renderSetup(el, existing, full);
  document.getElementById("overlay-root").appendChild(modal);

  modal.addEventListener("mousedown", (e) => {
    if (e.target === modal) modal.remove();
  });

  const syncMode = () => {
    const modeEl = modal.querySelector('input[name="exam-mode"]:checked');
    const mode = modeEl ? modeEl.value : "section";
    modal.querySelectorAll("[data-mode-block]").forEach((el2) => {
      el2.hidden = el2.dataset.modeBlock !== mode;
    });
    if (mode === "full") {
      const pairEl = modal.querySelector('input[name="exam-pair"]:checked');
      const pairKey = pairEl ? pairEl.value : "P1";
      modal.querySelectorAll("[data-pair-block]").forEach((el2) => {
        el2.hidden = el2.dataset.pairBlock !== pairKey;
      });
    }
    const startBtn = modal.querySelector('[data-setup-act="start"]');
    if (startBtn) {
      startBtn.textContent = mode === "full" ? "Start full paper" : "Start mock exam";
    }
  };

  modal.addEventListener("change", (e) => {
    const sel = e.target.closest("#exam-option");
    if (sel) {
      const opt = optionById(sel.value);
      const siteRow = modal.querySelector("#exam-site-row");
      if (siteRow) siteRow.hidden = !(opt && opt.siteRequired);
    }
    if (e.target.name === "exam-mode" || e.target.name === "exam-pair") syncMode();
    const fullSel = e.target.closest("[data-full-option]");
    if (fullSel) {
      const opt = optionById(fullSel.value);
      const row = modal.querySelector("#full-site-row");
      if (row) row.hidden = !fullNeedsSite(modal);
      if (opt) { /* keep the chosen option; nothing else to sync */ }
    }
  });
  syncMode();

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

    const modeEl = modal.querySelector('input[name="exam-mode"]:checked');
    if (modeEl && modeEl.value === "full") {
      const cfg = readFullPaperSetup(modal, pageId);
      if (!cfg) return;
      modal.remove();
      startFullPaper(cfg);
      return;
    }

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

function fullNeedsSite(modal) {
  const pairEl = modal.querySelector('input[name="exam-pair"]:checked');
  const pairKey = pairEl ? pairEl.value : "P1";
  const block = modal.querySelector('[data-pair-block="' + pairKey + '"]');
  if (!block) return false;
  let needs = false;
  block.querySelectorAll("[data-full-option]").forEach((sel) => {
    const opt = optionById(sel.value);
    if (opt && opt.siteRequired) needs = true;
  });
  return needs;
}

function readFullPaperSetup(modal, pageId) {
  const pairEl = modal.querySelector('input[name="exam-pair"]:checked');
  const pair = paperPairByKey(pairEl ? pairEl.value : "P1");
  if (!pair) return null;
  const block = modal.querySelector('[data-pair-block="' + pair.key + '"]');
  if (!block) return null;

  const warn = modal.querySelector("#full-warn");
  const sections = [];
  let bad = "";
  pair.sections.forEach((cid, i) => {
    const topicSel = block.querySelector('[data-full-topic="' + i + '"]');
    const optSel = block.querySelector('[data-full-option="' + i + '"]');
    const topicId = topicSel ? topicSel.value : "";
    const option = optSel ? optionById(optSel.value) : null;
    if (!topicId || !option) bad = "Choose a topic and an option for both sections.";
    sections.push({ componentId: cid, optionId: option ? option.id : "", pageId: topicId });
  });
  if (!bad && sections[0].pageId === sections[1].pageId) {
    bad = "Pick two different topics \u2014 the two sections examine different parts of the course.";
  }

  const siteInput = modal.querySelector("#full-site");
  const site = siteInput ? siteInput.value.trim() : "";
  if (!bad && fullNeedsSite(modal) && !site) bad = "Enter your historic environment site before starting.";

  if (bad) {
    if (warn) {
      warn.textContent = bad;
      warn.hidden = false;
    }
    return null;
  }

  // Remember the mapping so next time it is one click.
  sections.forEach((sec) => {
    const p = getPage(sec.pageId);
    if (p) p.examOptionId = sec.optionId;
  });
  const subject = getPage(pageId);
  if (site && subject) subject.historicSite = site;
  scheduleSave();

  return { pageId: pageId, pairKey: pair.key, sections: sections, site: site };
}

function renderSetup(el, existing, full) {
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

  if (full) {
    const pairs = PAPER_PAIRS.map(
      (p) => escapeHtml(p.label) + " (" + pairMinutes(p) + " min)"
    );
    html += '<label class="exam-field-label">How much do you want to sit?</label>';
    html += '<div class="exam-modes">';
    html +=
      '<label class="exam-mode-row"><input type="radio" name="exam-mode" value="section" checked />' +
      '<span><strong>One section</strong><span class="exam-scope-meta">60 minutes \u00b7 one section from these notes</span></span></label>';
    html +=
      '<label class="exam-mode-row"><input type="radio" name="exam-mode" value="full" />' +
      '<span><strong>Full paper</strong><span class="exam-scope-meta">2 hours \u00b7 both sections back to back, exactly like the real thing</span></span></label>';
    html += '</div>';
    html += renderFullBlock(full);
    html += '<div data-mode-block="section">';
  } else {
    html += '<div data-mode-block="section">';
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

  html += "</div>"; // section-mode block

  html +=
    '<div class="modal-actions">' +
    '<button class="btn-cancel" data-setup-act="cancel">Cancel</button>' +
    '<button class="btn-primary" data-setup-act="start">Start mock exam</button>' +
    "</div></div>";
  return html;
}

/* The two-section picker. Both papers are rendered and one is shown, so the
   option lists never have to be rebuilt by hand. */
function renderFullBlock(full) {
  let html = '<div data-mode-block="full" class="exam-full" hidden>';

  html += '<label class="exam-field-label">Which paper?</label><div class="exam-modes">';
  PAPER_PAIRS.forEach((p, i) => {
    html +=
      '<label class="exam-mode-row"><input type="radio" name="exam-pair" value="' + p.key + '"' +
      (i === 0 ? " checked" : "") + ' /><span><strong>' + escapeHtml(p.label) + '</strong>' +
      '<span class="exam-scope-meta">' + p.sections.map((cid) => COMPONENTS[cid].short).join(" + ") +
      ' \u00b7 ' + p.sections.reduce((n, cid) => n + COMPONENTS[cid].totalMarks, 0) + ' marks \u00b7 ' +
      pairMinutes(p) + ' minutes</span></span></label>';
  });
  html += '</div>';

  PAPER_PAIRS.forEach((p, pi) => {
    html += '<div data-pair-block="' + p.key + '"' + (pi === 0 ? "" : " hidden") + '>';
    p.sections.forEach((cid, i) => {
      const c = COMPONENTS[cid];
      const letter = SECTION_LETTERS[i];
      html +=
        '<div class="exam-full-row">' +
        '<div class="exam-full-head"><strong>Section ' + letter + '</strong><span>' +
        escapeHtml(c.section) + ' \u00b7 ' + c.totalMarks + ' marks \u00b7 ' + c.timeLimitMinutes + ' minutes</span></div>';

      html += '<div class="exam-full-fields">';
      html += '<label class="exam-full-field"><span>Topic from your notes</span><select class="exam-select" data-full-topic="' + i + '">';
      full.topics.forEach((t, ti) => {
        const opt = t.optionId ? optionById(t.optionId) : null;
        const matches = opt && opt.componentId === cid;
        const selected = matches ? " selected" : "";
        html +=
          '<option value="' + t.pageId + '"' + (selected || (ti === i && !full.topics.some((x) => {
            const o = x.optionId ? optionById(x.optionId) : null;
            return o && o.componentId === cid;
          }) ? " selected" : "")) + '>' + escapeHtml(t.title) + ' (' + t.words + ' words)</option>';
      });
      html += '</select></label>';

      html += '<label class="exam-full-field"><span>Option examined</span><select class="exam-select" data-full-option="' + i + '">';
      optionsForComponent(cid).forEach((o) => {
        const guessed = full.topics.some((t) => t.optionId === o.id);
        html += '<option value="' + o.id + '"' + (guessed ? " selected" : "") + '>' + escapeHtml(o.label) + '</option>';
      });
      html += '</select></label></div></div>';
    });
    html += '</div>';
  });

  html +=
    '<div id="full-site-row" class="exam-site-row" hidden>' +
    '<label class="exam-field-label" for="full-site">Your historic environment site this year</label>' +
    '<input id="full-site" class="exam-input" type="text" spellcheck="false" placeholder="e.g. Pevensey Castle" value="' +
    escapeHtml(full.subject.historicSite || "") + '" />' +
    '<div class="exam-field-note">Paper 2 Section B always ends on the specified site.</div></div>';

  html +=
    '<div class="exam-field-note">Both sections are generated up front, then you sit them under one ' +
    'continuous clock with no break \u2014 the paper submits itself at the end.</div>';
  html += '<div class="exam-warn" id="full-warn" hidden></div>';
  html += '</div>';
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

/*
 * A full paper: two sections generated up front, then sat back to back under
 * one continuous clock. The clock is whatever the real paper gets - two
 * sections of an hour each - never a made up round number.
 */
export async function startFullPaper(cfg) {
  const subject = getPage(cfg.pageId);
  const pair = paperPairByKey(cfg.pairKey);
  if (!subject || !pair) return;

  const sections = cfg.sections.map((sec, i) => {
    const component = COMPONENTS[sec.componentId];
    const option = optionById(sec.optionId);
    const page = getPage(sec.pageId);
    return {
      letter: SECTION_LETTERS[i] || String(i + 1),
      componentId: component.id,
      componentShort: component.short,
      sectionTitle: component.section,
      optionId: option ? option.id : "",
      optionLabel: option ? option.label : "",
      pageId: sec.pageId,
      pageTitle: page ? page.title || "Untitled" : "",
      minutes: component.timeLimitMinutes,
      paper: null,
      marked: null
    };
  });

  const attempt = {
    id: uid(),
    pageId: cfg.pageId,
    pageTitle: subject.title || "Untitled",
    subjectTitle: subject.title || "",
    fullPaper: true,
    pairKey: pair.key,
    pairLabel: pair.label,
    componentId: sections.map((x) => x.componentId).join("+"),
    componentShort: pair.key === "P1" ? "Paper 1" : "Paper 2",
    optionId: sections.map((x) => x.optionId).join("+"),
    optionLabel: sections.map((x) => x.optionLabel).filter(Boolean).join(" \u00b7 "),
    site: cfg.site || "",
    includeSubpages: true,
    startedAt: Date.now(),
    endsAt: null,
    status: "generating",
    answers: {},
    sections: sections,
    paper: null,
    result: null,
    timeUsedSeconds: 0
  };

  session = { attempt, view: "generating", error: null, timerId: null };
  mountOverlay(true);
  paint();

  try {
    const responses = await Promise.all(
      sections.map((sec) => {
        const notes = collectNotes(sec.pageId, true);
        return postJson("/api/test/generate", {
          componentId: sec.componentId,
          optionId: sec.optionId,
          site: cfg.site || "",
          pageTitle: sec.pageTitle,
          includedPages: notes.pages,
          notes: notes.text
        });
      })
    );
    if (!session || session.attempt.id !== attempt.id) return; // closed while waiting
    responses.forEach((res, i) => {
      sections[i].paper = res.paper;
    });
    attempt.status = "in-progress";
    attempt.startedAt = Date.now();
    attempt.endsAt = attempt.startedAt + fullPaperMinutes(attempt) * 60000;
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

function fullPaperMinutes(attempt) {
  return (attempt.sections || []).reduce(
    (n, sec) => n + ((sec.paper && sec.paper.timeLimitMinutes) || sec.minutes || 0),
    0
  );
}

/*
 * One paper object for rendering, built from the sections on the fly. It is
 * never saved, so a full paper does not store its questions twice.
 */
function paperFor(attempt) {
  if (!attempt.fullPaper) return attempt.paper;
  const secs = (attempt.sections || []).filter((sec) => sec.paper);
  const questions = [];
  const groups = [];
  secs.forEach((sec) => {
    const qs = (sec.paper.questions || []).map((q) => {
      const copy = Object.assign({}, q);
      copy.baseNumber = q.number;
      copy.number = sec.letter + q.number;
      copy.sectionLetter = sec.letter;
      return copy;
    });
    qs.forEach((q) => questions.push(q));
    groups.push({
      letter: sec.letter,
      title: sec.paper.sectionTitle || sec.sectionTitle,
      optionLabel: sec.paper.optionLabel || sec.optionLabel,
      pageTitle: sec.pageTitle,
      totalMarks: sec.paper.totalMarks || 0,
      minutes: sec.paper.timeLimitMinutes || sec.minutes || 0,
      sources: sec.paper.sources || [],
      questions: qs
    });
  });
  return {
    paperTitle: attempt.pairLabel || "Full paper",
    sectionTitle: (attempt.componentShort || "Full paper") + " \u00b7 both sections",
    optionLabel: attempt.optionLabel || "",
    totalMarks: groups.reduce((n, g) => n + g.totalMarks, 0),
    timeLimitMinutes: groups.reduce((n, g) => n + g.minutes, 0),
    sources: [],
    questions: questions,
    groups: groups
  };
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
    let result;
    if (attempt.fullPaper) {
      // Each section is marked against its own mark scheme, then the two are
      // added up into one paper mark.
      const marked = await Promise.all(
        (attempt.sections || []).map((sec) => {
          const answers = {};
          (sec.paper.questions || []).forEach((q) => {
            const v = attempt.answers[sec.letter + q.number];
            if (v) answers[q.number] = v;
          });
          return postJson("/api/test/mark", {
            paper: sec.paper,
            answers: answers,
            timeUsedSeconds: attempt.timeUsedSeconds
          });
        })
      );
      if (!session || session.attempt.id !== attempt.id) return;
      result = mergeResults(attempt, marked.map((m) => m.result));
    } else {
      const res = await postJson("/api/test/mark", {
        paper: attempt.paper,
        answers: attempt.answers,
        timeUsedSeconds: attempt.timeUsedSeconds
      });
      if (!session || session.attempt.id !== attempt.id) return;
      result = res.result;
    }
    attempt.result = result;
    attempt.status = "marked";
    attempt.submittedAt = Date.now();
    saveAttempt(attempt);
    recordFromAttempt(attempt);
    // A sat paper ticks off the mock scheduled for today, wherever it ran over.
    completeTaskForPage(attempt.pageId, ["test", "final"]);
    runFlashcards(attempt);
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

/* Two section results, one paper. Question numbers keep their section letter
   so nothing collides in the feedback. */
function mergeResults(attempt, results) {
  const secs = attempt.sections || [];
  let mark = 0;
  let outOf = 0;
  const strengths = [];
  const focusAreas = [];
  const missedContent = [];
  const notesGaps = [];
  const questions = [];
  const comments = [];

  results.forEach((r, i) => {
    if (!r) return;
    const sec = secs[i] || { letter: SECTION_LETTERS[i] || String(i + 1) };
    mark += r.totalMark || 0;
    outOf += r.totalAvailable || 0;
    if (r.overallComment) comments.push("Section " + sec.letter + ": " + r.overallComment);
    (r.strengths || []).forEach((x) => strengths.push(x));
    (r.focusAreas || []).forEach((f) =>
      focusAreas.push({
        area: "Section " + sec.letter + " \u00b7 " + (f.area || ""),
        why: f.why || "",
        action: f.action || ""
      })
    );
    (r.missedContent || []).forEach((x) => missedContent.push(x));
    (r.notesGaps || []).forEach((x) => notesGaps.push(x));
    (r.questions || []).forEach((q) => {
      const copy = Object.assign({}, q);
      copy.number = sec.letter + q.number;
      questions.push(copy);
    });
  });

  return {
    totalMark: mark,
    totalAvailable: outOf,
    percentage: outOf ? Math.round((mark / outOf) * 100) : 0,
    overallComment: comments.join(" "),
    strengths: strengths,
    focusAreas: focusAreas,
    missedContent: missedContent,
    notesGaps: notesGaps,
    questions: questions
  };
}

/*
 * Everything the examiner marked them down on becomes flashcards, written by
 * Gemini to close the gap rather than to repeat the question.
 */
async function runFlashcards(attempt) {
  const r = attempt.result;
  if (!r) return;

  const misses = [];
  (r.questions || []).forEach((q) => {
    (q.missedPoints || []).forEach((point) => {
      misses.push({
        topic: q.level || "Q" + q.number,
        question: "",
        detail: typeof point === "string" ? point : point.point || "",
        explanation: q.examinerComment || ""
      });
    });
  });
  (r.missedContent || []).forEach((m) => {
    misses.push({ topic: "Content", detail: typeof m === "string" ? m : m.point || "" });
  });
  (r.notesGaps || []).forEach((g) => {
    misses.push({ topic: "Gap in notes", detail: typeof g === "string" ? g : g.point || "" });
  });
  (r.focusAreas || []).forEach((f) => {
    misses.push({ topic: f.area || "Technique", detail: [f.why, f.action].filter(Boolean).join(" ") });
  });

  const usable = misses.filter((m) => m.detail);
  if (!usable.length) return;

  const out = await generateFlashcardsFromMisses({
    pageId: attempt.pageId,
    pageTitle: attempt.pageTitle,
    subjectTitle: attempt.subjectTitle,
    source: "test",
    includeSubpages: !!attempt.includeSubpages,
    attemptId: attempt.id,
    misses: usable.slice(0, 24)
  });

  attempt.cardsMade = (attempt.cardsMade || 0) + out.made;
  attempt.cardsResurfaced = out.resurfaced || 0;
  attempt.cardsAiWritten = out.aiUsed;
  saveAttempt(attempt);
  if (session && session.attempt.id === attempt.id && session.view === "results") paint();
}

async function postJson(url, body) {
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: await authHeaders(),
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
  const paper = paperFor(attempt);
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
    "<span>Answer all questions. Time allowed: " + paper.timeLimitMinutes + " minutes" +
    (paper.groups ? " for the whole paper, with no break between sections" : "") + ". " +
    "The paper submits itself when the clock runs out.</span>" +
    "</div>";

  if (paper.groups) {
    paper.groups.forEach((g) => {
      html +=
        '<div class="exam-section-head">' +
        "<h3>Section " + g.letter + " \u00b7 " + escapeHtml(g.title) + "</h3>" +
        "<span>" + escapeHtml(g.optionLabel) + " \u00b7 " + g.totalMarks + " marks \u00b7 about " +
        g.minutes + " minutes \u00b7 from " + escapeHtml(g.pageTitle) + "</span></div>";
      html += sourcesHtml({ sources: g.sources });
      html += questionsHtml(attempt, g.questions);
    });
  } else {
    html += sourcesHtml(paper);
    html += questionsHtml(attempt, paper.questions);
  }

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

function sourcesHtml(paper) {
  let html = "";
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
  return html;
}

function questionsHtml(attempt, questions) {
  let html = "";
  questions.forEach((q) => {
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
  const paper = paperFor(attempt);
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
          q.didWell.slice(0, 2).map((d) => "<li>" + escapeHtml(d) + "</li>").join("") + "</ul></div>"
        : "") +
      ((q.missedPoints || []).length
        ? '<div class="result-q-list miss"><span class="rl-label">Missed</span><ul>' +
          q.missedPoints.slice(0, 3).map((d) => "<li>" + escapeHtml(d) + "</li>").join("") + "</ul></div>"
        : "") +
      /* The one change that would move this answer up a level. It sits inside
         the question it belongs to rather than in a panel of its own. */
      (q.nextBand
        ? '<div class="result-q-next"><span class="rl-label">To go up a level</span>' +
          escapeHtml(q.nextBand) + "</div>"
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
    (attempt.cardsMade
      ? "<p>" + ui("cards", 14) + " <strong>" + attempt.cardsMade + " flashcard" +
        (attempt.cardsMade === 1 ? "" : "s") + "</strong>" +
        (attempt.cardsAiWritten ? " written by Gemini" : " built") +
        " from what you were marked down on, under \u201cFlashcards from your mistakes\u201d on this page.</p>"
      : "") +
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
