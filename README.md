# ResqAI

ResqAI is an emergency first-aid PWA with a hybrid inference stack:

- local fine-tuned Ollama model for emergency triage priors
- Gemini for final reasoning and vision features
- a lightweight backend proxy so keys are not exposed in the browser

## Repo Layout

- `src/`: React + Vite frontend
- `server/`: backend API proxy
- `resQ/`: model training, export, GGUF, and Ollama assets
- `DEPLOYMENT.md`: deployment and hosting guide
- `CLAUDE_HANDOFF.md`: detailed technical handoff

## Current Runtime Flow

```text
User input
-> frontend
-> backend /api
-> local Ollama triage prior if available
-> Gemini final response
-> validated JSON shown in UI
```

Vision features still use Gemini through the backend. The fine-tuned GGUF is a text triage model, so it is used where it helps most.

## Local Development

1. Create `.env` from `.env.example`
2. Start Ollama and make sure the model name is `resqai`
3. Start the backend:

```bash
npm run dev:server
```

4. Start the frontend:

```bash
npm run dev
```

5. Open `http://localhost:5173`

## Scripts

```bash
npm run dev
npm run dev:server
npm run start:server
npm run build
npm run preview
npm run smoke:triage
```

## Model Workflow

The model-side workflow is documented in [resQ/README.md](/Users/yashaggarwal/Desktop/ResqAI-main/resQ/README.md:1).

At a high level:

1. Train / export GGUF from `resQ/`
2. Create the Ollama model:

```bash
cd resQ
ollama create resqai -f Modelfile
```

3. Run the app against that model through the backend

## Deployment

See [DEPLOYMENT.md](/Users/yashaggarwal/Desktop/ResqAI-main/DEPLOYMENT.md:1) for:

- Vercel + Render
- Railway
- single-VM deployment
- Hugging Face + Ollama sharing workflow
