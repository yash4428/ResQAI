import { callLocalTriageModel, isOllamaAvailable } from "../services/ollamaService";
import { apiPost } from "./apiClient.js";
import { buildWoundPrompt } from "./prompts.js";

const MODE = import.meta.env.VITE_GEMMA_MODE || "hybrid";

export function parseGemmaJSON(text) {
  const raw = String(text || "");
  const cleaned = raw
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();

  if (!cleaned) {
    throw new Error("Gemma returned an empty response. Please try again, or use the text description.");
  }

  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  const candidate = jsonMatch ? jsonMatch[0] : cleaned;

  try {
    return JSON.parse(candidate);
  } catch {
    throw new Error("Gemma returned invalid JSON: " + cleaned.slice(0, 300));
  }
}

function extractText(data) {
  return String(data?.text || "").trim();
}

function formatLocalTriage(localTriage) {
  if (!localTriage) return "";

  return [
    "Local emergency priors from the fine-tuned triage model:",
    `- Severity estimate: ${localTriage.severity || "unknown"}`,
    `- Suspected condition: ${localTriage.condition || "unknown"}`,
    `- Ambulance recommended: ${localTriage.call_ambulance ? "yes" : "no or unclear"}`,
    `- Key signals: ${(localTriage.key_signals || []).join(", ") || "none extracted"}`,
    `- Risk flags: ${(localTriage.risk_flags || []).join(", ") || "none extracted"}`,
    `- Triage reasoning: ${localTriage.triage_reasoning || "not provided"}`,
  ].join("\n");
}

async function getLocalTriagePriors(localEmergencySummary, availableResources) {
  if (!localEmergencySummary?.trim()) return null;

  try {
    if (!(await isOllamaAvailable())) return null;
    return await callLocalTriageModel(localEmergencySummary, availableResources);
  } catch (error) {
    console.warn("Local triage priors unavailable for downstream generation.", error);
    return null;
  }
}

function buildHybridUserMessage(userMessage, localTriage) {
  if (!localTriage) {
    return userMessage;
  }

  return [
    formatLocalTriage(localTriage),
    "",
    "Use the local triage priors as guidance, not as the final answer.",
    "",
    userMessage,
  ].join("\n");
}

// TEXT CALL — for protocol generation, fallback, report
export async function callGemmaText(systemPrompt, userMessage, retries = 2, options = {}) {
  const {
    useLocalPriors = MODE !== "studio",
    localEmergencySummary = "",
    availableResources = "",
  } = options;

  const localTriage =
    MODE === "local" || !useLocalPriors
      ? null
      : await getLocalTriagePriors(localEmergencySummary, availableResources);
  const finalUserMessage = buildHybridUserMessage(userMessage, localTriage);

  for (let i = 0; i <= retries; i++) {
    try {
      const payload = {
        systemPrompt,
        userMessage: finalUserMessage,
        mode: MODE,
      };
      const data = await apiPost("/api/ai/text", payload);
      const text = extractText(data);
      return parseGemmaJSON(text);
    } catch (e) {
      if (i === retries) throw e;
      await new Promise(r => setTimeout(r, 1000)); // wait 1s before retry
    }
  }
}

// VISION CALL — for wound assessment and inventory scan
export async function callGemmaVision(
  systemPrompt,
  base64Image,
  mimeType = "image/jpeg",
  retries = 2,
  userText = "Analyze this image and return JSON as instructed."
) {
  for (let i = 0; i <= retries; i++) {
    try {
      const data = await apiPost("/api/ai/vision", {
        systemPrompt,
        base64Image,
        mimeType,
        userText,
      });
      const text = extractText(data);
      return parseGemmaJSON(text);
    } catch (e) {
      if (i === retries) throw e;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

// Convert file to base64 string
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]); // strip data:image/jpeg;base64,
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export async function assessWound({ imageBase64, description, language }) {
  const prompt = buildWoundPrompt(language);
  const userText = description?.trim()
    ? `Analyze this wound image. The user also described it as: "${description.trim()}". Return only the required JSON.`
    : "Analyze this wound image and return only the required JSON.";

  if (imageBase64) {
    try {
      return await callGemmaVision(prompt, imageBase64, "image/jpeg", 1, userText);
    } catch (visionError) {
      if (!description?.trim()) throw visionError;
      console.warn("Vision wound assessment failed, falling back to text.", visionError);
    }
  }

  if (description?.trim()) {
    try {
      return await callGemmaText(
        prompt,
        `Assess this wound description and return the required JSON: ${description}`
      );
    } catch (textError) {
      console.warn("Text wound assessment failed, using local fallback.", textError);
      return buildLocalWoundFallback(description);
    }
  }

  throw new Error("Add a photo or description before analysis.");
}

function buildLocalWoundFallback(description = "") {
  const text = description.toLowerCase();
  const hasBurn = /burn|scald/.test(text);
  const hasFracture = /fracture|broken|bone|deform/.test(text);
  const hasBleeding = /bleed|blood/.test(text);
  const hasSevere = /deep|arterial|spurting|unconscious|severe|large/.test(text);
  const location = [
    "knee",
    "arm",
    "leg",
    "hand",
    "palm",
    "finger",
    "foot",
    "ankle",
    "head",
    "face",
    "mouth",
    "teeth",
  ].find((word) => text.includes(word)) || "unknown";

  return {
    severity: hasSevere || hasFracture ? "serious" : "minor",
    wound_type: hasBurn ? "burn" : hasFracture ? "fracture" : text.includes("abrasion") ? "abrasion" : "injury",
    bleed_rate: hasBleeding ? "slow" : "none",
    location,
    immediate_risk: "Assessment used the written description because AI vision did not return valid JSON.",
    contraindications: ["Do not ignore worsening pain, swelling, heavy bleeding, or loss of movement."],
  };
}
