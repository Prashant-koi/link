import { useRef, useState } from "react";
import { api } from "../api/client";
import { ImportCard, buttonStyle, inputStyle, secondaryButtonStyle } from "./ImportCard";
import type { ImportKind } from "../types/api";

// Resume and LinkedIn are the same interaction with different words: a file
// or some pasted text goes in, bio_extract turns it into raw interest
// strings, and those resolve through the normal pipeline.
export function DocumentImport({
  actorId,
  kind,
  title,
  blurb,
  placeholder,
  accept,
  onSubmitted,
}: {
  actorId: string;
  kind: ImportKind;
  title: string;
  blurb: string;
  placeholder: string;
  accept: string;
  onSubmitted: () => void;
}) {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [origin, setOrigin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function handleSubmit() {
    if (!actorId || busy) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      if (file) {
        // Read the file in the browser and send it as base64 in the JSON
        // body — the API has no multipart middleware, and a resume is small.
        const contentBase64 = await fileToBase64(file);
        await api.createImport({
          actorId,
          kind,
          filename: file.name,
          contentBase64,
          origin: origin.trim() || file.name,
        });
      } else {
        await api.createImport({ actorId, kind, text: text.trim(), origin: origin.trim() || "pasted" });
      }
      setNote("Queued — watch it fill in below.");
      setText("");
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      onSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const canSubmit = Boolean(actorId) && (Boolean(file) || text.trim().length > 0);

  return (
    <ImportCard title={title} blurb={blurb} busy={busy} error={error} note={note}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          ref={fileInput}
          type="file"
          accept={accept}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          style={{ fontSize: "var(--fs-sm)", color: "var(--ink-600)" }}
        />
        {file && (
          <button type="button" style={secondaryButtonStyle} onClick={() => {
            setFile(null);
            if (fileInput.current) fileInput.current.value = "";
          }}>
            Clear
          </button>
        )}
      </div>

      {kind === "linkedin" && (
        <input
          value={origin}
          onChange={(e) => setOrigin(e.target.value)}
          placeholder="linkedin.com/in/… (optional, recorded as the source)"
          style={inputStyle}
        />
      )}

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        rows={5}
        disabled={Boolean(file)}
        style={{ ...inputStyle, resize: "vertical", opacity: file ? 0.5 : 1 }}
      />

      <div>
        <button type="button" style={{ ...buttonStyle, opacity: canSubmit && !busy ? 1 : 0.5 }} disabled={!canSubmit || busy} onClick={handleSubmit}>
          {busy ? "Uploading…" : "Import"}
        </button>
      </div>
    </ImportCard>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`could not read ${file.name}`));
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(",") + 1)); // strip the data: prefix
    };
    reader.readAsDataURL(file);
  });
}
