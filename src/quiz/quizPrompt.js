/*
 * Shared definition of a ReviseIQ quiz.
 *
 * This module is pure data and string building with no DOM access, so the
 * browser imports it for counts and labels and the Vercel routes import it for
 * the prompt. The difficulty rules therefore live in exactly one place.
 */

/* Below this, a page has too little in it to make a fair quiz. */
export const MIN_QUIZ_WORDS = 80;

/* Hard ceiling on how much of a page is sent to the model. */
export const MAX_NOTE_CHARS = 45000;

export const COUNT_CHOICES = [10, 15, 20];
export const MIN_COUNT = 8;
export const MAX_COUNT = 20;

/* Longer notes deserve a longer quiz, but never more than twenty questions. */
export function autoQuestionCount(wordCount) {
  const w = Number(wordCount) || 0;
  if (w < 600) return 10;
  if (w <= 1500) return 15;
  return 20;
}

export function clampCount(n, wordCount) {
  const asked = Number(n);
  if (!asked || Number.isNaN(asked)) return autoQuestionCount(wordCount);
  return Math.max(MIN_COUNT, Math.min(MAX_COUNT, Math.round(asked)));
}

export const OPTION_LETTERS = ["A", "B", "C", "D"];

/**
 * cfg: { count, pageTitle, includedPages: [titles], notes }
 */
export function buildQuizPrompt(cfg) {
  const system = [
    "You are a demanding examiner writing a hard multiple-choice quiz for a GCSE student, using only the revision notes they give you.",
    "",
    "ABSOLUTE RULES",
    "1. Every question must be answerable from the notes alone. Never test a fact that is not in the notes, and never require outside knowledge.",
    "2. Exactly one option is correct. The other three must be wrong on the evidence of the notes, not merely less good.",
    "3. Write exactly four options per question, each a plausible answer of roughly the same length and grammatical form.",
    "4. Never write 'all of the above', 'none of the above', 'both A and B', or any option that refers to other options.",
    "5. Never use absolutes such as 'always' or 'never' as a giveaway, and never make the correct option the longest or most detailed one.",
    "6. Do not phrase questions as 'according to the notes', 'according to the text', or 'in this document'. Ask the question directly, as an exam would.",
    "",
    "DIFFICULTY",
    "This quiz must be hard. A student who has skim-read the notes should score badly; one who understands them should score well.",
    "- Build distractors out of near-miss material in the notes: the adjacent date, the other named person, the right idea attached to the wrong cause, the correct term applied to the wrong event, a real consequence of a different event.",
    "- At least half of the questions must require inference, comparison, cause and consequence, significance, or chronology, rather than the recall of a single lifted fact.",
    "- Avoid questions whose answer is obvious from the wording of the question itself.",
    "- Do not test two questions on the same fact, and spread the questions across the whole of the notes rather than clustering at the start.",
    "",
    "FOR EACH QUESTION YOU MUST RETURN",
    "- question: the question itself, one sentence where possible.",
    "- options: four answer strings, in a deliberately mixed order (do not always put the correct answer in the same place).",
    "- correctIndex: the zero-based index of the correct option.",
    "- explanation: one or two sentences saying why the correct answer is correct, grounded in the notes.",
    "- distractorNotes: one short line for EACH option in the same order as options, saying why that option is wrong (write 'Correct.' for the correct one).",
    "- topic: a two to five word label for the concept being tested, e.g. 'Causes of the Blitz' or 'Enzyme specificity'. These labels are reused as revision targets, so keep them consistent and specific.",
    "",
    "Return JSON only, matching the schema exactly."
  ].join("\n");

  const pages = (cfg.includedPages || []).filter(Boolean);
  const user = [
    "Write " + cfg.count + " hard multiple-choice questions on the notes below.",
    "",
    "Page being revised: " + (cfg.pageTitle || "Untitled"),
    pages.length > 1 ? "Pages included: " + pages.join("; ") : "",
    "",
    "Give the quiz a short title naming the topic (no more than eight words).",
    "Number the questions from 1 to " + cfg.count + ".",
    "",
    "--- NOTES START ---",
    cfg.notes,
    "--- NOTES END ---"
  ]
    .filter((l) => l !== "")
    .join("\n");

  return { system, user };
}

/* Feedback that would be true of any student answering any question is worth
 * nothing, so both the review pass and the markers are told to refuse it. */
export const BANNED_FEEDBACK = [
  "add more detail",
  "more detail",
  "more evidence",
  "use more evidence",
  "develop your points",
  "develop your analysis",
  "improve your structure",
  "structure your answer",
  "revise this topic",
  "read your notes",
  "learn the facts",
  "be more specific",
  "show more knowledge",
  "practise more"
];

export const GROUNDING_RULES = [
  "GROUNDING - THIS IS THE RULE THAT MATTERS MOST",
  "Every point you make must be tied to something real. Each one must contain either",
  "  (a) a quotation of at most twelve words taken from what the student actually wrote, or",
  "  (b) an explicit statement of what they never mentioned, naming it.",
  "and it must name the specific content at stake: a person, place, date, figure, term, cause or consequence.",
  "",
  "Before you return anything, test every point against this question:",
  "  'Would this sentence be true of any student answering any question on this subject?'",
  "If the answer is yes, the point is worthless. Rewrite it so that it could only have been written",
  "about this answer, or drop it entirely. Returning two sharp points is far better than four vague ones.",
  "",
  "These phrases are banned unless they are followed by the specific content in question:",
  "  " + BANNED_FEEDBACK.join("; ") + ".",
  "Never pad, never repeat the score back, never praise for its own sake."
].join("\n");

/**
 * The optional "where I'm weak" pass after a quiz.
 *
 * cfg: { pageTitle, score, total, missed: [{ topic, question, correct, chose }] }
 */
export function buildReviewPrompt(cfg) {
  const system = [
    "You are a tutor reading the questions a GCSE student has just got wrong in a multiple-choice quiz on their own notes.",
    "Name the underlying weaknesses, not the individual questions.",
    "",
    GROUNDING_RULES,
    "",
    "RULES",
    "- Return at most three focus areas. Two is usually right. One is correct when they made a single kind of mistake.",
    "- Group related mistakes into one focus area. Never return one focus area per question.",
    "- 'area' is a short revision target of two to six words, naming real content, e.g. 'Causes of the 1929 crash'.",
    "- 'why' is one sentence naming the pattern AND the specific facts they got wrong, e.g. 'You chose 1935 twice",
    "  where the notes give 1933, so the order of the early Nazi laws is not yet secure.'",
    "- 'action' is one instruction they can carry out today, naming exactly what to learn or do.",
    "  'Learn the four Enabling Act clauses in order' is good. 'Revise Nazi Germany' is banned.",
    "",
    "Return JSON only, matching the schema exactly."
  ].join("\n");

  const lines = (cfg.missed || []).map((m, i) => {
    return (
      i +
      1 +
      ". [" +
      (m.topic || "") +
      "] " +
      (m.question || "") +
      "\n   Correct answer: " +
      (m.correct || "") +
      "\n   They chose: " +
      (m.chose || "(no answer)")
    );
  });

  const user = [
    "Topic: " + (cfg.pageTitle || "Untitled"),
    "Score: " + cfg.score + " out of " + cfg.total + ".",
    "",
    "Questions answered incorrectly:",
    lines.join("\n")
  ].join("\n");

  return { system, user };
}

/* Card fronts shaped like the question that caused them, rather than like a
 * fact worth knowing. Checked on the server as well as asked for here. */
export const BANNED_CARD_PATTERNS = [
  "differences between",
  "difference between",
  "primary difference",
  "key difference",
  "compare and contrast",
  "in what ways",
  "to what extent",
  "this question",
  "the above",
  "according to the notes",
  "according to the text",
  "option a",
  "option b",
  "which of the following"
];

export const MAX_CARDS_PER_RUN = 20;
export const MAX_CARD_NOTE_CHARS = 9000;

/**
 * Flashcards written from what the student got wrong, but grounded in their
 * own notes rather than in the wording of the question.
 *
 * cfg: {
 *   source: "quiz" | "test",
 *   pageTitle, subjectTitle,
 *   misses: [{ topic, question, correct, chose, explanation, detail }],
 *   notes: the relevant passages of their notes,
 *   existing: [fronts of cards they already have]
 * }
 */
export function buildFlashcardPrompt(cfg) {
  const fromExam = cfg.source === "test";
  const hasNotes = !!(cfg.notes && cfg.notes.trim());

  const system = [
    "You are a tutor writing revision flashcards for a GCSE student.",
    "You are given the mistakes they have just made",
    fromExam ? "in a marked exam paper" : "in a multiple-choice quiz on their own notes",
    "and the passages of their revision notes that those mistakes touch.",
    "",
    "WORK IN TWO STEPS",
    "1. For each mistake, work out the piece of knowledge that was actually missing.",
    "   Ignore how the question was phrased. The question is only evidence of a gap; it is not the gap.",
    "2. Write cards about that knowledge, taking the wording and the substance from the NOTES.",
    "",
    "GROUNDING",
    hasNotes
      ? "- Every answer must be verifiable against the notes supplied below. If a fact is not in the notes, do not write a card about it."
      : "- No notes were supplied, so write only cards whose answers are contained in the mistake information itself.",
    hasNotes
      ? "- 'evidence' must be a quotation of at most fifteen words, copied exactly from the notes, that proves the answer. Never invent it."
      : "- 'evidence' may be left as an empty string when no notes were supplied.",
    "- Never test something the student was not expected to know from these notes.",
    "",
    "SHAPE OF THE CARDS - THIS IS WHERE MOST ATTEMPTS GO WRONG",
    "- One fact per card. Do not bundle several ideas into one card to save space.",
    "- A single gap should usually become TWO to FOUR cards, not one. For a gap about why a colony was founded, write",
    "  a card for the count ('What were the three reasons the Jamestown colony was founded?'), a card for each reason",
    "  that carries detail of its own, and where the notes support it a card on the consequence or significance.",
    "- Where the notes enumerate something, the card must enumerate it too, and must state how many there are.",
    "- Fronts must be short, concrete and answerable from memory: five to sixteen words.",
    "- Fronts must never be shaped like the question that exposed the gap, and must never be comparative",
    "  unless the notes themselves set out an explicit comparison.",
    "- These phrasings are banned in a front: " + BANNED_CARD_PATTERNS.join("; ") + ".",
    "- 'back' is the answer only: names, dates, figures, causes, consequences, key terms. One to three short",
    "  sentences, or up to four brief clauses separated by '; '. No preamble, no 'the notes say'.",
    "- 'topic' is two to five words naming the content, reused across runs, so keep the labels consistent.",
    "- 'kind' is \"knowledge\" for a fact or concept, or \"skill\" for exam technique such as using evidence,",
    "  explaining significance, or structuring an answer. Write a skill card only when the mistakes really show",
    "  a technique problem, and never more than two.",
    "",
    "HOW MANY",
    "- Write up to " + MAX_CARDS_PER_RUN + " cards. Cover every distinct gap; do not pad a thin gap out.",
    "- Do not write a card that duplicates one they already have, listed below. Cover a different angle instead.",
    "",
    "Never mention the quiz, the paper, the marks, or that they got anything wrong.",
    "Plain text only. No markdown, no numbering.",
    "",
    "Return JSON only, matching the schema exactly."
  ]
    .filter(Boolean)
    .join("\n");

  const lines = (cfg.misses || []).map((m, i) => {
    const parts = [i + 1 + ". [" + (m.topic || "General") + "]"];
    if (m.question) parts.push("Question: " + m.question);
    if (m.correct) parts.push("Correct answer: " + m.correct);
    if (m.chose) parts.push("They answered: " + m.chose);
    if (m.explanation) parts.push("Note: " + m.explanation);
    if (m.detail) parts.push("Detail: " + m.detail);
    return parts.join("\n   ");
  });

  const existing = (cfg.existing || []).filter(Boolean).slice(0, 60);

  const user = [
    "Subject: " + (cfg.subjectTitle || "Unknown"),
    "Topic page: " + (cfg.pageTitle || "Untitled"),
    "",
    fromExam ? "Points and skills the examiner marked them down on:" : "What they got wrong:",
    lines.join("\n"),
    "",
    existing.length ? "Cards they already have (do not repeat these):" : "",
    existing.length ? existing.map((f) => "- " + f).join("\n") : "",
    "",
    hasNotes ? "--- THEIR NOTES ON THIS MATERIAL START ---" : "",
    hasNotes ? cfg.notes : "",
    hasNotes ? "--- THEIR NOTES END ---" : ""
  ]
    .filter((l) => l !== "")
    .join("\n");

  return { system, user };
}
