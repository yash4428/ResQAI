export function buildWoundPrompt() {
  return `You are an emergency medical AI assistant.
Analyze the provided image of an injury.
Respond ONLY with a valid JSON object. No preamble, no explanation, no markdown fences.

Use this exact schema:
{
  "severity": "minor" | "serious" | "critical",
  "wound_type": "string (e.g. laceration, burn_second_degree, abrasion, fracture, contusion)",
  "bleed_rate": "none" | "slow" | "moderate" | "arterial",
  "location": "string (body part)",
  "immediate_risk": "string (one sentence)",
  "contraindications": ["string array of things NOT to do"]
}

Be conservative — if uncertain between serious and critical, choose critical.`;
}

export function buildInventoryPrompt() {
  return `You are an emergency resource identification AI.
Analyze the provided image and identify all objects visible that could be used in a first-aid emergency.
Respond ONLY with valid JSON. No preamble, no markdown fences.

{
  "items": [
    { "name": "string", "description": "string (how it could help)", "confidence": "high" | "medium" | "low" }
  ]
}

Examples of useful items: cloth, fabric, dupatta, scarf, belt, rope, tape, bottle of water, stick, plank, bag, plastic wrap, paper.
Include everything possibly useful. If nothing useful is visible, return { "items": [] }.`;
}

export function buildProtocolPrompt(woundAssessment, inventory, language) {
  const inventoryList = inventory
    .map((item) => item.name)
    .join(", ");

  const langName = getLanguageName(language);

  return `You are an emergency first-aid AI. Generate a step-by-step protocol.

INJURY: ${woundAssessment?.wound_type || woundAssessment?.condition || "general_emergency"}, Severity: ${woundAssessment?.severity || "moderate"}, Location: ${woundAssessment?.location || "unknown"}
BLEED RATE: ${woundAssessment?.bleed_rate || "unknown"}
IMMEDIATE RISK: ${woundAssessment?.immediate_risk || "unknown"}

AVAILABLE ITEMS ONLY: ${inventoryList}

LANGUAGE: Respond entirely in ${langName}. Use simple, clear words a non-medical person can follow.

VOICE AND TONE:
- Sound calm, steady, and authoritative.
- Use short direct sentences.
- Give one action at a time.
- Do not sound casual.
- Do not over-explain.
- Do not create panic.
- Avoid vague language like "maybe", "you could", or "try to".
- Prefer commands like "Press firmly." and "Keep the arm still."
- If critical, be firm: "Call emergency services now if possible."

CRITICAL RULES:
- Use ONLY items from the AVAILABLE ITEMS list above.
- Do NOT suggest any item not explicitly listed above.
- Steps must be short imperative sentences (max 20 words each).
- Output ONLY valid JSON. No preamble. No markdown fences.

JSON SCHEMA:
{
  "steps": [
    {
      "action": "string (imperative sentence, max 20 words)",
      "timer_seconds": 0,
      "success_check": "string (how user knows step worked)",
      "fallback": "string (what to do if step fails)"
    }
  ],
  "when_to_stop": "string (critical threshold description)",
  "do_not": ["string array of absolute contraindications"]
}`;
}

export function buildLocalEmergencySummary(
  woundAssessment,
  inventory = [],
  extraDetails = ""
) {
  const items = inventory
    .map((item) => (typeof item === "string" ? item : item?.name))
    .filter(Boolean)
    .join(", ");

  const lines = [
    `Condition: ${woundAssessment?.wound_type || woundAssessment?.condition || "general_emergency"}`,
    `Severity: ${woundAssessment?.severity || "moderate"}`,
    `Location: ${woundAssessment?.location || "unknown"}`,
    `Bleeding: ${woundAssessment?.bleed_rate || "unknown"}`,
    `Immediate risk: ${woundAssessment?.immediate_risk || "unknown"}`,
  ];

  if (items) {
    lines.push(`Available items: ${items}`);
  }

  if (extraDetails?.trim()) {
    lines.push(`Extra details: ${extraDetails.trim()}`);
  }

  return lines.join(". ");
}

export function buildFallbackPrompt(originalStep, inventory, language, failureDescription = "user reported step not working") {
  const inventoryList = inventory.map((item) => item.name).join(", ");
  const langName = getLanguageName(language);

  return `Emergency first-aid step failed. Generate ONE alternative action.

ORIGINAL STEP: ${originalStep.action}
FAILURE REASON: ${failureDescription}
AVAILABLE ITEMS ONLY: ${inventoryList}
LANGUAGE: ${langName}

VOICE AND TONE:
- Sound calm, steady, and authoritative.
- Use short direct sentences.
- Give one action at a time.
- Do not sound casual.
- Do not over-explain.
- Do not create panic.
- Avoid vague language like "maybe", "you could", or "try to".

Return ONLY JSON (no preamble, no markdown):
{
  "action": "string (alternative action, max 20 words)",
  "timer_seconds": 0,
  "success_check": "string",
  "note": "string (brief explanation of why this alternative)"
}`;
}

function getLanguageName(language) {
  const names = {
    en: "English",
    hi: "Hindi",
    pa: "Punjabi",
    bn: "Bengali",
    ta: "Tamil",
    te: "Telugu",
  };
  return names[language] || "English";
}

export function buildReportPrompt(session) {
  const completedSteps = session.stepHistory
    .filter((s) => s.completed)
    .map((s) => s.step.action)
    .join("; ");

  const elapsedMinutes = session.startTime
    ? Math.round((Date.now() - session.startTime) / 60000)
    : 0;

  return `Generate a concise emergency incident report for hospital intake staff.
LANGUAGE: English always (for medical staff).

SESSION DATA:
- Injury: ${session.woundAssessment?.wound_type || session.woundAssessment?.condition || "general_emergency"}, ${session.woundAssessment?.severity || "moderate"}, ${session.woundAssessment?.location || "unknown"}
- Bleed rate: ${session.woundAssessment?.bleed_rate}
- Steps performed: ${completedSteps}
- Failures encountered: ${session.failureCount}
- Time elapsed: ${elapsedMinutes} minutes
- Items available: ${session.inventory.map(i => i.name).join(", ")}

Return ONLY JSON (no preamble, no markdown):
{
  "summary": "string (2-3 sentence medical summary)",
  "steps_performed": ["string array of what was done"],
  "warnings": ["string array of what to watch for"],
  "estimated_blood_loss": "string"
}`;
}
