const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");

function buildUrl(path) {
  if (!path.startsWith("/")) {
    throw new Error(`API path must start with "/": ${path}`);
  }
  return `${API_BASE_URL}${path}`;
}

export async function apiGet(path, options = {}) {
  const response = await fetch(buildUrl(path), {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
    ...options,
  });

  return parseJsonResponse(response);
}

export async function apiPost(path, body, options = {}) {
  const response = await fetch(buildUrl(path), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(options.headers || {}),
    },
    body: JSON.stringify(body || {}),
    ...options,
  });

  return parseJsonResponse(response);
}

export function getApiBaseLabel() {
  return API_BASE_URL || "same-origin /api";
}

async function parseJsonResponse(response) {
  const text = await response.text();
  const data = text ? safeJsonParse(text) : {};

  if (!response.ok) {
    const errorMessage =
      (data && typeof data === "object" && data.error) ||
      `Request failed with status ${response.status}`;
    throw new Error(String(errorMessage));
  }

  return data;
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON response: ${text.slice(0, 300)}`);
  }
}
