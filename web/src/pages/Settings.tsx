import { useEffect, useState } from "react";
import { api } from "../api/client";
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
  const [actor, setActor] = useState<(ActorSummary & { discoverable: boolean }) | null>(null);
  const [interests, setInterests] = useState<InterestRow[]>([]);

  async function refresh() {
    const [settings, list] = await Promise.all([api.getActorSettings(), api.listInterests()]);
    setActor(settings);
    setInterests(list);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleDiscoverableChange(discoverable: boolean) {
    await api.setDiscoverable(discoverable);
    setActor((a) => (a ? { ...a, discoverable } : a));
  }

  async function handleVisibilityChange(interestId: string, visibility: Visibility) {
    await api.setInterestVisibility(interestId, visibility);
    setInterests((list) => list.map((i) => (i.id === interestId ? { ...i, visibility } : i)));
  }

  return (
    <div style={{ maxWidth: 560 }}>
      <h1 style={{ fontSize: "var(--fs-xl)", color: "var(--ink-900)", marginBottom: 8 }}>Settings</h1>

      <Section title="Profile">
        <p style={{ fontSize: "var(--fs-base)", color: "var(--ink-900)" }}>{actor?.displayName}</p>
      </Section>

      <Section title="Interests">
        <InterestEditor defaultStance="established" showStanceSelector onSubmitted={refresh} />
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
