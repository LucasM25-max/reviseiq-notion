/*
 * AQA GCSE History (8145) exam registry.
 *
 * Covers every option a student can sit across all four assessed sections:
 *   Paper 1 Section A - period studies (4 options)
 *   Paper 1 Section B - wider world depth studies (5 options)
 *   Paper 2 Section A - thematic studies (3 options)
 *   Paper 2 Section B - British depth studies + historic environment (4 options)
 *
 * Question counts, stems, mark allocations and SPaG marks follow AQA's own
 * scheme of assessment. Marks are fixed here rather than left to the model,
 * so a generated paper always totals what the real paper totals.
 *
 * This module is pure data and string building with no DOM access, so the
 * Vercel API routes import it too and the prompt lives in exactly one place.
 */
import { GROUNDING_RULES } from "../quiz/quizPrompt.js";

export const HISTORY_BOARD = "AQA";
export const HISTORY_TITLE_MATCH = /\bhistory\b/i;

/* Minimum words of notes before a test is worth generating. */
export const MIN_NOTE_WORDS = 150;

/* ------------------------------------------------------------------ *
 * Mark scheme shapes
 * ------------------------------------------------------------------ */

const SCHEMES = {
  points4:
    "Two separate 2-mark items (one per required point). For each: 1 mark for a simple " +
    "identification, 2 marks where the point is supported with specific detail.",
  levels4:
    "Two levels: Level 1 (1-2 marks) simple/basic answer with limited support; " +
    "Level 2 (3-4 marks) developed answer with specific support from the material.",
  levels8:
    "Four levels of 2 marks: Level 1 (1-2) basic, Level 2 (3-4) simple, " +
    "Level 3 (5-6) developed, Level 4 (7-8) complex, with AQA-style descriptor wording " +
    "for each level.",
  levels12:
    "Four levels of 3 marks: Level 1 (1-3) basic, Level 2 (4-6) simple, " +
    "Level 3 (7-9) developed, Level 4 (10-12) complex, with AQA-style descriptor wording.",
  levels16:
    "Four levels of 4 marks: Level 1 (1-4) basic, Level 2 (5-8) simple, " +
    "Level 3 (9-12) developed, Level 4 (13-16) complex, with AQA-style descriptor wording. " +
    "A sustained, substantiated judgement is required for Level 4."
};

export const SPAG_SCHEME = [
  "High performance (4 marks): spelling and punctuation consistently accurate; meaning consistently clear; a wide range of specialist terms used aptly.",
  "Intermediate performance (2-3 marks): spelling and punctuation considerable accurate; meaning generally clear; a good range of specialist terms used aptly.",
  "Threshold performance (1 mark): spelling and punctuation reasonably accurate; meaning mostly clear; a limited range of specialist terms used aptly.",
  "0 marks: nothing written, or the answer does not relate to the question, or the level of accuracy is below threshold."
];

/* ------------------------------------------------------------------ *
 * The four components
 * ------------------------------------------------------------------ */

export const COMPONENTS = {
  P1SA: {
    id: "P1SA",
    paper: "Paper 1: Understanding the modern world",
    section: "Section A: Period study",
    label: "Paper 1 Section A \u2014 Period study",
    short: "Paper 1A",
    totalMarks: 40,
    timeLimitMinutes: 60,
    stimulus: "interpretations",
    stimulusCount: 2,
    stimulusNote:
      "Provide exactly two interpretations, labelled Interpretation A and Interpretation B, " +
      "which genuinely disagree about the focus of questions 1-3 (not merely differ in emphasis).",
    questions: [
      { n: 1, marks: 4, spag: 0, ao: "AO4", minutes: 5, scheme: "levels4", uses: ["Interpretation A", "Interpretation B"],
        stem: "How does Interpretation B differ from Interpretation A about {FOCUS}? Explain your answer using Interpretations A and B." },
      { n: 2, marks: 4, spag: 0, ao: "AO4", minutes: 5, scheme: "levels4", uses: ["Interpretation A", "Interpretation B"],
        stem: "Why might the authors of Interpretations A and B have a different interpretation about {FOCUS}? Explain your answer using Interpretations A and B and your contextual knowledge." },
      { n: 3, marks: 8, spag: 0, ao: "AO4", minutes: 10, scheme: "levels8", uses: ["Interpretation A", "Interpretation B"],
        stem: "Which interpretation do you find more convincing about {FOCUS}? Explain your answer using Interpretations A and B and your contextual knowledge." },
      { n: 4, marks: 4, spag: 0, ao: "AO1", minutes: 5, scheme: "points4", uses: [],
        stem: "Describe two {PLURAL_NOUN}." },
      { n: 5, marks: 8, spag: 0, ao: "AO1 + AO2", minutes: 12, scheme: "levels8", uses: [],
        stem: "In what ways were {GROUP_OR_THING} affected by {EVENT_OR_DEVELOPMENT}? Explain your answer." },
      { n: 6, marks: 12, spag: 0, ao: "AO1 + AO2", minutes: 18, scheme: "levels12", uses: [], bullets: 2,
        stem: "Which of the following was the more important reason why {OUTCOME}:\n\u2022 {BULLET_ONE}\n\u2022 {BULLET_TWO}?\nExplain your answer with reference to both bullet points." }
    ]
  },

  P1SB: {
    id: "P1SB",
    paper: "Paper 1: Understanding the modern world",
    section: "Section B: Wider world depth study",
    label: "Paper 1 Section B \u2014 Wider world depth study",
    short: "Paper 1B",
    totalMarks: 44,
    timeLimitMinutes: 60,
    stimulus: "sources",
    stimulusCount: 3,
    stimulusNote:
      "Provide exactly three sources, labelled Source A, Source B and Source C. Source A is used " +
      "by question 1; Sources B and C are used by question 2 and must offer contrasting value to a " +
      "historian (differing viewpoint, provenance or purpose).",
    questions: [
      { n: 1, marks: 4, spag: 0, ao: "AO3", minutes: 5, scheme: "levels4", uses: ["Source A"],
        stem: "Study Source A. Source A is {STANCE} {SUBJECT}. How do you know? Explain your answer using Source A and your contextual knowledge." },
      { n: 2, marks: 12, spag: 0, ao: "AO3", minutes: 15, scheme: "levels12", uses: ["Source B", "Source C"],
        stem: "Study Sources B and C. How useful are Sources B and C to a historian studying {ENQUIRY}? Explain your answer using Sources B and C and your contextual knowledge." },
      { n: 3, marks: 8, spag: 0, ao: "AO1 + AO2", minutes: 12, scheme: "levels8", uses: [],
        stem: "Write an account of how {EVENT} {CONSEQUENCE_CLAUSE}." },
      { n: 4, marks: 16, spag: 4, ao: "AO1 + AO2", minutes: 23, scheme: "levels16", uses: [],
        stem: "\u2018{STATEMENT}.\u2019 How far do you agree with this statement? Explain your answer." }
    ]
  },

  P2SA: {
    id: "P2SA",
    paper: "Paper 2: Shaping the nation",
    section: "Section A: Thematic study",
    label: "Paper 2 Section A \u2014 Thematic study",
    short: "Paper 2A",
    totalMarks: 44,
    timeLimitMinutes: 60,
    stimulus: "sources",
    stimulusCount: 1,
    stimulusNote: "Provide exactly one source, labelled Source A, used by question 1.",
    questions: [
      { n: 1, marks: 8, spag: 0, ao: "AO3", minutes: 12, scheme: "levels8", uses: ["Source A"],
        stem: "How useful is Source A to a historian studying {ENQUIRY}? Explain your answer using Source A and your contextual knowledge." },
      { n: 2, marks: 8, spag: 0, ao: "AO1 + AO2", minutes: 10, scheme: "levels8", uses: [],
        stem: "Explain the significance of {PERSON_EVENT_OR_DEVELOPMENT}." },
      { n: 3, marks: 8, spag: 0, ao: "AO1 + AO2", minutes: 10, scheme: "levels8", uses: [],
        stem: "Explain two ways in which {THING_ONE} and {THING_TWO} were {SIMILAR_OR_DIFFERENT}." },
      { n: 4, marks: 16, spag: 4, ao: "AO1 + AO2", minutes: 23, scheme: "levels16", uses: [],
        stem: "\u2018{FACTOR} was the main factor in {CHANGE_OVER_TIME}.\u2019 How far do you agree with this statement? Explain your answer with reference to {FACTOR} and other factors." }
    ]
  },

  P2SB: {
    id: "P2SB",
    paper: "Paper 2: Shaping the nation",
    section: "Section B: British depth study including the historic environment",
    label: "Paper 2 Section B \u2014 British depth study",
    short: "Paper 2B",
    totalMarks: 40,
    timeLimitMinutes: 60,
    stimulus: "interpretations",
    stimulusCount: 1,
    stimulusNote:
      "Provide exactly one interpretation, labelled Interpretation A, used by question 1. It must " +
      "take a clear, arguable view that a student can weigh against their own knowledge.",
    questions: [
      { n: 1, marks: 8, spag: 0, ao: "AO4", minutes: 12, scheme: "levels8", uses: ["Interpretation A"],
        stem: "How convincing is Interpretation A about {FOCUS}? Explain your answer using Interpretation A and your contextual knowledge." },
      { n: 2, marks: 8, spag: 0, ao: "AO1 + AO2", minutes: 10, scheme: "levels8", uses: [],
        stem: "Explain what was important about {PERSON_EVENT_OR_DEVELOPMENT}." },
      { n: 3, marks: 8, spag: 0, ao: "AO1 + AO2", minutes: 12, scheme: "levels8", uses: [],
        stem: "Write an account of {NARRATIVE_FOCUS}." },
      { n: 4, marks: 16, spag: 0, ao: "AO1 + AO2", minutes: 23, scheme: "levels16", uses: [], site: true,
        stem: "\u2018{STATEMENT}.\u2019 How far does a study of {SITE} support this statement? Explain your answer. You should refer to {SITE} and your contextual knowledge." }
    ]
  }
};

export const COMPONENT_ORDER = ["P1SA", "P1SB", "P2SA", "P2SB"];

/* ------------------------------------------------------------------ *
 * Every option on the specification
 * ------------------------------------------------------------------ */

export const OPTIONS = [
  /* ---- Paper 1 Section A: period studies ---- */
  {
    id: "p1sa-america-1840",
    componentId: "P1SA",
    label: "America, 1840\u20131895: Expansion and consolidation",
    parts: [
      "Expansion: opportunities and challenges, 1840\u20131865",
      "Conflict across America, 1850\u20131865",
      "Consolidation: forging the nation, 1865\u20131895"
    ],
    keywords: ["america 1840", "expansion and consolidation", "manifest destiny", "oregon trail", "gold rush", "plains indians", "homestead", "transcontinental", "little bighorn", "wounded knee", "american civil war", "reconstruction", "cattle industry"]
  },
  {
    id: "p1sa-germany",
    componentId: "P1SA",
    label: "Germany, 1890\u20131945: Democracy and dictatorship",
    parts: [
      "Germany and the growth of democracy",
      "Germany and the Depression",
      "The experiences of Germans under the Nazis"
    ],
    keywords: ["germany 1890", "democracy and dictatorship", "kaiser wilhelm", "weimar", "hyperinflation", "munich putsch", "stresemann", "hitler", "nazi", "reichstag fire", "night of the long knives", "hitler youth", "kristallnacht", "third reich"]
  },
  {
    id: "p1sa-russia",
    componentId: "P1SA",
    label: "Russia, 1894\u20131945: Tsardom and communism",
    parts: [
      "The end of Tsardom",
      "Lenin's new society",
      "Stalin's USSR"
    ],
    keywords: ["russia 1894", "tsardom and communism", "nicholas ii", "tsar", "1905 revolution", "rasputin", "february revolution", "october revolution", "bolshevik", "lenin", "civil war reds whites", "new economic policy", "stalin", "five year plan", "collectivisation", "great terror", "purges"]
  },
  {
    id: "p1sa-america-1920",
    componentId: "P1SA",
    label: "America, 1920\u20131973: Opportunity and inequality",
    parts: [
      "American people and the \u2018boom\u2019",
      "Bust \u2013 Americans' experiences of the Depression and New Deal",
      "Post-war America"
    ],
    keywords: ["america 1920", "opportunity and inequality", "roaring twenties", "prohibition", "ku klux klan", "wall street crash", "great depression", "new deal", "roosevelt", "mccarthyism", "civil rights movement", "martin luther king", "black power", "feminist movement", "jim crow"]
  },

  /* ---- Paper 1 Section B: wider world depth studies ---- */
  {
    id: "p1sb-ww1",
    componentId: "P1SB",
    label: "Conflict and tension: The First World War, 1894\u20131918",
    parts: ["The causes of the First World War", "The First World War: stalemate", "Ending the war"],
    keywords: ["first world war", "ww1", "1894\u20131918", "alliance system", "arms race", "moroccan crisis", "balkans", "sarajevo", "schlieffen plan", "trench", "stalemate", "western front", "gallipoli", "jutland", "somme", "verdun", "passchendaele", "ludendorff", "armistice"]
  },
  {
    id: "p1sb-interwar",
    componentId: "P1SB",
    label: "Conflict and tension: The inter-war years, 1918\u20131939",
    parts: ["Peacemaking", "The League of Nations and international peace", "The origins and outbreak of the Second World War"],
    keywords: ["inter-war", "interwar", "1918\u20131939", "treaty of versailles", "paris peace", "big three", "league of nations", "abyssinia", "manchuria", "corfu", "disarmament", "appeasement", "rhineland", "anschluss", "sudetenland", "munich agreement", "nazi-soviet pact"]
  },
  {
    id: "p1sb-eastwest",
    componentId: "P1SB",
    label: "Conflict and tension between East and West, 1945\u20131972",
    parts: ["The origins of the Cold War", "The development of the Cold War", "Transformation of the Cold War"],
    keywords: ["east and west", "cold war", "1945\u20131972", "yalta", "potsdam", "iron curtain", "truman doctrine", "marshall plan", "berlin blockade", "nato", "warsaw pact", "hungarian uprising", "berlin wall", "cuban missile crisis", "prague spring", "detente"]
  },
  {
    id: "p1sb-asia",
    componentId: "P1SB",
    label: "Conflict and tension in Asia, 1950\u20131975",
    parts: ["Conflict in Korea", "Escalation of conflict in Vietnam", "The ending of conflict in Vietnam"],
    keywords: ["asia 1950", "korean war", "38th parallel", "macarthur", "inchon", "vietnam", "dien bien phu", "viet cong", "gulf of tonkin", "tet offensive", "my lai", "search and destroy", "agent orange", "vietnamisation", "paris peace accords"]
  },
  {
    id: "p1sb-gulf",
    componentId: "P1SB",
    label: "Conflict and tension in the Gulf and Afghanistan, 1990\u20132009",
    parts: ["Tension in the Gulf", "War in Iraq and its impact", "Conflict in Afghanistan and its impact"],
    keywords: ["gulf and afghanistan", "1990\u20132009", "saddam hussein", "kuwait", "operation desert storm", "weapons of mass destruction", "iraq war", "9/11", "al-qaeda", "taliban", "operation enduring freedom", "helmand", "insurgency"]
  },

  /* ---- Paper 2 Section A: thematic studies ---- */
  {
    id: "p2sa-health",
    componentId: "P2SA",
    label: "Britain: Health and the people: c1000 to the present day",
    parts: ["Medicine stands still", "The beginnings of change", "A revolution in medicine", "Modern medicine"],
    keywords: ["health and the people", "medicine", "hippocrates", "galen", "four humours", "black death", "vesalius", "harvey", "jenner", "vaccination", "germ theory", "pasteur", "koch", "nightingale", "anaesthetic", "antiseptic", "lister", "penicillin", "fleming", "nhs", "public health act"]
  },
  {
    id: "p2sa-power",
    componentId: "P2SA",
    label: "Britain: Power and the people: c1170 to the present day",
    parts: ["Challenging authority and feudalism", "Challenging royal authority", "Reform and reformers", "Equality and rights"],
    keywords: ["power and the people", "magna carta", "simon de montfort", "peasants revolt", "wat tyler", "english civil war", "american revolution", "peterloo", "great reform act", "chartist", "anti-slavery", "trade union", "tolpuddle", "suffragette", "suffragist", "general strike", "bristol bus boycott", "equal pay"]
  },
  {
    id: "p2sa-migration",
    componentId: "P2SA",
    label: "Britain: Migration, empires and the people: c790 to the present day",
    parts: ["Conquered and conquerors", "Looking west", "Expansion and empire", "Britain in the 20th century"],
    keywords: ["migration, empires", "migration empires and the people", "viking", "danelaw", "norman conquest", "jewish migration", "huguenot", "elizabethan explorers", "east india company", "transatlantic slave trade", "abolition", "british empire", "irish migration", "windrush", "commonwealth immigration", "decolonisation", "partition of india"]
  },

  /* ---- Paper 2 Section B: British depth studies ---- */
  {
    id: "p2sb-norman",
    componentId: "P2SB",
    label: "Norman England, c1066\u2013c1100",
    parts: ["The Normans: conquest and control", "Life under the Normans", "The Norman Church and monasticism", "The historic environment of Norman England"],
    keywords: ["norman england", "1066", "harold godwinson", "stamford bridge", "battle of hastings", "harrying of the north", "motte and bailey", "domesday", "feudal system", "william the conqueror", "lanfranc", "monasticism"],
    siteRequired: true
  },
  {
    id: "p2sb-edward",
    componentId: "P2SB",
    label: "Medieval England \u2013 the reign of Edward I, 1272\u20131307",
    parts: ["Government, the rise of parliament and prosperity", "Life in medieval towns and villages", "Medieval religion and the Church", "The historic environment of medieval England"],
    keywords: ["edward i", "edward the first", "1272", "model parliament", "medieval england", "welsh wars", "conquest of wales", "scotland william wallace", "expulsion of the jews", "medieval town", "medieval church"],
    siteRequired: true
  },
  {
    id: "p2sb-elizabethan",
    componentId: "P2SB",
    label: "Elizabethan England, c1568\u2013c1603",
    parts: ["Elizabeth's court and Parliament", "Life in Elizabethan times", "Troubles at home and abroad", "The historic environment of Elizabethan England"],
    keywords: ["elizabethan england", "elizabeth i", "1568", "privy council", "mary queen of scots", "spanish armada", "drake", "raleigh", "poor law", "vagabond", "globe theatre", "catholic plots", "babington", "puritan"],
    siteRequired: true
  },
  {
    id: "p2sb-restoration",
    componentId: "P2SB",
    label: "Restoration England, 1660\u20131685",
    parts: ["Crown, Parliament and plots", "Life in Restoration England", "Land, trade and war", "The historic environment of Restoration England"],
    keywords: ["restoration england", "charles ii", "1660", "cavalier parliament", "clarendon code", "popish plot", "exclusion crisis", "great plague 1665", "great fire of london", "royal society", "samuel pepys", "anglo-dutch war"],
    siteRequired: true
  }
];

const OPTION_MAP = {};
OPTIONS.forEach((o) => {
  OPTION_MAP[o.id] = o;
});

export function optionById(id) {
  return OPTION_MAP[id] || null;
}

export function componentById(id) {
  return COMPONENTS[id] || null;
}

export function optionsForComponent(componentId) {
  return OPTIONS.filter((o) => o.componentId === componentId);
}

/* ------------------------------------------------------------------ *
 * Inference: work out which option a page belongs to from its titles
 * ------------------------------------------------------------------ */

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/\s+/g, " ");
}

/**
 * Score every option against a list of strings (page title, ancestor titles,
 * and optionally the notes themselves) and return the best match.
 * Returns null when nothing scores, so the caller can ask the student.
 */
export function inferOption(texts) {
  const hay = norm(Array.isArray(texts) ? texts.join(" \u00b7 ") : texts);
  if (!hay.trim()) return null;

  let best = null;
  let bestScore = 0;
  OPTIONS.forEach((opt) => {
    let score = 0;
    if (hay.indexOf(norm(opt.label)) > -1) score += 12;
    opt.keywords.forEach((kw) => {
      const k = norm(kw);
      if (!k) return;
      if (hay.indexOf(k) > -1) score += k.indexOf(" ") > -1 ? 3 : 2;
    });
    (opt.parts || []).forEach((part) => {
      if (hay.indexOf(norm(part)) > -1) score += 4;
    });
    if (score > bestScore) {
      bestScore = score;
      best = opt;
    }
  });

  // One stray keyword is not evidence. Require a real signal.
  return bestScore >= 4 ? { option: best, score: bestScore } : null;
}

/* ------------------------------------------------------------------ *
 * Prompt building
 * ------------------------------------------------------------------ */

function questionSpecText(component, site) {
  return component.questions
    .map((q) => {
      const stem = q.stem.replace(/\{SITE\}/g, site || "the specified historic environment site");
      const spag = q.spag ? " plus " + q.spag + " SPaG marks (" + (q.marks + q.spag) + " in total)" : "";
      return (
        "Question " + q.n + " \u2014 " + q.marks + " marks" + spag + " (" + q.ao + "), about " + q.minutes + " minutes.\n" +
        "  Stem template: " + stem.replace(/\n/g, " ") + "\n" +
        (q.uses.length ? "  Uses: " + q.uses.join(" and ") + "\n" : "") +
        "  Mark scheme shape: " + SCHEMES[q.scheme]
      );
    })
    .join("\n\n");
}

export function paperTotals(component) {
  const marks = component.questions.reduce((s, q) => s + q.marks + q.spag, 0);
  return { marks, minutes: component.timeLimitMinutes };
}

/**
 * The generation prompt. Everything factual about the paper's shape comes from
 * the registry above; the model only chooses the historical focus, writes the
 * stimulus material and writes the mark scheme.
 */
export function buildGenerationPrompt(opts) {
  const component = COMPONENTS[opts.componentId];
  const option = OPTION_MAP[opts.optionId];
  const site = opts.site || "";
  const totals = paperTotals(component);

  const system =
    "You are an experienced AQA GCSE History (8145) senior examiner writing a mock exam paper.\n" +
    "You write questions in the exact register, phrasing and format of real AQA papers, and mark " +
    "schemes in the exact format of real AQA mark schemes.\n\n" +
    "YOU ARE WRITING FOR\n" +
    component.paper + "\n" +
    component.section + "\n" +
    "Option: " + option.label + "\n" +
    (option.parts ? "Specified content parts: " + option.parts.join("; ") + "\n" : "") +
    (site ? "Historic environment specified site: " + site + "\n" : "") +
    "Total marks: " + totals.marks + ". Time allowed: " + totals.minutes + " minutes.\n\n" +
    "QUESTION STRUCTURE \u2014 reproduce exactly, in this order, with these marks:\n\n" +
    questionSpecText(component, site) + "\n\n" +
    "STIMULUS MATERIAL\n" + component.stimulusNote + "\n\n" +
    "RULES\n" +
    "1. Base every question ONLY on subject matter that appears in the student's notes below. Do not " +
    "examine content the notes do not cover. If the notes are thin in one area, narrow that question's " +
    "focus rather than inventing new topic areas.\n" +
    "2. Reproduce AQA's question stems, substituting only the historical focus for the {PLACEHOLDERS}. " +
    "No placeholder may survive into the final question text.\n" +
    "3. Sources and interpretations must be written by you in period-appropriate style, 40\u201390 words " +
    "each, each with a provenance line in AQA's format (for example \u2018Source A: From a speech by a " +
    "government minister, 1923.\u2019). They must be plausible and consistent with the historical record, " +
    "but you must NOT present them as genuine archival quotations.\n" +
    "4. Write a mark scheme for every question in AQA's levels-of-response format, using the mark scheme " +
    "shape given for that question. Each level needs AQA-style descriptor wording. Each question needs an " +
    "indicative content list of 6\u201312 specific creditworthy points drawn from the notes. Indicative " +
    "content is guidance, not prescription.\n" +
    "5. Where SPaG marks apply, they are marked separately against the standard scheme and are not part of " +
    "the levels.\n" +
    "6. British English spelling. Plain text only in question stems \u2014 no markdown, no bold, no headings.\n" +
    "7. Do not include the mark allocation inside the stem text; it is returned as a separate field.\n" +
    "8. No preamble and no commentary. Return only the JSON object.";

  const user =
    "STUDENT'S NOTES\n" +
    "Page: " + (opts.pageTitle || "Untitled") + "\n" +
    (opts.includedPages && opts.includedPages.length > 1
      ? "Sections included: " + opts.includedPages.join(" | ") + "\n"
      : "") +
    "\n" +
    opts.notes;

  return { system, user };
}

/**
 * The marking prompt. The paper and its mark scheme are echoed back so the
 * examiner marks against the same scheme the student was set.
 */
export function buildMarkingPrompt(opts) {
  const component = COMPONENTS[opts.componentId];
  const option = OPTION_MAP[opts.optionId];

  const notes = String(opts.notes || "").slice(0, 18000);

  const system =
    "You are an AQA GCSE History (8145) examiner marking a student's script against the mark scheme " +
    "supplied. The paper is " + component.paper + ", " + component.section + " (" + option.label + ").\n\n" +
    "HOW TO MARK\n" +
    "- Determine the LEVEL first from the descriptors, then place the mark within that level according to " +
    "how fully the descriptor is met.\n" +
    "- Mark positively: reward what is there. Do not deduct for omissions except by awarding a lower level.\n" +
    "- Indicative content is NOT a checklist. Credit any valid, well-supported point, including points not " +
    "listed.\n" +
    "- A blank or wholly irrelevant answer scores 0.\n" +
    "- Length is not merit. A short, precise answer can reach the top level.\n" +
    "- Be honest and precise. Do not inflate marks to be encouraging: a generous mark is a disservice to a " +
    "student before a real exam.\n" +
    "- Where SPaG marks apply, mark them separately against this scheme:\n  " +
    SPAG_SCHEME.join("\n  ") + "\n\n" +
    GROUNDING_RULES + "\n\n" +
    "FOR EACH QUESTION RETURN\n" +
    "- the mark awarded and the level;\n" +
    "- one sentence in examiner register justifying the level, quoting at most twelve words of what they " +
    "actually wrote as the evidence for it;\n" +
    "- what the student did well, quoting the words that earned the credit. If nothing merits it, return " +
    "nothing rather than inventing praise;\n" +
    "- the specific creditworthy points they missed, each stated as the actual historical point " +
    "(for example \u2018the role of the Dawes Plan in stabilising the currency\u2019), never as vague advice " +
    "like \u2018add more detail\u2019;\n" +
    "- nextBand: the single change that would have moved this answer up one level, named precisely, " +
    "for example \u2018tie the second paragraph back to the question by explaining why rearmament mattered " +
    "more than propaganda\u2019. One sentence. Omit it only when the answer is already at the top level.\n\n" +
    "THEN RETURN AN OVERALL VERDICT\n" +
    "- total mark and total available;\n" +
    "- at most 2 strengths, each naming the skill and the question that evidenced it. Return none rather " +
    "than padding;\n" +
    "- at most 3 focus areas, two is usually right. Each names the skill, the specific content or wording " +
    "that cost the marks, and one concrete action for next time;\n" +
    "- missedContent: the specific historical points absent across the whole script, so the student knows " +
    "exactly what to revise;\n" +
    (notes
      ? "- notesGaps: points the mark scheme expected which are genuinely absent from the student's own " +
        "notes, which are supplied below. Quote the line of their notes that comes closest, or say that " +
        "the notes do not touch it at all. Never guess: if the notes cover it and the student simply did " +
        "not use it, that belongs in focus areas instead.\n\n"
      : "- notesGaps: points the mark scheme expected which the student's own notes do not appear to contain.\n\n") +
    "Do not award or mention a grade: grade boundaries move every year and a fabricated grade would " +
    "mislead. Report marks only. British English. Return only the JSON object.";

  const answers = opts.paper.questions.map((q) => {
    const a = opts.answers[String(q.number)] || "";
    return (
      "QUESTION " + q.number + " [" + q.marks + " marks" + (q.spagMarks ? " + " + q.spagMarks + " SPaG" : "") + "]\n" +
      q.stem + "\n\n" +
      "STUDENT'S ANSWER (" + countWords(a) + " words):\n" +
      (a.trim() ? a : "[No answer written]")
    );
  });

  const user =
    "PAPER AND MARK SCHEME\n" +
    JSON.stringify(opts.paper) + "\n\n" +
    "STUDENT'S SCRIPT\n" +
    answers.join("\n\n---\n\n") + "\n\n" +
    "TIME USED: " + formatDuration(opts.timeUsedSeconds) + " of " + component.timeLimitMinutes + " minutes." +
    (notes
      ? "\n\nTHE STUDENT'S OWN REVISION NOTES ON THIS TOPIC (use these only to judge notesGaps)\n" +
        "--- NOTES START ---\n" + notes + "\n--- NOTES END ---"
      : "");

  return { system, user };
}

export function countWords(text) {
  const t = String(text || "").trim();
  return t ? t.split(/\s+/).length : 0;
}

export function formatDuration(seconds) {
  const s = Math.max(0, Math.round(seconds || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m + "m " + (r < 10 ? "0" : "") + r + "s";
}
