/*
 * POST /api/test/generate
 *
 * Builds an AQA-style mock paper from a student's notes. The Gemini key never
 * reaches the browser: it lives in the GEMINI_API_KEY environment variable on
 * Vercel and is used only here.
 */
import { COMPONENTS, optionById, buildGenerationPrompt, paperTotals } from "../../src/exam/aqaHistory.js";

// Gemini is tried in this order. A model that errors, gets rate limited, is
// overloaded, or hands back something unreadable simply drops through to the
// next one; the student only ever sees an error if all three fail.
export const MODEL_CHAIN = ["gemini-flash-latest", "gemini-pro-latest", "gemini-flash-lite-latest"];

function endpointFor(model) {
  return "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent";
}

let lastModel = MODEL_CHAIN[0];

/** The model that actually produced the most recent successful answer. */
export function lastModelUsed() {
  return lastModel;
}
const MAX_NOTE_CHARS = 45000;

const PAPER_SCHEMA = {
  type: "OBJECT",
  properties: {
    focusSummary: { type: "STRING" },
    sources: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          label: { type: "STRING" },
          provenance: { type: "STRING" },
          body: { type: "STRING" }
        },
        required: ["label", "provenance", "body"]
      }
    },
    questions: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          number: { type: "INTEGER" },
          stem: { type: "STRING" },
          usesSources: { type: "ARRAY", items: { type: "STRING" } },
          markScheme: {
            type: "OBJECT",
            properties: {
              levels: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    level: { type: "STRING" },
                    markRange: { type: "STRING" },
                    descriptor: { type: "STRING" }
                  },
                  required: ["level", "markRange", "descriptor"]
                }
              },
              indicativeContent: { type: "ARRAY", items: { type: "STRING" } }
            },
            required: ["levels", "indicativeContent"]
          }
        },
        required: ["number", "stem", "markScheme"]
      }
    }
  },
  required: ["sources", "questions"]
};

function send(res, status, payload) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.status(status).send(JSON.stringify(payload));
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body);
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function callModel(model, system, user, schema, apiKey) {
  const res = await fetch(endpointFor(model) + "?key=" + encodeURIComponent(apiKey), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: {
        temperature: 0.6,
        topP: 0.95,
        maxOutputTokens: 16384,
        responseMimeType: "application/json",
        responseSchema: schema
      }
    })
  });

  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 400);
    try {
      const j = JSON.parse(text);
      if (j.error && j.error.message) detail = j.error.message;
    } catch (e) {
      /* keep raw text */
    }
    const err = new Error(detail);
    err.status = res.status === 429 ? 429 : 502;
    throw err;
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    const err = new Error("Gemini returned a response that could not be read.");
    err.status = 502;
    throw err;
  }

  const cand = data.candidates && data.candidates[0];
  if (!cand) {
    const err = new Error("Gemini returned no content. It may have been blocked by a safety filter.");
    err.status = 502;
    throw err;
  }
  const parts = (cand.content && cand.content.parts) || [];
  const joined = parts.map((p) => p.text || "").join("");
  try {
    return JSON.parse(joined);
  } catch (e) {
    const err = new Error("Gemini's answer was not valid JSON.");
    err.status = 502;
    throw err;
  }
}

/**
 * Ask Gemini for JSON, falling back down MODEL_CHAIN on any failure.
 * Throws only when every model in the chain has failed.
 */
export async function callGemini(system, user, schema, apiKey) {
  let lastError = null;

  for (const model of MODEL_CHAIN) {
    try {
      const out = await callModel(model, system, user, schema, apiKey);
      lastModel = model;
      return out;
    } catch (e) {
      lastError = e;
      console.warn("[gemini] " + model + " failed: " + e.message);
    }
  }

  const err = new Error(
    "all three Gemini models failed (flash, pro, then flash-lite). Last error: " +
      ((lastError && lastError.message) || "no response")
  );
  err.status = lastError && lastError.status === 429 ? 429 : 502;
  err.allModelsFailed = true;
  throw err;
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return send(res, 204, {});
  if (req.method !== "POST") return send(res, 405, { error: "Use POST." });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return send(res, 500, {
      error: "No Gemini API key is configured. Add GEMINI_API_KEY in your Vercel project settings and redeploy."
    });
  }

  let body;
  try {
    body = await readBody(req);
  } catch (e) {
    return send(res, 400, { error: "Could not read the request." });
  }

  const component = COMPONENTS[body.componentId];
  const option = optionById(body.optionId);
  if (!component || !option || option.componentId !== component.id) {
    return send(res, 400, { error: "Unknown exam component or option." });
  }

  const notes = String(body.notes || "").slice(0, MAX_NOTE_CHARS);
  if (notes.trim().split(/\s+/).length < 120) {
    return send(res, 400, { error: "There aren't enough notes here to build a paper from." });
  }

  const site = String(body.site || "").slice(0, 120);
  const prompt = buildGenerationPrompt({
    componentId: component.id,
    optionId: option.id,
    site,
    pageTitle: String(body.pageTitle || "").slice(0, 200),
    includedPages: Array.isArray(body.includedPages) ? body.includedPages.slice(0, 40) : [],
    notes
  });

  let generated;
  try {
    generated = await callGemini(prompt.system, prompt.user, PAPER_SCHEMA, apiKey);
  } catch (e) {
    return send(res, e.status || 502, {
      error:
        e.status === 429
          ? "Every Gemini model is rate limiting right now. Wait a minute and try again."
          : "Couldn't generate the paper: " + e.message
    });
  }

  // Marks, timings and question order come from the specification, never from
  // the model, so a generated paper always totals what the real paper totals.
  const byNumber = {};
  (generated.questions || []).forEach((q) => {
    byNumber[String(q.number)] = q;
  });

  const questions = component.questions.map((spec) => {
    const g = byNumber[String(spec.n)] || {};
    return {
      number: spec.n,
      stem: String(g.stem || "").trim() || "(This question failed to generate \u2014 skip it.)",
      marks: spec.marks,
      spagMarks: spec.spag,
      ao: spec.ao,
      guidanceMinutes: spec.minutes,
      usesSources: spec.uses,
      markScheme: g.markScheme || { levels: [], indicativeContent: [] }
    };
  });

  const totals = paperTotals(component);
  const sources = (generated.sources || []).slice(0, component.stimulusCount).map((s) => ({
    label: String(s.label || "").trim(),
    provenance: String(s.provenance || "").trim(),
    body: String(s.body || "").trim(),
    synthetic: true
  }));

  return send(res, 200, {
    paper: {
      componentId: component.id,
      optionId: option.id,
      paperTitle: component.paper,
      sectionTitle: component.section,
      optionLabel: option.label,
      site,
      focusSummary: String(generated.focusSummary || "").slice(0, 300),
      totalMarks: totals.marks,
      timeLimitMinutes: totals.minutes,
      sources,
      questions,
      generatedAt: Date.now(),
      model: lastModelUsed()
    }
  });
}
