import { useEffect, useState } from "react";
import { useSession } from "../context/SessionContext.jsx";
import { callGemmaText } from "../lib/gemmaClient.js";
import { buildReportPrompt } from "../lib/prompts.js";

export default function HospitalReport() {
  const { session, incidentReport, dispatch } = useSession();
  const [loading, setLoading] = useState(!incidentReport);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function generateReport() {
      if (incidentReport) return;
      setLoading(true);
      setError("");
      try {
        const report = await callGemmaText(buildReportPrompt(session), "", 2, { useLocalPriors: false });
        if (active) dispatch({ type: "SET_REPORT", payload: report });
      } catch (err) {
        if (active) setError(err.message || "Could not generate the hospital report.");
      } finally {
        if (active) setLoading(false);
      }
    }
    generateReport();
    return () => {
      active = false;
    };
  }, [dispatch, incidentReport, session]);

  const report = incidentReport;
  const copyText = report
    ? [
        `Summary: ${report.summary}`,
        `Steps performed: ${(report.steps_performed || []).join("; ")}`,
        `Warnings: ${(report.warnings || []).join("; ")}`,
        `Estimated blood loss: ${report.estimated_blood_loss || "Unknown"}`,
      ].join("\n")
    : "";

  return (
    <div className="screen fade-in">
      <section className="screen-header">
        <div className="eyebrow">Step 4 of 4</div>
        <h2>Hospital Handoff</h2>
        <p>Report is generated in English for medical staff.</p>
      </section>

      {loading && <div className="card center-card"><span className="spinner" /> Generating report...</div>}
      {error && <div className="alert alert--error">{error}</div>}

      {report && (
        <article className="card report-card">
          <h3>Emergency Incident Report</h3>
          <ReportSection title="Summary" content={report.summary} />
          <ReportSection title="Steps Performed" list={report.steps_performed} />
          <ReportSection title="Warnings" list={report.warnings} />
          <ReportSection title="Estimated Blood Loss" content={report.estimated_blood_loss} />
        </article>
      )}

      <button className="btn btn--primary" onClick={() => navigator.clipboard?.writeText(copyText)} disabled={!report}>
        Copy Report
      </button>
      <button className="btn btn--secondary" onClick={() => dispatch({ type: "RESET_SESSION" })}>
        Start New Emergency
      </button>
    </div>
  );
}

function ReportSection({ title, content, list }) {
  return (
    <section>
      <h4>{title}</h4>
      {list ? (
        <ul>{list.map((item) => <li key={item}>{item}</li>)}</ul>
      ) : (
        <p>{content || "Unknown"}</p>
      )}
    </section>
  );
}
