/*
 * Shared definition of a ReviseIQ "Practise" - the middle rung between Quiz me
 * (ten minutes of multiple choice) and Test me (a real timed paper).
 *
 * A practise is written work: hard open-ended knowledge questions typed into
 * text areas, and - only where the actual structure of the exam is known -
 * a short second stage of real exam questions taken from the same registry and
 * the same generator the mock papers use.
 *
 * Length is never guessed. It is derived from marks, on a marks-per-minute
 * basis, and can never exceed MAX_TOTAL_MINUTES.
 *
 * This module is pure data and string building with no DOM access, so the
 * browser imports it for lengths and labels and the Vercel routes import it for
 * the prompts. The rules therefore live in exactly one place.
 */
import { GROUNDING_RULES } from "../quiz/quizPrompt.js";

/* Below this, a page has too little on it to write a fair practise from. */
export const MIN_PRACTISE_WORDS = 80;

/* Hard ceiling on how much of a page is sent to the model. */
export const MAX_NOTE_CHARS = 45000;

/* What the student can ask for, in minutes. */
export const TARGET_CHOICES = [10, 15, 20];
export const DEFAULT_TARGET_MINUTES = 15;
export const MIN_TARGET_MINUTES = 10;
export const MAX_TARGET_MINUTES = 20;

/* The absolute ceiling. A practise is never allowed past this, whatever the
   marks add up to. */
export const MAX_TOTAL_MINUTES = 25;

/* Writing rate for the knowledge stage: a mark is roughly a sentence or two.
   The exam stage does not use this - it uses the real paper's own timings. */
export const KNOWLEDGE_MINUTES_PER_MARK = 1.2;

/* Marks a single knowledge question may be worth. */
export const KNOWLEDGE_MARK_STEPS = [3, 4, 5, 6];

/* When there is an exam stage, this much of the budget goes to it. */
export const EXAM_SHARE = 0.6;

/* Never fewer or more knowledge questions than this. */
export const MIN_KNOWLEDGE_QUESTIONS = 3;
export const MAX_KNOWLEDGE_QUESTIONS = 7;

export function clampTarget(minutes) {
  const n = Math.round(Number(minutes) || 0);
  if (!n) return DEFAULT_TARGET_MINUTES;
  return Math.max(MIN_TARGET_MINUTES, Math.min(MAX_TARGET_MINUTES, n));
}

export function minutesForMarks(marks) {
  return Math.round(Number(marks || 0) * KNOWLEDGE_MINUTES_PER_MARK);
}

/**
 * How long the knowledge stage gets, and how much of it to write.
 *
 * Where there is no exam stage - which is every page whose exam structure we
 * do not actually know - the whole budget goes to knowledge, so the practise
 * is a longer written recall test rather than a truncated one.
 */
export function planKnowledge(targetMinutes, hasExamStage) {
  const target = clampTarget(targetMinutes);
  const minutes = hasExamStage ? Math.max(5, Math.round(target * (1 - EXAM_SHARE))) : target;
  const marks = Math.max(6, Math.round(minutes / KNOWLEDGE_MINUTES_PER_MARK));
  // Around four to five marks a question reads best. With no exam stage to
  // follow, questions are pitched slightly smaller so that a longer budget buys
  // more of them rather than the same three enormous ones - the whole point of
  // the knowledge-only version is that stage one runs longer.
  const marksPerQuestion = hasExamStage ? 4.5 : 3.6;
  let count = Math.round(marks / marksPerQuestion);
  count = Math.max(MIN_KNOWLEDGE_QUESTIONS, Math.min(MAX_KNOWLEDGE_QUESTIONS, count));
  return { minutes, marks, count };
}

/** How long the exam stage may run for, before the overall cap is applied. */
export function examBudgetMinutes(targetMinutes) {
  return Math.round(clampTarget(targetMinutes) * EXAM_SHARE);
}

/**
 * Chooses which of a real paper's questions to set, on the paper's own
 * marks-per-minute timings.
 *
 * The questions themselves are never rewritten or rescaled: a 12-mark question
 * is set as a 12-mark question, with the marks, the SPaG marks and the mark
 * scheme it has in the real paper. Only the choice of which questions to set
 * belongs to the practise.
 *
 * specs: [{ n, marks, spag, minutes, uses }]
 * Returns the chosen specs in paper order.
 */
export function selectExamQuestions(specs, budgetMinutes, capMinutes) {
  const list = (specs || []).filter((q) => q && Number(q.minutes) > 0);
  if (!list.length) return [];

  const cap = Math.max(1, Math.min(capMinutes === undefined ? MAX_TOTAL_MINUTES : capMinutes, MAX_TOTAL_MINUTES));
  const budget = Math.max(1, Math.min(budgetMinutes || 0, cap));

  // Biggest first: one substantial question teaches more than two small ones.
  const bySize = list.slice().sort((a, b) => b.minutes - a.minutes || b.marks - a.marks);

  // A little slack, so a 15-minute practise can still set a 12-mark question,
  // but never past the hard cap.
  const slack = Math.min(cap, Math.round(budget * 1.25));

  const chosen = [];
  let used = 0;

  const first = bySize.find((q) => q.minutes <= slack) || bySize[bySize.length - 1];
  if (first.minutes > cap) return [];
  chosen.push(first);
  used += first.minutes;

  // Room for a second, shorter question? Take the largest that still fits
  // inside the original budget.
  const second = bySize.find((q) => q !== first && used + q.minutes <= budget);
  if (second) {
    chosen.push(second);
    used += second.minutes;
  }

  return chosen.sort((a, b) => a.n - b.n);
}

/** Total allowed minutes for a practise, hard-capped. */
export function allowedMinutes(knowledgeMinutes, examMinutes) {
  const total = Math.round((knowledgeMinutes || 0) + (examMinutes || 0));
  return Math.max(5, Math.min(MAX_TOTAL_MINUTES, total));
}

/* ------------------------------------------------------------------ *
 * Stage one: hard open-ended knowledge questions from the notes
 * ------------------------------------------------------------------ */

/**
 * cfg: { count, marks, minutes, pageTitle, subjectTitle, includedPages, notes,
 *        hasExamStage }
 */
export function buildKnowledgePrompt(cfg) {
  const system = [
    "You are a demanding subject teacher writing a short written test for a GCSE student, using only the revision notes they give you.",
    "Every question is answered by typing prose into a text box. There are no multiple-choice questions.",
    "",
    "ABSOLUTE RULES",
    "1. Every question must be answerable from the notes alone. Never test a fact that is not in the notes, and never require outside knowledge.",
    "2. Never write a question that can be answered with one word, a yes or a no, or a date on its own.",
    "3. Do not phrase questions as 'according to the notes' or 'in this document'. Ask the question directly.",
    "4. Do not set essay questions. Each answer should take two to six sentences.",
    "5. Never ask two questions about the same fact, and spread the questions across the whole of the notes rather than clustering at the start.",
    "",
    "DIFFICULTY - THIS IS THE POINT OF THE EXERCISE",
    "These questions must be hard and must test knowledge, not opinion.",
    "- Demand specifics: names, dates, figures, terms, mechanisms, sequences, causes and consequences.",
    "- Favour 'explain why', 'explain how', 'what was the significance of', 'give three reasons and rank them',",
    "  'what is the difference between X and Y', 'what happened as a result of X', 'outline the sequence by which X led to Y'.",
    "- A student who has skim-read the notes should not be able to answer. A student who understands them should.",
    "- Never ask how the student feels about something, and never ask for their opinion unsupported by evidence.",
    "",
    "MARKS",
    "Each question is worth between 3 and 6 marks. Allocate marks to match how much the answer must contain:",
    "one mark for each distinct creditworthy point you would expect.",
    "",
    "FOR EACH QUESTION YOU MUST RETURN",
    "- number: the question number, starting at 1.",
    "- prompt: the question itself, plain text, one or two sentences.",
    "- marks: the marks available, 3 to 6.",
    "- rubric: one entry for EACH mark available, each stating a distinct creditworthy point in full",
    "  (for example 'the Dawes Plan rescheduled reparations payments'), never vague advice like 'good detail'.",
    "- modelAnswer: a full-mark answer in two to five sentences, written as a strong student would write it.",
    "- topic: a two to five word label for the concept being tested. These labels are reused as revision targets, so keep them specific.",
    "",
    "British English. Plain text only - no markdown, no bullets, no numbering inside fields.",
    "Return JSON only, matching the schema exactly."
  ].join("\n");

  const pages = (cfg.includedPages || []).filter(Boolean);
  const user = [
    "Write " + cfg.count + " hard open-ended knowledge questions on the notes below, totalling about " + cfg.marks + " marks.",
    "",
    "Subject: " + (cfg.subjectTitle || "Unknown"),
    "Page being revised: " + (cfg.pageTitle || "Untitled"),
    pages.length > 1 ? "Pages included: " + pages.join("; ") : "",
    "",
    "The student has about " + cfg.minutes + " minutes for this stage, so keep the total marks close to " + cfg.marks + ".",
    cfg.hasExamStage
      ? "Exam-style questions follow this stage, so test knowledge here rather than exam technique."
      : "This is the whole test, so cover the breadth of the notes rather than one corner of them.",
    "",
    "Give the practise a short title naming the topic (no more than eight words).",
    "",
    "--- NOTES START ---",
    cfg.notes,
    "--- NOTES END ---"
  ]
    .filter((l) => l !== "")
    .join("\n");

  return { system, user };
}

/**
 * Marking the knowledge stage, against the rubric that came with the question.
 *
 * cfg: { pageTitle, subjectTitle, questions: [{number, prompt, marks, rubric, modelAnswer, topic}],
 *        answers: { "1": "..." }, timeUsedSeconds }
 */
export function buildKnowledgeMarkingPrompt(cfg) {
  const notes = String(cfg.notes || "").slice(0, 14000);

  const system = [
    "You are marking a GCSE student's written answers against the mark scheme supplied with each question.",
    "",
    GROUNDING_RULES,
    "",
    "HOW TO MARK",
    "- Award one mark for each rubric point the answer genuinely makes. Wording need not match; the point must be there.",
    "- Credit valid creditworthy points that are not in the rubric, up to the marks available.",
    "- Mark positively, but be honest and precise. Do not inflate marks to be encouraging: a generous mark is a disservice to a student before a real exam.",
    "- A blank or wholly irrelevant answer scores 0.",
    "- Length is not merit. A short, precise answer can score full marks.",
    "- Never award more than the marks available for that question.",
    "",
    "FOR EACH QUESTION RETURN",
    "- mark and outOf.",
    "- comment: one sentence saying why it scored what it scored, quoting at most twelve words of what they",
    "  actually wrote as the evidence, or naming what they never mentioned.",
    "- didWell: the specific points they did make, in their own words where possible. Return nothing rather",
    "  than inventing praise.",
    "- missedPoints: the specific points they missed, each stated as the actual point of knowledge",
    "  (for example 'the role of the Dawes Plan in stabilising the currency'), never as vague advice like 'add more detail'.",
    "",
    "THEN RETURN AN OVERALL VERDICT",
    "- at most 2 strengths, each naming what the student can evidently do and the answer that showed it.",
    "- at most 3 focus areas, two is usually right. Each names the weakness, the specific content or wording",
    "  that cost the marks, and one concrete action for today. Never return a focus area that would apply to",
    "  any student; drop it instead.",
    "- missedContent: the specific points of knowledge absent across the whole script.",
    notes
      ? "- notesGaps: points the mark scheme expected which are genuinely absent from the student's own notes,\n" +
        "  supplied below. Quote the closest line of their notes, or say the notes do not touch it. If the notes\n" +
        "  do cover it and they simply did not use it, that belongs in focus areas instead."
      : "- notesGaps: points the mark scheme expected which their notes do not appear to contain.",
    "- overallComment: two or three sentences, direct and specific, no praise padding. It must name real",
    "  content, not describe the performance in general terms.",
    "",
    "Do not award or mention a grade. British English. Return only the JSON object."
  ].join("\n");

  const blocks = (cfg.questions || []).map((q) => {
    const a = String((cfg.answers || {})[String(q.number)] || "");
    const words = a.trim() ? a.trim().split(/\s+/).length : 0;
    return [
      "QUESTION " + q.number + " [" + q.marks + " marks] (" + (q.topic || "") + ")",
      q.prompt,
      "",
      "MARK SCHEME - one mark per point:",
      (q.rubric || []).map((r, i) => "  " + (i + 1) + ". " + r).join("\n"),
      q.modelAnswer ? "\nFULL-MARK ANSWER FOR REFERENCE:\n" + q.modelAnswer : "",
      "",
      "STUDENT'S ANSWER (" + words + " words):",
      a.trim() ? a : "[No answer written]"
    ]
      .filter((l) => l !== "")
      .join("\n");
  });

  const user = [
    "Subject: " + (cfg.subjectTitle || "Unknown"),
    "Topic page: " + (cfg.pageTitle || "Untitled"),
    "",
    blocks.join("\n\n---\n\n"),
    notes ? "\nTHE STUDENT'S OWN REVISION NOTES (use these only to judge notesGaps)" : "",
    notes ? "--- NOTES START ---\n" + notes + "\n--- NOTES END ---" : ""
  ]
    .filter((l) => l !== "")
    .join("\n");

  return { system, user };
}
