import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useMe } from "../hooks/useMe";
import { InterestEditor } from "../components/InterestEditor";
import type { ActorSummary, InterestRow, Visibility } from "../types/api";

const VISIBILITY_OPTIONS: Visibility[] = ["public", "institution", "private"];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ display: "grid", gap: 12, paddingBlock: 24, borderBottom: "1px solid var(--ink-200)" }}>
      <h2 style={{ fontSize: "var(--fs-lg)", color: "var(--ink-900)" }}>{title}</h2>
      {children}
    </section>
  );
}

export function Settings() {
  const [me, setMe] = useMe();
  const [meInput, setMeInput] = useState(me);
  const [actor, setActor] = useState<(ActorSummary & { discoverable: boolean }) | null>(null);
  const [interests, setInterests] = useState<InterestRow[]>([]);

  async function refresh(id: string) {
    const [settings, list] = await Promise.all([api.getActorSettings(id), api.listInterests(id)]);
    setActor(settings);
    setInterests(list);
  }

  useEffect(() => {
    if (me) refresh(me);
  }, [me]);

  async function handleDiscoverableChange(discoverable: boolean) {
    if (!me) return;
    await api.setDiscoverable(me, discoverable);
    setActor((a) => (a ? { ...a, discoverable } : a));
  }

  async function handleVisibilityChange(interestId: string, visibility: Visibility) {
    if (!me) return;
    await api.setInterestVisibility(me, interestId, visibility);
    setInterests((list) => list.map((i) => (i.id === interestId ? { ...i, visibility } : i)));
  }

  return (
    <div style={{ maxWidth: 560 }}>
      <h1 style={{ fontSize: "var(--fs-xl)", color: "var(--ink-900)", marginBottom: 8 }}>Settings</h1>

      <Section title="Profile">
        {/* Auth is unresolved in the backend — this stands in for a login. */}
        <label style={{ display: "grid", gap: 4, fontSize: "var(--fs-sm)", color: "var(--ink-600)" }}>
          Your actor ID
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={meInput}
              onChange={(e) => setMeInput(e.target.value)}
              placeholder="actor uuid"
              style={{
                flex: 1,
                fontSize: "var(--fs-base)",
                padding: "8px 12px",
                border: "1px solid var(--ink-200)",
                borderRadius: 8,
              }}
            />
            <button
              onClick={() => setMe(meInput.trim())}
              style={{
                background: "var(--tq-600)",
                color: "var(--surface)",
                border: "none",
                borderRadius: 8,
                padding: "8px 16px",
                fontSize: "var(--fs-sm)",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Save
            </button>
          </div>
        </label>
        {actor && (
          <p style={{ fontSize: "var(--fs-base)", color: "var(--ink-900)" }}>{actor.displayName}</p>
        )}
      </Section>

      <Section title="Interests">
        {me && (
          <InterestEditor actorId={me} defaultStance="established" showStanceSelector onSubmitted={() => refresh(me)} />
        )}
        <div style={{ display: "grid", gap: 8 }}>
          {interests.map((interest) => (
            <div
              key={interest.id}
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}
            >
              <span style={{ fontSize: "var(--fs-sm)", color: interest.resolved ? "var(--ink-900)" : "var(--ink-500)" }}>
                {interest.conceptLabel ?? interest.rawText}
                <span style={{ color: "var(--ink-500)" }}> · {interest.stance}</span>
              </span>
              <select
                value={interest.visibility}
                onChange={(e) => handleVisibilityChange(interest.id, e.target.value as Visibility)}
                style={{
                  fontSize: "var(--fs-xs)",
                  border: "1px solid var(--ink-200)",
                  borderRadius: 6,
                  padding: "2px 6px",
                }}
              >
                {VISIBILITY_OPTIONS.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Visibility">
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "var(--fs-base)" }}>
          <input
            type="checkbox"
            checked={actor?.discoverable ?? false}
            onChange={(e) => handleDiscoverableChange(e.target.checked)}
          />
          Discoverable — show me as a suggestion to others
        </label>
      </Section>
    </div>
  );
}
