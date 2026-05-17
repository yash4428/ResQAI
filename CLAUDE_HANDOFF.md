# ResQAI / ResqAI Full Technical Handoff

This document is a complete technical writeup of the current state of the project for another coding model or engineer, especially Claude. It explains what the repository contains, what has already been built, how inference now works end to end, how the UI uses the AI stack, what is deployable today, what is local-demo-only, and where the main extension points and risks are.

This repo currently contains two tightly related but distinct layers:

1. `src/` and the React/Vite app:
   This is the user-facing emergency triage PWA.

2. `resQ/`:
   This contains the model-side assets, training notebook, dataset files, testing docs, Ollama `Modelfile`, and scripts used to produce a local fine-tuned emergency triage model.

The important architectural point is:

The local fine-tuned model is no longer treated as the final assistant. It is used as a specialized triage prior / emergency context extractor. The cloud Gemini/Gemma path remains the primary reasoning engine for final structured emergency JSON, and all model/API calls now go through a small backend proxy instead of directly from the browser.

## 1. Current Product Intent

ResQAI is an emergency first-aid assistant designed for real-time use in stressful situations. The app supports:

- typed emergency input
- voice-driven emergency input
- photo-assisted emergency context
- guided first-aid steps
- CPR metronome guidance
- CPR posture feedback via camera/photo
- offline fallbacks when cloud AI is unavailable
- hospital/urgent-care/pharmacy direction suggestions based on severity

The most important user flow is:

1. User describes an emergency by voice or text.
2. App triages the emergency.
3. App asks what resources are available nearby.
4. App re-triages or refines the response using resource context.
5. App reads steps aloud and displays them as interactive cards.
6. In CPR-type cases, app can launch metronome guidance and optional posture analysis.

## 2. What Was Implemented In This Round

The major implementation completed in this repo is the hybrid inference architecture. Before this change, there was already a working emergency flow, but the AI logic was more monolithic. Now it is split into explicit orchestration layers.

The new architecture is:

User input  
-> frontend `/api/*` request  
-> backend proxy  
-> local Ollama triage extraction if available  
-> structured emergency priors  
-> Gemini cloud reasoning for final answer  
-> strict JSON normalization/validation  
-> offline fallback if needed  
-> UI rendering

This preserves cloud deployability while also supporting a much stronger local demo story.

## 3. Repository Layout

Top-level structure:

```text
.
├── .env.example
├── CLAUDE_HANDOFF.md
├── DEPLOYMENT.md
├── index.html
├── package.json
├── server/
│   └── index.mjs
├── scripts/
│   └── run-triage-smoke.mjs
├── src/
│   ├── App.jsx
│   ├── main.jsx
│   ├── index.css
│   ├── components/
│   ├── context/
│   ├── lib/
│   ├── screens/
│   ├── services/
│   └── utils/
└── resQ/
    ├── Modelfile
    ├── README.md
    ├── TESTING.md
    ├── train_config.yaml
    ├── requirements.txt
    ├── resqai_dataset.json
    ├── phrases_no_exclude_train.jsonl
    ├── phrases_no_exclude_test.jsonl
    ├── notebooks/
    └── scripts/
```

## 4. Frontend Stack

The app stack is:

- React 19
- Vite 8
- TypeScript enabled via `tsc`, but the app is a mixed JS/JSX/TS codebase
- `vite-plugin-pwa` for PWA/service worker behavior
- minimal dependency surface overall

Important `package.json` scripts:

- `npm run dev`
- `npm run dev:server`
- `npm run start:server`
- `npm run build`
- `npm run preview`
- `npm run smoke:triage`

## 5. Key Frontend Runtime Files

### `src/App.jsx`

This is the top-level app shell. It provides:

- `OfflineBanner`
- `AppHeader`
- `AIHealthPanel`
- bottom tab navigation
- top progress indicator
- routing by session phase

This app does not use React Router. It uses phase-based rendering via session state from `SessionContext`.

### `src/context/SessionContext.jsx`

This is the global session reducer/store for the app.

It tracks:

- language
- emergency type
- wound assessment
- inventory
- protocol
- current step index
- step history
- failure count
- phase
- loading state
- error state
- mute state
- incident report

The app uses reducer actions rather than external state libraries.

### `src/screens/WoundCapture.jsx`

This is the central emergency triage screen and the most complex UI file.

It currently manages:

- microphone capture and speech recognition
- confirmation of recognized speech
- typed fallback input
- image capture/compression
- two-stage triage flow
- resource collection phase
- spoken guidance
- auto-advancing step playback
- CPR rhythm metronome
- CPR posture video/photo capture
- follow-up question display
- AI source badge display
- severity display
- hospital directions display

This file is the main consumer of `triageEmergency()`.

Important behavioral details:

- Initial emergency description is triaged first.
- After the initial classification, the app asks:
  "What do you have available nearby?"
- If the user provides resources, the app re-runs triage with the refined context.
- If the user indicates no supplies, the step list is sanitized toward bare-hands-only instructions.
- If the inferred condition suggests CPR/cardiac arrest, the app can launch a CPR guide with a beat-based metronome and posture feedback flow.

### `src/screens/InventoryScan.jsx`, `StepExecution.jsx`, `HospitalReport.jsx`

These use `src/lib/gemmaClient.js` for non-triage AI features such as:

- report generation
- some protocol fallback generation
- vision/text analysis for inventory or wound-related subfeatures

This is intentional. `src/lib/gemmaClient.js` is still a higher-level helper client, but it no longer talks directly to Gemini or Ollama from the browser. It now goes through backend `/api` routes and can also include local Ollama priors for downstream text generation.

## 6. New AI Orchestration Architecture

The core inference refactor lives in these files:

- `server/index.mjs`
- `src/services/gemmaService.ts`
- `src/services/ollamaService.ts`
- `src/services/geminiService.ts`
- `src/lib/gemmaClient.js`
- `src/utils/promptBuilder.ts`
- `src/utils/jsonValidator.ts`

### 6.1 `src/services/gemmaService.ts`

This is now the central orchestration entrypoint for emergency triage.

Primary exported function:

```ts
triageEmergency(userMessage, imageBase64?, availableResources?)
```

Current behavior:

1. Normalize the user message.
2. Try a local Ollama availability check.
3. If Ollama is available:
   - call the local fine-tuned model as a triage extractor
   - store the extracted structured priors
   - mark source as `local`
4. Build an enhanced prompt using local priors plus original user message.
5. Send that enhanced prompt to Gemini/Gemma cloud inference.
6. Validate and normalize the returned JSON.
7. If cloud inference fails:
   - use offline triage fallback
   - preserve local triage context when available

Important conceptual detail:

`gemmaService.ts` does not treat the local model as the final assistant. It treats it as an upstream structured triage assistant that helps the cloud model reason better.

### 6.2 `src/services/ollamaService.ts`

This is the local triage extraction layer.

Browser-facing service responsibility:

- check backend `/api/health`
- call backend `/api/triage/local`
- never talk to Ollama directly anymore

Backend environment variables:

- `OLLAMA_URL`
- `OLLAMA_MODEL`
- `OLLAMA_TIMEOUT_MS`

Defaults:

- URL: `http://localhost:11434`
- model: `resqai`
- timeout: `1800ms`

Exports:

- `isOllamaAvailable()`
- `callLocalTriageModel(userMessage, availableResources?)`

`isOllamaAvailable()` now checks backend health, which in turn checks Ollama availability server-side.

`callLocalTriageModel()` sends a system prompt that instructs the model to return JSON only with:

- `severity`
- `condition`
- `call_ambulance`
- `key_signals`
- `triage_reasoning`
- `risk_flags`

The response is cleaned for markdown fences and then parsed via regex-based JSON extraction.

The local model output is intentionally narrower than the final public response. It does not produce final polished user steps. It only produces emergency priors.

### 6.3 `src/utils/promptBuilder.ts`

This is where local structured priors become cloud prompt guidance.

Primary functions:

- `buildEnhancedPrompt(...)`
- `getGeminiSystemPrompt()`

`buildEnhancedPrompt()` assembles a text prompt that includes:

- original user message
- local triage severity estimate
- suspected condition
- ambulance recommendation
- extracted key signals
- extracted risk flags
- triage reasoning
- available resources
- high-level image context note
- output schema instructions
- safety constraints

This file is the key embodiment of the hybrid architecture. If another model changes the system design later, this is one of the first places to inspect.

### 6.4 `src/services/geminiService.ts`

This is the cloud final reasoning layer.

Browser-facing service responsibility:

- call backend `/api/triage/final`
- never expose the Gemini key in the browser

Backend environment variables:

- `GEMINI_API_KEY`
- `GEMINI_MODEL`

Defaults:

- model: `gemini-2.5-flash`

Configuration choices:

- low temperature: `0.15`
- `topP: 0.8`
- `responseMimeType: "application/json"`

The backend service:

1. Accepts the enhanced prompt.
2. Optionally prepends an inline JPEG image payload.
3. Calls Gemini.
4. Extracts text or function-call args if present.
5. Parses/normalizes the result into the internal triage schema.

Again, this is intentionally the final reasoning engine, not the local model.

### 6.5 `src/utils/jsonValidator.ts`

This file is critical because it normalizes inconsistent model outputs into a predictable UI contract.

Types defined here:

- `TriageSeverity = "critical" | "high" | "moderate" | "low"`
- `TriageSource = "local" | "cloud" | "offline"`
- `TriageResult`

Final normalized `TriageResult` includes:

- `severity`
- `call_ambulance`
- `steps`
- `estimated_time_minutes`
- `condition`
- `warn_message`
- `next_question`
- `_source`
- optional `_triageContext`

Key behavior:

- regex-based JSON extraction for malformed model responses
- mapping legacy severities:
  - `serious -> high`
  - `minor -> low`
- default step injection if `steps` is missing
- snake_case normalization for `condition`
- safe fallback generation when parsing or validation fails

Built-in safe fallback logic currently handles:

- cardiac-like emergencies
- choking-like emergencies
- heavy bleeding-like emergencies
- general fallback

This makes the triage pipeline resilient even when the LLM output is malformed.

## 7. Current Emergency Inference Contract

The final frontend-facing triage schema is:

```json
{
  "severity": "critical | high | moderate | low",
  "call_ambulance": true,
  "steps": ["..."],
  "estimated_time_minutes": 0,
  "condition": "snake_case_condition",
  "warn_message": "urgent warning",
  "next_question": "follow up question",
  "_source": "local | cloud | offline",
  "_triageContext": {}
}
```

Important note:

The UI still supports older data stored in `offlineTriage.json`, where severity values may be `"serious"` or `"minor"`. The validator normalizes those into the new severity vocabulary.

## 8. Offline and Fallback Behavior

This app is now intentionally production-safer because cloud inference is proxied through the backend instead of using a browser-exposed API key.

Fallback priority order is:

1. Local Ollama triage extraction, if available
2. Gemini/Gemma cloud reasoning
3. Offline rule/data fallback

Hosted deployment behavior:

- the browser only calls your backend
- the backend may or may not be able to reach Ollama depending on your infrastructure
- if backend Ollama access fails, the app can still continue with cloud-only mode plus offline fallback

Local demo behavior:

- If Ollama is running on the same laptop or exposed via LAN IP,
  the app can use the local model.
- In that case the UI marks `_source` as `local`, meaning:
  local triage priors informed the cloud response.

Important nuance:

`_source: "local"` does not mean "local model wrote the final answer directly."
It means the local model contributed triage context and the hybrid path was used.

## 9. UI Components Added In This Round

### `src/components/AIModeIndicator.jsx`

Displays a compact inference-mode badge on the triage screen.

Modes:

- `local` -> `Enhanced Local + Cloud`
- `cloud` -> `Cloud AI`
- `offline` -> `Fallback`

This badge is driven by the triage result `_source`.

### `src/components/SeverityBanner.jsx`

Small reusable severity pill used in the triage screen.

Severity tone mapping:

- `critical` -> red
- `high` -> amber
- `moderate` / `low` -> neutral

### `src/components/EmergencyCard.jsx`

Reusable step card component for displayed emergency steps.

It supports:

- active state
- completed state
- replay click behavior

### `src/components/AIHealthPanel.jsx`

This is a demo-readiness / ops visibility panel added to the app header.

It provides:

- local Ollama readiness check
- whether cloud key is configured on the backend
- whether offline fallback is available
- network status
- current API base label
- backend mode
- last checked time

This is useful during hackathon demos or development sessions because it makes the inference mode visible without opening devtools.

## 10. AI Health and Demo Tooling

### `.env.example`

Current expected env variables:

```env
GEMINI_API_KEY=your_google_ai_studio_key
GEMINI_MODEL=gemini-2.5-flash
GEMMA_MODE=hybrid
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=resqai
OLLAMA_TIMEOUT_MS=1800
API_PORT=8787
ALLOWED_ORIGIN=http://localhost:5173
VITE_API_BASE_URL=
```

For phone + laptop demo on same Wi-Fi:

```env
OLLAMA_URL=http://<laptop-lan-ip>:11434
```

### `scripts/run-triage-smoke.mjs`

This is a Node-based smoke test harness for the hybrid triage pipeline.

It supports three modes:

- `hybrid`
- `cloud`
- `ollama`

Default:

```bash
npm run smoke:triage
```

Other modes:

```bash
npm run smoke:triage -- cloud
npm run smoke:triage -- ollama
```

It tests five scenarios:

1. `someone is choking`
2. `my friend needs cpr`
3. `bad cut on arm`
4. `मेरे दोस्त को दिल का दौरा`
5. `child swallowed bleach`

It evaluates:

- valid JSON
- presence of steps
- expected severity
- exact or approximate condition matching

This script does not reuse the frontend service modules directly because it is designed as a simple external verification harness with explicit env loading and direct fetch calls.

## 11. Build and Verification Status

What has already been verified in this workspace:

- frontend dependencies installed
- `npm run build` passes
- `node --check server/index.mjs` passes

What was not verified live in this environment:

- actual Ollama runtime responses
- actual Gemini API responses using a real API key
- end-to-end prompt quality for the five smoke-test cases in a live environment

So the implementation is structurally complete and buildable, but live inference quality still depends on the actual model and credentials present at runtime.

## 12. Existing `src/lib/gemmaClient.js`

This file still exists and is still used for other non-triage features.

It currently supports:

- `callGemmaText()`
- `callGemmaVision()`
- `assessWound()`
- backend-routed local/cloud/hybrid text and vision requests

This is not the new hybrid triage orchestrator.

Do not confuse:

- `src/services/gemmaService.ts`
  with
- `src/lib/gemmaClient.js`

Current division of responsibility:

- `src/services/gemmaService.ts`:
  emergency triage orchestration

- `src/lib/gemmaClient.js`:
  older helper client for report generation, inventory scan, wound assessment, and some fallback content generation

This means there is still some architectural duplication in the broader codebase at the helper/orchestrator level. That duplication is known and acceptable for now because the critical triage flow and backend hardening were the priority.

## 13. Current User Experience Details In `WoundCapture.jsx`

The main user-facing triage UX works roughly like this:

1. User speaks or types an emergency.
2. Speech recognition can show a confirmation card before proceeding.
3. `triageEmergency()` is called.
4. Severity + AI mode appear at the top.
5. If initial triage completes, app asks what resources are nearby.
6. User can:
   - take a photo
   - describe resources by voice
   - indicate nothing is available
7. App re-runs triage using that context.
8. Steps are displayed as clickable cards.
9. Text-to-speech reads steps aloud.
10. In CPR scenarios, app launches a 103 BPM metronome flow with visual pulse.
11. Optional posture recording/photo feedback uses the same triage path with a highly specific CPR analysis prompt.

The screen also handles:

- mic denial fallback
- typed fallback
- transcript error recovery
- image compression before upload
- state cleanup across concurrent/overlapping triage runs

## 14. Severity Mapping Changes

The system now standardizes around:

- `critical`
- `high`
- `moderate`
- `low`

However, parts of the older data/model ecosystem were previously using:

- `critical`
- `serious`
- `minor`

This was handled by:

- normalizing old values in `jsonValidator.ts`
- updating `HospitalDirections.jsx` to use the new severity tiers
- keeping offline assets compatible through normalization rather than requiring the JSON dataset to be rewritten immediately

This is important for any future refactor. If Claude modifies severity handling, it must preserve compatibility with both the old offline dataset and the new UI contract unless the dataset is explicitly migrated.

## 15. `HospitalDirections.jsx` Behavior

This component now maps the new severity tiers to destination types:

- `critical` -> hospital
- `high` -> urgent care
- `moderate` -> urgent care
- `low` -> pharmacy

It uses geolocation if available and falls back to generic Google Maps search URLs.

## 16. PWA / App Shell Behavior

The app is configured as a PWA through `vite-plugin-pwa`.

Current UX support includes:

- app update toast
- offline banner
- service worker generation
- cached app shell

This is frontend/PWA support, not full offline local-model support. The app can still function in reduced mode offline due to cached assets and offline triage data, but true local model reasoning still depends on Ollama being reachable on a local machine/network.

## 17. `resQ/` Model-Side Asset Summary

The `resQ/` folder is not frontend runtime code. It is the model research/training/deployment companion package.

Key files:

- `resQ/resqai_dataset.json`
- `resQ/phrases_no_exclude_train.jsonl`
- `resQ/phrases_no_exclude_test.jsonl`
- `resQ/notebooks/hybrid_resqai_training.ipynb`
- `resQ/scripts/preprocess_medqa.py`
- `resQ/scripts/combine_datasets.py`
- `resQ/scripts/inference_test.py`
- `resQ/scripts/export_gguf.py`
- `resQ/Modelfile`
- `resQ/TESTING.md`
- `resQ/train_config.yaml`
- `resQ/requirements.txt`

### Purpose of `resQ/`

It supports:

- synthetic emergency dataset creation
- MedQA clinical data preprocessing
- hybrid dataset construction
- fine-tuning Gemma 4 E2B via Unsloth/QLoRA
- exporting GGUF
- creating an Ollama model
- structured evaluation of the trained model

### Important conceptual relationship to the app

The frontend app does not train or export the model.

The frontend only consumes the model indirectly via:

- local Ollama API
- or cloud Gemini API

The `resQ/` side is how the local Ollama model was or can be produced.

## 18. Fine-Tuned Model Role vs Cloud Model Role

This distinction matters a lot and should be preserved.

### Local fine-tuned model role

The local model is intended to do:

- emergency classification
- severity estimation
- risk flag extraction
- signal extraction
- emergency condition inference
- ambulance urgency estimation

### Cloud model role

The cloud Gemini/Gemma model is intended to do:

- final reasoning
- safer output shaping
- better conversational robustness
- multimodal interpretation
- final structured user-facing step generation

This is not "fine-tuned model replaces cloud model."

This is "fine-tuned model improves domain adaptation and guides the frontier model."

## 19. Model and Prompt Safety Constraints

Prompt-level safety behavior currently includes:

- JSON-only output instruction
- no medication dosage instruction in cloud system prompt
- short, concrete steps
- life-saving actions first
- respond in same language where possible
- do not overclaim image diagnosis

Validation-level safety behavior currently includes:

- fallback when JSON is malformed
- default safe steps if `steps` is absent
- constrained severity normalization
- emergency-specific safe fallback paths for likely cardiac/choking/bleeding cases

The current implementation is practical and resilient, but it is not a medically certified system. Future work should continue to prioritize conservative safety defaults.

## 20. Known Limitations and Technical Debt

These are the main known limitations as of now.

### 20.1 Prompt builder currently does not extract rich image scene descriptions

The prompt builder supports an `imageContext` field, but the current `triageEmergency()` path does not run a separate image-description stage before calling Gemini. It simply passes the image and a generic note that an image is attached.

So multimodal support exists, but "camera observations into structured descriptive context" is only partially realized. Gemini itself sees the image. The app does not yet precompute a richer textual scene summary.

### 20.2 Some supporting features still use the old AI client

`src/lib/gemmaClient.js` is still used outside the main triage path. This is okay for now, but a future cleanup could unify all AI traffic patterns under a single service architecture.

### 20.3 Smoke tests are integration-light

The smoke harness directly tests endpoints and prompt behavior, but it is not a full browser E2E test and does not verify UI state transitions.

### 20.4 Cloud model naming still references Gemini even though conceptually the project talks about Gemma API

In code, the cloud service is implemented against the Google Generative Language API and currently defaults to `gemini-2.0-flash`. Naming across docs/prompts may still mix Gemini/Gemma terminology.

### 20.5 Lightweight backend, not a full auth platform

There is now a server-side proxy in `server/index.mjs`, which is a major security improvement over browser-side keys. But it is still intentionally lightweight:

- no auth layer
- no request rate limiting
- no structured observability
- no persistent storage

This is appropriate for demo / MVP / controlled deployment, but not yet full enterprise hardening.

## 21. Deployment Model

### Hosted deployment

Recommended split:

- frontend on Vercel or Netlify
- backend on Render, Railway, or a VM
- Ollama on the backend host or another reachable machine

Expected behavior:

- browser only calls backend `/api`
- cloud AI works if backend Gemini env vars are configured
- local Ollama works only if the backend can reach the Ollama host
- offline fallback continues to function in reduced mode

### Local demo deployment

For the hackathon/demo setup:

1. Run Ollama on laptop.
2. Create or pull the local `resqai` model.
3. Set:

```env
OLLAMA_URL=http://<laptop-lan-ip>:11434
```

4. Run the backend server on the laptop.
5. Connect phone to same Wi-Fi / hotspot.
6. Open the app from the laptop dev/preview server or deployed frontend.

In this mode, the app can use the hybrid local+cloud path.

## 22. Commands Claude Should Know

Frontend:

```bash
npm install
npm run dev:server
npm run dev
npm run build
npm run preview
npm run smoke:triage
npm run smoke:triage -- cloud
npm run smoke:triage -- ollama
```

Model-side:

```bash
cd resQ
ollama create resqai -f Modelfile
ollama run resqai
python scripts/preprocess_medqa.py --train phrases_no_exclude_train.jsonl --output_dir datasets/
python scripts/combine_datasets.py --output_dir datasets/
python scripts/inference_test.py --model_path ./exported_model/lora_adapter
python scripts/export_gguf.py --adapter_path ./exported_model/lora_adapter --hf_repo USERNAME/resqai-gemma-e2b
```

## 23. What Was Already Pushed

The repo was initialized and pushed to:

```text
https://github.com/yash4428/ResQAI.git
```

Branch:

```text
main
```

Important repo note:

`resQ/` originally existed as a nested git repository. That would have pushed as a submodule pointer, which was not desired. The nested `.git` metadata was removed from the project tree for the push so the actual `resQ` files are now committed as normal files in the main repository.

## 24. Where Claude Should Look First For Future Changes

If the task is about emergency triage inference:

1. `src/services/gemmaService.ts`
2. `src/services/ollamaService.ts`
3. `src/services/geminiService.ts`
4. `src/lib/gemmaClient.js`
5. `src/utils/promptBuilder.ts`
6. `src/utils/jsonValidator.ts`
7. `src/screens/WoundCapture.jsx`

If the task is about model behavior or local Ollama output:

1. `resQ/Modelfile`
2. `resQ/TESTING.md`
3. `resQ/README.md`
4. `resQ/train_config.yaml`
5. `resQ/scripts/inference_test.py`

If the task is about demo readiness:

1. `.env.example`
2. `DEPLOYMENT.md`
3. `src/components/AIHealthPanel.jsx`
4. `scripts/run-triage-smoke.mjs`

## 25. Short Executive Summary

The project now has:

- a functioning React/Vite emergency PWA
- a central hybrid triage orchestration layer
- local Ollama triage prior extraction
- cloud Gemini/Gemma final reasoning
- strict JSON validation and fallback logic
- UI source/mode indicators
- AI health visibility tooling
- a smoke-test harness
- full model-side assets in `resQ/`
- successful build verification
- successful push to GitHub

The most important architectural truth is:

The fine-tuned local model is not the final assistant.
It is a domain-specialized triage copilot whose structured output guides the cloud model, which remains the primary final-response engine.
