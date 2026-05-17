import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
loadEnvFile(path.join(rootDir, ".env"));

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.VITE_GEMMA_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || process.env.VITE_GEMMA_STUDIO_MODEL || "gemini-2.5-flash";
const OLLAMA_URL = process.env.OLLAMA_URL || process.env.VITE_OLLAMA_URL || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || process.env.VITE_OLLAMA_MODEL || "resqai";

const TEST_CASES = [
  { prompt: "someone is choking", expectSeverity: "critical", expectCondition: "choking_adult" },
  { prompt: "my friend needs cpr", expectSeverity: "critical", expectCondition: "cardiac_arrest" },
  { prompt: "bad cut on arm", expectSeverity: "high", expectCondition: "severe_bleeding" },
  { prompt: "मेरे दोस्त को दिल का दौरा", expectSeverity: "critical", expectCondition: "cardiac_arrest" },
  { prompt: "child swallowed bleach", expectSeverity: "critical", expectCondition: "poison_ingestion" },
];

async function main() {
  const mode = process.argv[2] || "hybrid";
  console.log(`Running ResqAI triage smoke tests in ${mode} mode`);

  const results = [];
  for (const testCase of TEST_CASES) {
    try {
      const result =
        mode === "ollama"
          ? await runLocalOnly(testCase.prompt)
          : mode === "cloud"
          ? await runCloudOnly(testCase.prompt)
          : await runHybrid(testCase.prompt);

      const verdict = evaluateResult(result, testCase);
      results.push({ prompt: testCase.prompt, verdict, result });
      console.log(`\nPrompt: ${testCase.prompt}`);
      console.log(`Verdict: ${verdict}`);
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      results.push({ prompt: testCase.prompt, verdict: "error", error: String(error) });
      console.log(`\nPrompt: ${testCase.prompt}`);
      console.log(`Verdict: error`);
      console.log(String(error));
    }
  }

  const failed = results.filter((item) => item.verdict !== "pass").length;
  console.log(`\nCompleted ${results.length} tests. ${failed} not passing.`);
  process.exitCode = failed ? 1 : 0;
}

async function runHybrid(prompt) {
  const local = await tryLocal(prompt);
  return runCloud(prompt, local);
}

async function runLocalOnly(prompt) {
  const local = await runLocal(prompt);
  return {
    severity: local.severity,
    call_ambulance: local.call_ambulance,
    steps: local.key_signals.length ? local.key_signals : ["Local triage extraction only."],
    estimated_time_minutes: local.severity === "critical" ? 0 : 5,
    condition: local.condition,
    warn_message: local.triage_reasoning,
    next_question: "",
    _source: "local",
  };
}

async function runCloudOnly(prompt) {
  return runCloud(prompt, null);
}

async function tryLocal(prompt) {
  try {
    return await runLocal(prompt);
  } catch {
    return null;
  }
}

async function runLocal(prompt) {
  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [
        {
          role: "system",
          content:
            "Return JSON only with fields severity, condition, call_ambulance, key_signals, triage_reasoning, risk_flags.",
        },
        {
          role: "user",
          content: `Emergency: ${prompt}. Extract emergency context and return JSON only.`,
        },
      ],
      stream: false,
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama error ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  return extractJSON(data.message?.content || "");
}

async function runCloud(prompt, localTriage) {
  if (!GEMINI_API_KEY) {
    throw new Error("Missing GEMINI_API_KEY in .env");
  }

  const triageLines = localTriage
    ? [
        `Severity estimate: ${localTriage.severity || "unknown"}`,
        `Condition estimate: ${localTriage.condition || "unknown"}`,
        `Ambulance recommended: ${localTriage.call_ambulance ? "yes" : "no"}`,
        `Signals: ${(localTriage.key_signals || []).join(", ") || "none"}`,
        `Reasoning: ${localTriage.triage_reasoning || "none"}`,
      ].join("\n")
    : "Local triage unavailable.";

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: {
          parts: [
            {
              text:
                'You are ResqAI. Return only valid JSON with fields severity, call_ambulance, steps, estimated_time_minutes, condition, warn_message, next_question. Severity must be critical, high, moderate, or low.',
            },
          ],
        },
        contents: [
          {
            role: "user",
            parts: [
              {
                text: [
                  "Use these local triage priors as guidance for emergency reasoning:",
                  triageLines,
                  `Original user message: "${prompt}"`,
                ].join("\n"),
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.15,
          responseMimeType: "application/json",
        },
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Gemini error ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  const text = (data.candidates?.[0]?.content?.parts || []).map((part) => part.text || "").join("").trim();
  return extractJSON(text);
}

function extractJSON(text) {
  const cleaned = String(text || "").replace(/```json|```/gi, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error(`No JSON found in response: ${cleaned.slice(0, 300)}`);
  }
  return JSON.parse(match[0]);
}

function evaluateResult(result, testCase) {
  const severity = String(result.severity || "").toLowerCase();
  const condition = String(result.condition || "").toLowerCase();

  if (!Array.isArray(result.steps) || !result.steps.length) return "fail";
  if (severity !== testCase.expectSeverity) return "fail";

  if (testCase.expectCondition === "poison_ingestion") {
    return /poison|ingestion|chemical|bleach/.test(condition) ? "pass" : "warn";
  }

  return condition === testCase.expectCondition ? "pass" : "warn";
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) continue;
    const key = trimmed.slice(0, equalsIndex).trim();
    const value = trimmed.slice(equalsIndex + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
