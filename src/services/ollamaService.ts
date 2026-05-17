import { apiGet, apiPost } from "../lib/apiClient.js";

export type LocalTriageResult = {
  severity: string;
  condition: string;
  call_ambulance: boolean;
  key_signals: string[];
  triage_reasoning: string;
  risk_flags: string[];
};

export async function isOllamaAvailable(): Promise<boolean> {
  try {
    const data = await apiGet("/api/health");
    return Boolean(data?.localReady);
  } catch {
    return false;
  }
}

export async function callLocalTriageModel(
  userMessage: string,
  availableResources?: string
): Promise<LocalTriageResult> {
  const data = await apiPost("/api/triage/local", {
    userMessage,
    availableResources,
  });
  return {
    severity: String(data?.severity || "moderate").toLowerCase(),
    condition: String(data?.condition || "general_emergency"),
    call_ambulance: Boolean(data?.call_ambulance),
    key_signals: Array.isArray(data?.key_signals)
      ? data.key_signals.map((item: unknown) => String(item).trim()).filter(Boolean).slice(0, 6)
      : [],
    triage_reasoning: String(data?.triage_reasoning || ""),
    risk_flags: Array.isArray(data?.risk_flags)
      ? data.risk_flags.map((item: unknown) => String(item).trim()).filter(Boolean).slice(0, 6)
      : [],
  };
}
