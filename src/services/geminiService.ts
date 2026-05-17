import { apiPost } from "../lib/apiClient.js";
import { buildSafeFallback, extractJSONObject, normalizeTriageResult } from "../utils/jsonValidator";
import { getGeminiSystemPrompt } from "../utils/promptBuilder";

export async function callGeminiTriage(
  prompt: string,
  imageBase64?: string
): Promise<ReturnType<typeof normalizeTriageResult>> {
  const data = await apiPost("/api/triage/final", {
    prompt,
    imageBase64,
    systemPrompt: getGeminiSystemPrompt(),
  });
  const text = String(data?.text || "");
  const parsed = text ? extractJSONObject(text) : buildSafeFallback(prompt, "cloud");
  return normalizeTriageResult(parsed, "cloud");
}
