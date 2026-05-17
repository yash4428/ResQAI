import { useEffect, useState } from "react";
import { apiGet, getApiBaseLabel } from "../lib/apiClient.js";
import { isOllamaAvailable } from "../services/ollamaService";

function StatusPill({ label, status }) {
  return (
    <span className={`health-pill health-pill--${status}`}>
      <span className="health-pill__dot" />
      {label}
    </span>
  );
}

export default function AIHealthPanel() {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [localReady, setLocalReady] = useState(false);
  const [cloudConfigured, setCloudConfigured] = useState(false);
  const [backendMode, setBackendMode] = useState("hybrid");
  const [lastChecked, setLastChecked] = useState("");

  const offlineReady = true;
  const isOnline = navigator.onLine;

  useEffect(() => {
    refreshHealth();

    const handleOnline = () => refreshHealth();
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, []);

  async function refreshHealth() {
    setLoading(true);
    try {
      const [available, health] = await Promise.all([
        isOllamaAvailable(),
        apiGet("/api/health"),
      ]);
      setLocalReady(available);
      setCloudConfigured(Boolean(health?.cloudConfigured));
      setBackendMode(String(health?.mode || "hybrid"));
    } catch {
      setLocalReady(false);
      setCloudConfigured(false);
    } finally {
      setLastChecked(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
      setLoading(false);
    }
  }

  const overallStatus = localReady ? "ok" : cloudConfigured ? "cloud" : "fallback";

  return (
    <div className={`health-panel health-panel--${expanded ? "open" : "closed"}`}>
      <button
        type="button"
        className={`health-panel__trigger health-panel__trigger--${overallStatus}`}
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
      >
        <span className="health-panel__trigger-dot" />
        AI Health
      </button>

      {expanded && (
        <div className="health-panel__card">
          <div className="health-panel__row">
            <strong>Inference status</strong>
            <button type="button" className="health-panel__refresh" onClick={refreshHealth} disabled={loading}>
              {loading ? "Checking..." : "Refresh"}
            </button>
          </div>

          <div className="health-panel__pills">
            <StatusPill label={localReady ? "Local ready" : "Local unavailable"} status={localReady ? "ok" : "muted"} />
            <StatusPill label={cloudConfigured ? "Cloud configured" : "Cloud missing key"} status={cloudConfigured ? "cloud" : "warn"} />
            <StatusPill label={offlineReady ? "Offline fallback ready" : "Offline missing"} status={offlineReady ? "fallback" : "warn"} />
          </div>

          <div className="health-panel__meta">
            <span>Network: {isOnline ? "online" : "offline"}</span>
            <span>API: {getApiBaseLabel()}</span>
            <span>Mode: {backendMode}</span>
            <span>Last checked: {lastChecked || "not yet"}</span>
          </div>
        </div>
      )}
    </div>
  );
}
