# ResqAI Deployment Guide

This app now uses a split architecture:

- `frontend`: React + Vite PWA
- `backend`: lightweight Node API in `server/index.mjs`
- `local model`: Ollama model named `resqai`
- `cloud model`: Gemini, accessed only from the backend

## Architecture

```text
Browser
  -> /api/*
Backend server
  -> Ollama (local fine-tuned triage prior)
  -> Gemini API (final reasoning / vision)
```

The browser should never hold your Gemini API key.

## Environment Variables

Use these in `.env` for local development:

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

Notes:

- `GEMMA_MODE=hybrid` means use Ollama priors plus Gemini final reasoning.
- `VITE_API_BASE_URL=` empty means the frontend uses same-origin `/api` in local dev through the Vite proxy.
- If frontend and backend are deployed separately, set `VITE_API_BASE_URL` to your backend URL.

## Local Development

1. Start Ollama and ensure your model exists:

```bash
ollama list
ollama run resqai
```

2. Start the backend:

```bash
npm run dev:server
```

3. Start the frontend:

```bash
npm run dev
```

4. Open:

```text
http://localhost:5173
```

## Production Deployment

Recommended split:

- Frontend: Vercel or Netlify
- Backend: Render or Railway
- Ollama: your own VM, GPU server, or same backend host if feasible

### Option A: Vercel + Render

Use this when:

- you want the simplest frontend hosting
- you want a separate backend service

#### Frontend on Vercel

Build settings:

- Framework: `Vite`
- Build command: `npm run build`
- Output directory: `dist`

Frontend env:

```env
VITE_API_BASE_URL=https://your-backend.onrender.com
```

#### Backend on Render

Service type:

- Web Service

Build command:

```bash
npm install
```

Start command:

```bash
npm run start:server
```

Backend env:

```env
GEMINI_API_KEY=your_google_ai_studio_key
GEMINI_MODEL=gemini-2.5-flash
GEMMA_MODE=hybrid
OLLAMA_URL=http://your-ollama-host:11434
OLLAMA_MODEL=resqai
OLLAMA_TIMEOUT_MS=1800
API_PORT=8787
ALLOWED_ORIGIN=https://your-frontend.vercel.app
```

Important:

- Render must be able to reach your Ollama host over the network.
- If Ollama runs on a private laptop, Render will not be able to reach it.

### Option B: Railway

Use this when:

- you want backend hosting similar to Render
- you prefer a simpler env-var workflow

Frontend:

- same approach as Vercel or Netlify

Backend:

- deploy this repo
- start command: `npm run start:server`

Backend env:

- same as Render

### Option C: Single VM

Use this when:

- you want the cleanest local-model deployment
- you control one server that can run both backend and Ollama

Recommended setup:

1. Install Node.js
2. Install Ollama
3. Create the model:

```bash
cd resQ
ollama create resqai -f Modelfile
```

4. Run Ollama
5. Run the backend with `npm run start:server`
6. Serve the built frontend with Nginx, Caddy, or a static host

This is often the easiest way to keep the backend and Ollama connected.

## Hugging Face + Ollama Workflow

If your teammate needs the model:

1. Push the GGUF to Hugging Face
2. Share the Hugging Face repo
3. Teammate downloads the GGUF
4. Teammate places it next to `resQ/Modelfile`
5. Teammate runs:

```bash
cd resQ
ollama create resqai -f Modelfile
ollama run resqai
```

The app expects the Ollama model name to be `resqai`.

## Verification Checklist

Before demoing or deploying, verify:

1. `npm run build` passes
2. `node --check server/index.mjs` passes
3. `ollama run resqai` works
4. backend `GET /api/health` returns `localReady` and `cloudConfigured`
5. the frontend `AI Health` panel shows the expected mode

## Common Failure Modes

`Cloud missing key`

- set `GEMINI_API_KEY` on the backend, not `VITE_GEMMA_API_KEY` in the browser

`Local unavailable`

- Ollama is not running
- the `resqai` model was not created
- `OLLAMA_URL` is wrong
- backend cannot reach Ollama over the network

`Frontend works locally but not after deployment`

- `VITE_API_BASE_URL` still points to local dev
- `ALLOWED_ORIGIN` does not include your frontend domain
- backend host cannot reach Ollama

`Vision features fail in local-only mode`

- vision still requires Gemini
- use `GEMMA_MODE=hybrid` for the full product
