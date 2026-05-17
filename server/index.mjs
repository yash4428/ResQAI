import http from "node:http";
import path from "node:path";
import fs from "node:fs";

const cwd = process.cwd();
loadEnvFile(path.join(cwd, ".env"));

const PORT = Number(process.env.API_PORT || 8787);
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";
const GEMMA_MODE = process.env.GEMMA_MODE || process.env.VITE_GEMMA_MODE || "hybrid";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.VITE_GEMMA_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || process.env.VITE_GEMMA_STUDIO_MODEL || "gemini-2.5-flash";
const OLLAMA_URL = process.env.OLLAMA_URL || process.env.VITE_OLLAMA_URL || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || process.env.VITE_OLLAMA_MODEL || "resqai";
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS || process.env.VITE_OLLAMA_TIMEOUT_MS || 1800);
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

const server = http.createServer(async (req, res) => {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (req.method === "GET" && url.pathname === "/api/health") {
      return sendJson(res, 200, await getHealthStatus());
    }

    if (req.method === "POST" && url.pathname === "/api/triage/local") {
      const body = await readJsonBody(req);
      const result = await runLocalTriage(body.userMessage, body.availableResources);
      return sendJson(res, 200, result);
    }

    if (req.method === "POST" && url.pathname === "/api/triage/final") {
      assertGeminiConfigured();
      const body = await readJsonBody(req);
      const text = await runGeminiTriage(body);
      return sendJson(res, 200, { text });
    }

    if (req.method === "POST" && url.pathname === "/api/ai/text") {
      const body = await readJsonBody(req);
      const text = await runTextGeneration(body);
      return sendJson(res, 200, { text });
    }

    if (req.method === "POST" && url.pathname === "/api/ai/vision") {
      assertGeminiConfigured();
      const body = await readJsonBody(req);
      const text = await runVisionGeneration(body);
      return sendJson(res, 200, { text });
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    const status = Number(error.statusCode || 500);
    sendJson(res, status, {
      error: error.message || "Server error",
    });
  }
});

server.listen(PORT, () => {
  console.log(`ResqAI API server listening on http://localhost:${PORT}`);
});

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch {
    throw createHttpError(400, "Invalid JSON body.");
  }
}

async function getHealthStatus() {
  const localReady = await isOllamaAvailable();
  return {
    mode: GEMMA_MODE,
    localReady,
    cloudConfigured: Boolean(GEMINI_API_KEY),
    offlineReady: true,
    ollamaModel: OLLAMA_MODEL,
    geminiModel: GEMINI_MODEL,
  };
}

async function isOllamaAvailable() {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`, {
      signal: AbortSignal.timeout(1000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function runLocalTriage(userMessage, availableResources) {
  if (!userMessage || !String(userMessage).trim()) {
    throw createHttpError(400, "userMessage is required.");
  }

  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS),
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [
        { role: "system", content: TRIAGE_SYSTEM_PROMPT },
        { role: "user", content: buildLocalUserMessage(userMessage, availableResources) },
      ],
      stream: false,
      options: {
        temperature: 0.2,
      },
    }),
  });

  if (!response.ok) {
    throw createHttpError(response.status, `Ollama failed with status ${response.status}`);
  }

  const data = await response.json();
  const text = String(data.message?.content || "").replace(/```json|```/gi, "").trim();
  const parsed = extractJSONObject(text);

  return {
    severity: String(parsed.severity || "moderate").toLowerCase(),
    condition: String(parsed.condition || "general_emergency"),
    call_ambulance: Boolean(parsed.call_ambulance),
    key_signals: Array.isArray(parsed.key_signals)
      ? parsed.key_signals.map((item) => String(item).trim()).filter(Boolean).slice(0, 6)
      : [],
    triage_reasoning: String(parsed.triage_reasoning || ""),
    risk_flags: Array.isArray(parsed.risk_flags)
      ? parsed.risk_flags.map((item) => String(item).trim()).filter(Boolean).slice(0, 6)
      : [],
  };
}

async function runGeminiTriage({ prompt, imageBase64, systemPrompt }) {
  if (!prompt || !String(prompt).trim()) {
    throw createHttpError(400, "prompt is required.");
  }

  const parts = [{ text: prompt }];
  if (imageBase64) {
    parts.unshift({
      inline_data: {
        mime_type: "image/jpeg",
        data: imageBase64,
      },
    });
  }

  const response = await fetch(
    `${GEMINI_BASE}/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt || DEFAULT_TRIAGE_SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts }],
        generationConfig: {
          temperature: 0.15,
          topP: 0.8,
          responseMimeType: "application/json",
        },
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw createHttpError(response.status, `Gemini failed with status ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  return extractGeminiText(data);
}

async function runTextGeneration(body) {
  const systemPrompt = String(body.systemPrompt || "").trim();
  const userMessage = String(body.userMessage || "").trim();
  const mode = String(body.mode || GEMMA_MODE).trim();

  if (!systemPrompt || !userMessage) {
    throw createHttpError(400, "systemPrompt and userMessage are required.");
  }

  if (mode === "local") {
    const data = await callOllamaChat(systemPrompt, userMessage);
    return String(data.message?.content || "").trim();
  }

  assertGeminiConfigured();
  const payload = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: [{ text: userMessage }] }],
    generationConfig: { temperature: 0.3, responseMimeType: "application/json" },
  };
  const data = await callGemini(payload);
  return extractGeminiText(data);
}

async function runVisionGeneration(body) {
  const systemPrompt = String(body.systemPrompt || "").trim();
  const userText = String(body.userText || "").trim();
  const base64Image = String(body.base64Image || "").trim();
  const mimeType = String(body.mimeType || "image/jpeg");

  if (!systemPrompt || !base64Image) {
    throw createHttpError(400, "systemPrompt and base64Image are required.");
  }

  const payload = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType, data: base64Image } },
          { text: userText || "Analyze this image and return JSON as instructed." },
        ],
      },
    ],
    generationConfig: { temperature: 0.1, responseMimeType: "application/json" },
  };
  const data = await callGemini(payload);
  return extractGeminiText(data);
}

async function callGemini(payload) {
  const response = await fetch(
    `${GEMINI_BASE}/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw createHttpError(response.status, `Gemini failed with status ${response.status}: ${errorText}`);
  }

  return response.json();
}

async function callOllamaChat(systemPrompt, userMessage) {
  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS),
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      stream: false,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw createHttpError(response.status, `Ollama failed with status ${response.status}: ${errorText}`);
  }

  return response.json();
}

function extractGeminiText(data) {
  const candidate = data.candidates?.[0];
  const functionArgs = candidate?.content?.parts?.[0]?.functionCall?.args;
  if (functionArgs) {
    return JSON.stringify(functionArgs);
  }

  const parts = candidate?.content?.parts || [];
  return parts
    .map((part) => part.text || "")
    .join("")
    .replace(/```json|```/gi, "")
    .trim();
}

function buildLocalUserMessage(userMessage, availableResources) {
  let fullMessage = `Emergency: ${String(userMessage).trim()}.`;
  if (availableResources && String(availableResources).trim()) {
    fullMessage += ` Available resources: ${String(availableResources).trim()}.`;
  }
  fullMessage += " Extract emergency triage context and respond with JSON only.";
  return fullMessage;
}

function extractJSONObject(text) {
  const match = String(text || "").match(/\{[\s\S]*\}/);
  if (!match) {
    throw createHttpError(502, "No JSON found in model response.");
  }
  return JSON.parse(match[0]);
}

function assertGeminiConfigured() {
  if (!GEMINI_API_KEY) {
    throw createHttpError(503, "Gemini API key is not configured on the server.");
  }
}

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
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

const TRIAGE_SYSTEM_PROMPT = `You are ResqAI's local emergency triage extraction model.
Return JSON only with exactly these fields:
severity, condition, call_ambulance, key_signals, triage_reasoning, risk_flags.

Rules:
- Severity must be one of: critical, high, moderate, low.
- condition must be snake_case.
- key_signals and risk_flags must be arrays of short strings.
- Do not include markdown fences or extra commentary.`;

const DEFAULT_TRIAGE_SYSTEM_PROMPT = `You are ResqAI, an emergency medical assistant.
Generate only valid JSON with exactly these fields:
severity, call_ambulance, steps, estimated_time_minutes, condition, warn_message, next_question.

Safety rules:
- Prefer immediate life-saving actions first.
- Do not provide medication dosages.
- Keep steps short, concrete, and sequential.
- Respond in the same language as the user when possible.
- If the situation sounds life-threatening, clearly recommend emergency services.`;
