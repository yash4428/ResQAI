import { useEffect, useState } from "react";
import { useSession } from "../context/SessionContext.jsx";
import { callGemmaText } from "../lib/gemmaClient.js";
import { buildFallbackPrompt, buildLocalEmergencySummary } from "../lib/prompts.js";
import { speakInstruction, stopSpeaking } from "../lib/tts.js";

function formatTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = Math.max(totalSeconds % 60, 0).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export default function StepExecution({ currentStep, isLastStep }) {
  const { inventory, language, isMuted, failureCount, woundAssessment, dispatch } = useSession();
  const [displayStep, setDisplayStep] = useState(currentStep);
  const [remaining, setRemaining] = useState(currentStep.timer_seconds || 0);
  const [loadingFallback, setLoadingFallback] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setDisplayStep(currentStep);
    setRemaining(currentStep.timer_seconds || 0);
    setError("");
    if (!isMuted) {
      speakInstruction(currentStep.action, language, {
        critical: woundAssessment?.severity === "critical",
      });
    }
    return () => stopSpeaking();
  }, [currentStep, isMuted, language, woundAssessment?.severity]);

  useEffect(() => {
    if (!remaining) return undefined;
    const timer = window.setInterval(() => {
      setRemaining((seconds) => {
        if (seconds <= 1) {
          window.clearInterval(timer);
          if (navigator.vibrate) navigator.vibrate([300, 120, 300]);
          return 0;
        }
        return seconds - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [remaining]);

  function handleDone() {
    dispatch({ type: "NEXT_STEP" });
    if (isLastStep) {
      dispatch({ type: "SET_PHASE", payload: "report" });
    }
  }

  async function handleNotWorking() {
    setLoadingFallback(true);
    setError("");
    dispatch({ type: "STEP_FAILED" });
    try {
      const localEmergencySummary = buildLocalEmergencySummary(
        woundAssessment,
        inventory,
        `Current step failed: ${displayStep.action}`
      );
      const fallback = await callGemmaText(
        buildFallbackPrompt(displayStep, inventory, language),
        "",
        2,
        {
          localEmergencySummary,
          availableResources: inventory.map((item) => item.name).join(", "),
        }
      );
      setDisplayStep(fallback);
      setRemaining(fallback.timer_seconds || 0);
      if (!isMuted) {
        speakInstruction(fallback.action, language, {
          critical: woundAssessment?.severity === "critical",
        });
      }
    } catch (err) {
      setError(err.message || "Could not generate an alternative step.");
    } finally {
      setLoadingFallback(false);
    }
  }

  const shouldEscalate = failureCount + (loadingFallback ? 1 : 0) >= 3;

  return (
    <section className="step-card">
      {shouldEscalate && (
        <div className="alert alert--error">
          This is not improving. Call emergency services or move toward urgent medical care now.
        </div>
      )}

      <p className="step-action">{displayStep.action}</p>

      {!!displayStep.success_check && (
        <div className="success-check">
          <span>Check</span>
          {displayStep.success_check}
        </div>
      )}

      {(displayStep.timer_seconds || remaining > 0) ? (
        <div className="timer-box">{formatTime(remaining)}</div>
      ) : null}

      {error && <div className="alert alert--error">{error}</div>}

      <button className="btn btn--primary" onClick={handleDone}>
        Done — Next Step
      </button>
      <button className="btn btn--danger" onClick={handleNotWorking} disabled={loadingFallback}>
        {loadingFallback ? <span className="spinner" /> : null}
        Not Working
      </button>
    </section>
  );
}
