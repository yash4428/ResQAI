import { useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "../context/SessionContext.jsx";
import { callGemmaText, callGemmaVision, fileToBase64 } from "../lib/gemmaClient.js";
import { buildInventoryPrompt, buildLocalEmergencySummary, buildProtocolPrompt } from "../lib/prompts.js";
import { speakInstruction } from "../lib/tts.js";

const SUGGESTED_SUPPLIES = [
  "clean cloth",
  "towel",
  "water bottle",
  "tape",
  "stick",
  "bag",
  "rope",
  "plastic wrap",
];

const NO_SUPPLIES_PROMPT =
  "I could not see useful supplies clearly. Look around. Do you have any clean cloth, towel, water bottle, tape, stick, bag, rope, or plastic wrap?";

function dedupeItems(rawItems) {
  const seen = new Set();
  return rawItems
    .map((item) => (typeof item === "string" ? { name: item } : item))
    .filter((item) => {
      const name = item?.name?.trim();
      if (!name) return false;
      const key = name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export async function extractFramesFromVideo(file) {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  video.preload = "metadata";
  video.muted = true;
  video.playsInline = true;
  video.src = url;

  await new Promise((resolve, reject) => {
    video.onloadedmetadata = resolve;
    video.onerror = () => reject(new Error("Could not read the selected video."));
  });

  const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 1;
  const times = [0.1, duration * 0.25, duration * 0.5, duration * 0.75, Math.max(duration - 0.1, 0)]
    .map((time) => Math.min(Math.max(time, 0), Math.max(duration - 0.05, 0)))
    .filter((time, index, all) => all.findIndex((candidate) => Math.abs(candidate - time) < 0.2) === index)
    .slice(0, 5);

  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;

  const frames = [];
  for (const time of times) {
    await new Promise((resolve) => {
      video.onseeked = resolve;
      video.currentTime = time;
    });
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.86);
    frames.push({ base64: dataUrl.split(",")[1], mimeType: "image/jpeg" });
  }

  URL.revokeObjectURL(url);
  return frames;
}

export default function InventoryScan() {
  const { woundAssessment, language, isMuted, dispatch } = useSession();
  const [photoFrame, setPhotoFrame] = useState(null);
  const [videoFrames, setVideoFrames] = useState([]);
  const [preview, setPreview] = useState("");
  const [previewType, setPreviewType] = useState("");
  const [items, setItems] = useState([]);
  const [manualItem, setManualItem] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showNoSupplyHelp, setShowNoSupplyHelp] = useState(false);
  const videoPreviewRef = useRef(null);

  const itemNames = useMemo(
    () => items.map((item) => (typeof item === "string" ? item : item.name)).filter(Boolean),
    [items]
  );

  useEffect(() => {
    if (showNoSupplyHelp && !isMuted) {
      speakInstruction(NO_SUPPLIES_PROMPT, language);
    }
  }, [showNoSupplyHelp, isMuted, language]);

  function addItem(name) {
    setItems((current) => dedupeItems([...current, { name, description: "Added by user", confidence: "high" }]));
  }

  async function handlePhotoChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    setShowNoSupplyHelp(false);
    setPreview(URL.createObjectURL(file));
    setPreviewType("image");
    setPhotoFrame({ base64: await fileToBase64(file), mimeType: file.type || "image/jpeg" });
    setVideoFrames([]);
  }

  async function handleVideoChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setError("");
    setShowNoSupplyHelp(false);
    setPreview(URL.createObjectURL(file));
    setPreviewType("video");
    setPhotoFrame(null);
    try {
      const frames = await extractFramesFromVideo(file);
      setVideoFrames(frames);
    } catch (err) {
      setError(err.message || "Could not read video. Use photo or manual add.");
    } finally {
      setLoading(false);
    }
  }

  async function handleScan() {
    const frames = videoFrames.length ? videoFrames : photoFrame ? [photoFrame] : [];
    if (!frames.length) return;

    setLoading(true);
    setError("");
    setShowNoSupplyHelp(false);

    const results = await Promise.all(
      frames.map(async (frame) => {
        try {
          const result = await callGemmaVision(buildInventoryPrompt(), frame.base64, frame.mimeType);
          return Array.isArray(result.items) ? result.items : [];
        } catch {
          return [];
        }
      })
    );

    const mergedItems = dedupeItems(results.flat());
    setItems(mergedItems);
    setShowNoSupplyHelp(mergedItems.length === 0);
    setLoading(false);
  }

  function addManualItem() {
    const name = manualItem.trim();
    if (!name) return;
    addItem(name);
    setManualItem("");
  }

  function removeItem(name) {
    setItems((current) => current.filter((item) => (item.name || item) !== name));
  }

  async function confirmItems() {
    if (!itemNames.length) {
      setShowNoSupplyHelp(true);
      setError("Add at least one available item before generating a protocol.");
      return;
    }
    setLoading(true);
    setError("");
    const inventory = itemNames.map((name) => ({ name }));
    dispatch({ type: "SET_INVENTORY", payload: inventory });
    try {
      const localEmergencySummary = buildLocalEmergencySummary(
        woundAssessment,
        inventory,
        "Generate first-aid protocol using only the listed supplies."
      );
      const protocol = await callGemmaText(
        buildProtocolPrompt(woundAssessment, inventory, language),
        "",
        2,
        {
          localEmergencySummary,
          availableResources: itemNames.join(", "),
        }
      );
      dispatch({ type: "SET_PROTOCOL", payload: protocol });
      dispatch({ type: "SET_PHASE", payload: "protocol" });
    } catch (err) {
      setError(err.message || "Could not generate the protocol. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const canScan = (videoFrames.length > 0 || photoFrame) && !loading;

  return (
    <div className="screen fade-in">
      <section className="screen-header">
        <div className="eyebrow">Step 2 of 4</div>
        <h2>Scan Supplies</h2>
        <p>Record everything around you: cloth, bottles, sticks, bags, tape, rope, or plastic wrap.</p>
      </section>

      <label className="file-picker file-picker--primary">
        <input type="file" accept="video/*" capture="environment" onChange={handleVideoChange} />
        Record Short Supply Video
      </label>

      <label className="file-picker">
        <input type="file" accept="image/*" capture="environment" onChange={handlePhotoChange} />
        Use Photo Instead
      </label>

      {preview && previewType === "video" && (
        <video ref={videoPreviewRef} className="image-preview" src={preview} controls playsInline />
      )}
      {preview && previewType === "image" && (
        <img className="image-preview" src={preview} alt="Available supplies" />
      )}

      <button className="btn btn--primary" onClick={handleScan} disabled={!canScan}>
        {loading ? <span className="spinner" /> : null}
        Scan Supplies
      </button>

      {showNoSupplyHelp && (
        <div className="card supply-help">
          <p>{NO_SUPPLIES_PROMPT}</p>
          <div className="chip-list">
            {SUGGESTED_SUPPLIES.map((name) => (
              <button key={name} className="chip" onClick={() => addItem(name)}>
                {name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="manual-row">
        <input
          className="text-input"
          value={manualItem}
          onChange={(event) => setManualItem(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && addManualItem()}
          placeholder="Add an item if the scan missed it"
        />
        <button className="btn btn--secondary compact-btn" onClick={addManualItem}>Add</button>
      </div>

      <div className="chip-list">
        {itemNames.map((name) => (
          <button key={name} className="chip" onClick={() => removeItem(name)} title="Remove item">
            {name}<span aria-hidden="true"> x</span>
          </button>
        ))}
      </div>

      {error && <div className="alert alert--error">{error}</div>}

      <button className="btn btn--primary" onClick={confirmItems} disabled={loading || !itemNames.length}>
        Confirm Items
      </button>
    </div>
  );
}
