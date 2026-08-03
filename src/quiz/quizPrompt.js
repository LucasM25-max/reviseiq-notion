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

/**
 * The optional "where I'm weak" pass after a quiz. Only the missed questions
 * are sent, never the notes again, so this call stays small and cheap.
 *
 * cfg: { pageTitle, score, total, missed: [{ topic, question, correct, chose }] }
 */
export function buildReviewPrompt(cfg) {
  const system = [
    "You are a tutor reading the questions a GCSE student has just got wrong in a multiple-choice quiz on their own notes.",
    "Identify the underlying weaknesses, not the individual questions.",
    "",
    "RULES",
    "- Return between two and four focus areas, fewer if the student only made one kind of mistake.",
    "- Group related mistakes into one focus area. Never return one focus area per question.",
    "- 'area' is a short revision target of two to six words.",
    "- 'why' is one sentence naming the pattern in what they got wrong.",
    "- 'action' is one concrete instruction they can carry out today, in one sentence.",
    "- Be direct and specific. No praise, no filler, no restating the score.",
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
