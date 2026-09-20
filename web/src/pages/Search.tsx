import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { AiBadge } from "../components/AiBadge";
import { PersonPanel } from "../components/PersonPanel";
import { buttonStyle, secondaryButtonStyle } from "../components/ImportCard";
import type { ActorSummary, MatchKind, SmartGroup, SmartMatched, SmartPerson, SmartSearchResult } from "../types/api";

const SECTIONS: { kind: MatchKind; title: string }[] = [
  { kind: "mentor", title: "People who have done this" },
  { kind: "peer", title: "People figuring it out right now" },
  { kind: "fellow_explorer", title: "People considering the same jump" },
];

const GROUP_LABEL: Record<SmartGroup["groupKind"], string> = { club: "Club", lab: "Lab", department: "Department" };

const EXAMPLES = ["physics", "someone who plays jazz and codes", "healthcare", "people who build robots", "sports"];

// Phase 1 is instant and never waits on the model; phase 2 (the local model reading
// the query — splitting "X and Y", fixing typos, picking the fitting topics) arrives
// a few seconds later and quietly replaces it. If it fails, phase 1 simply stays.
export function Search() {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<SmartSearchResult | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "refining" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ actor: ActorSummary; reasons: SmartPerson["reasons"] } | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const run = useRef(0);
  const abort = useRef<AbortController | null>(null);

  // AI descriptions for the three strongest results, tailored to the query. Fetched
  // whenever those three (or the query) change — first after the instant results, again
  // if the AI refinement reorders them; identical requests are cached server-side.
  const [blurbs, setBlurbs] = useState<Record<string, string>>({});
  const [blurbFor, setBlurbFor] = useState<string | null>(null); // key of the request in flight or done
  const [blurbLoading, setBlurbLoading] = useState(false);
  const blurbAbort = useRef<AbortController | null>(null);

  const top3 = (result?.people ?? [])
    .slice()
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((p) => p.actor.id);
  const top3Key = result ? `${result.query}|${top3.join(",")}` : "";

  useEffect(() => {
    if (!result || top3.length === 0 || top3Key === blurbFor) return;
    blurbAbort.current?.abort();
    const controller = new AbortController();
    blurbAbort.current = controller;
    setBlurbFor(top3Key);
    setBlurbLoading(true);
    // Keep any blurb we already have for someone who is still in the top three.
    setBlurbs((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => top3.includes(id))));
    api
      .searchBlurbs(result.correctedQuery ?? result.query, top3, controller.signal)
      .then((b) => {
        if (controller.signal.aborted) return;
        if (b) setBlurbs((prev) => ({ ...prev, ...b }));
        setBlurbLoading(false);
      })
      .catch(() => !controller.signal.aborted && setBlurbLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [top3Key]);

  useEffect(
    () => () => {
      abort.current?.abort();
      blurbAbort.current?.abort();
    },
    [],
  );

  async function search(raw: string) {
    const q = raw.trim();
    if (!q) return;
    const id = ++run.current;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setQuery(q);
    setError(null);
    setAdded(null);
    setSelected(null);
    setResult(null);
    setBlurbs({});
    setBlurbFor(null);
    blurbAbort.current?.abort();
    setState("loading");
    try {
      const first = await api.searchSmart(q, false, controller.signal);
      if (id !== run.current) return;
      setResult(first);
      setState("refining");
      const refined = await api.searchSmart(q, true, controller.signal).catch(() => null);
      if (id !== run.current) return;
      if (refined) setResult(refined);
    } catch (e) {
      if ((e as Error).name === "AbortError" || id !== run.current) return;
      setError("Search didn't work just now. Try again.");
    }
    if (id === run.current) setState("done");
  }

  async function addToInterests() {
    if (!result) return;
    const text = result.correctedQuery ?? result.query;
    await api.postInterest(text, "aspiring");
    setAdded(text);
  }

  const people = result?.people ?? [];
  const nothing = state !== "loading" && result && people.length === 0 && result.groups.length === 0 && result.nameMatches.length === 0;
  const topics = result?.facets.flatMap((f) => f.topics).filter((t, i, all) => all.findIndex((x) => x.conceptId === t.conceptId) === i) ?? [];

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          search(query);
        }}
        style={{ maxWidth: 620, margin: "40px auto 0", textAlign: "center" }}
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search anything — a topic, a hobby, or a question"
          aria-label="Search"
          style={{
            width: "100%",
            fontSize: "var(--fs-lg)",
            textAlign: "center",
            padding: "12px 16px",
            border: "1px solid var(--ink-200)",
            borderRadius: 12,
            background: "var(--surface)",
          }}
        />
      </form>

      {state === "idle" && (
        <div style={{ maxWidth: 620, margin: "20px auto 0", textAlign: "center", display: "grid", gap: 10 }}>
          <p style={{ fontSize: "var(--fs-sm)", color: "var(--ink-500)" }}>Try one of these, or ask in your own words.</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
            {EXAMPLES.map((e) => (
              <button key={e} style={secondaryButtonStyle} onClick={() => search(e)}>
                {e}
              </button>
            ))}
          </div>
        </div>
      )}

      {state !== "idle" && (
        <div style={{ maxWidth: 720, margin: "20px auto 0", display: "grid", gap: 8, textAlign: "center" }}>
          {state === "loading" && <p style={{ color: "var(--ink-500)" }}>Searching…</p>}
          {result && (
            <>
              {result.correctedQuery && (
                <p style={{ fontSize: "var(--fs-sm)", color: "var(--ink-600)" }}>
                  Showing results for <strong>{result.correctedQuery}</strong> (you typed “{result.query}”)
                </p>
              )}
              <p style={{ fontSize: "var(--fs-base)", color: "var(--ink-900)" }}>
                {result.interpretation ? (
                  <>
                    <span aria-hidden="true" style={{ color: "var(--tq-600)" }}>
                      ✦{" "}
                    </span>
                    {result.interpretation}
                  </>
                ) : (
                  <>Showing people connected to “{result.query}” and related topics.</>
                )}
              </p>
              {state === "refining" && <p style={{ fontSize: "var(--fs-xs)", color: "var(--ink-500)" }}>Refining with AI…</p>}
              {result.unmatchedFacets.length > 0 && (
                <p style={{ fontSize: "var(--fs-sm)", color: "var(--ink-500)" }}>
                  Nobody lists {result.unmatchedFacets.map((f) => `“${f}”`).join(", ")} yet — showing the rest of your search.
                </p>
              )}
              {topics.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "center", marginTop: 4 }} aria-label="Related topics">
                  {topics.slice(0, 10).map((t) => (
                    <button
                      key={t.conceptId}
                      onClick={() => search(t.label)}
                      title={t.via ? `${t.kind === "narrower" ? "Part of" : "Related to"} ${t.via}` : "Search this topic"}
                      style={{
                        fontSize: "var(--fs-sm)",
                        padding: "2px 10px",
                        borderRadius: 999,
                        border: "1px solid var(--tq-300)",
                        background: "var(--tq-050)",
                        color: "var(--tq-700)",
                        cursor: "pointer",
                        font: "inherit",
                      }}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              )}
              {!nothing && (
                <div style={{ marginTop: 6 }}>
                  {added ? (
                    <span style={{ fontSize: "var(--fs-sm)", color: "var(--ink-500)" }}>Added “{added}” to your interests.</span>
                  ) : (
                    <button style={secondaryButtonStyle} onClick={addToInterests}>
                      Add “{result.correctedQuery ?? result.query}” to my interests
                    </button>
                  )}
                </div>
              )}
            </>
          )}
          {error && <p style={{ color: "#b3261e" }}>{error}</p>}
        </div>
      )}

      {nothing && (
        <div style={{ maxWidth: 560, margin: "32px auto 0", textAlign: "center", display: "grid", gap: 12 }}>
          <p style={{ color: "var(--ink-600)" }}>
            No one matches “{result?.query}” yet. Try a broader word, or add it to your interests so people can find you.
          </p>
          <div>
            <button style={buttonStyle} onClick={addToInterests}>
              Add “{result?.query}” to my interests
            </button>
          </div>
        </div>
      )}

      <div style={{ marginTop: 32, display: "grid", gap: 32, maxWidth: 720, marginInline: "auto" }}>
        {(result?.nameMatches.length ?? 0) > 0 && (
          <Section title="People with that name">
            {result!.nameMatches.map((a) => (
              <Card key={a.id} onOpen={() => setSelected({ actor: a, reasons: [] })} label={`Open details for ${a.displayName}`}>
                <div style={{ fontSize: "var(--fs-base)", color: "var(--ink-900)" }}>{a.displayName}</div>
                <div style={{ fontSize: "var(--fs-sm)", color: "var(--ink-500)" }}>
                  {[a.personKind, a.homeUnit?.name].filter(Boolean).join(" · ")}
                </div>
              </Card>
            ))}
          </Section>
        )}

        {SECTIONS.map((section) => {
          const items = people.filter((p) => p.matchKind === section.kind);
          if (items.length === 0) return null;
          return (
            <Section key={section.kind} title={section.title}>
              {items.map((p) => (
                <Card key={p.actor.id} onOpen={() => setSelected({ actor: p.actor, reasons: p.reasons })} label={`Open details for ${p.actor.displayName}`}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                    <span style={{ fontSize: "var(--fs-base)", color: "var(--ink-900)" }}>{p.actor.displayName}</span>
                    <span style={{ fontSize: "var(--fs-xs)", color: "var(--ink-500)" }}>
                      {[p.actor.personKind, p.actor.homeUnit?.name].filter(Boolean).join(" · ")}
                    </span>
                  </div>
                  {top3.includes(p.actor.id) && (blurbs[p.actor.id] || blurbLoading) && (
                    <div style={{ display: "grid", gap: 4, padding: "8px 10px", borderRadius: 8, background: "var(--tq-050)", border: "1px solid var(--tq-100)" }}>
                      <span>
                        <AiBadge />
                      </span>
                      {blurbs[p.actor.id] ? (
                        <span style={{ fontSize: "var(--fs-sm)", color: "var(--ink-900)", lineHeight: 1.5 }}>{blurbs[p.actor.id]}</span>
                      ) : (
                        <span className="ai-shimmer" style={{ display: "block", height: 34, borderRadius: 6 }} aria-label="Writing a description" />
                      )}
                    </div>
                  )}
                  <Matched items={p.matched} />
                </Card>
              ))}
            </Section>
          );
        })}
        {result && result.totalPeople > people.length && (
          <p style={{ textAlign: "center", fontSize: "var(--fs-sm)", color: "var(--ink-500)" }}>
            {result.totalPeople} people match; showing the strongest in each group. Narrow it with a topic above.
          </p>
        )}

        {(result?.groups.length ?? 0) > 0 && (
          <Section title="Clubs, labs & departments">
            {result!.groups.map((g) => (
              <div
                key={g.actor.id}
                style={{ border: "1px solid var(--ink-200)", borderRadius: 10, padding: 16, background: "var(--surface)", display: "grid", gap: 6 }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                  <span style={{ fontSize: "var(--fs-base)", color: "var(--ink-900)" }}>{g.actor.displayName}</span>
                  <span style={{ fontSize: "var(--fs-xs)", color: "var(--ink-500)" }}>
                    {GROUP_LABEL[g.groupKind]}
                    {g.members > 0 ? ` · ${g.members} member${g.members === 1 ? "" : "s"}` : ""}
                  </span>
                </div>
                <Matched items={g.matched} />
              </div>
            ))}
          </Section>
        )}
      </div>

      {selected && <PersonPanel actor={selected.actor} reasons={selected.reasons} onClose={() => setSelected(null)} />}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 style={{ fontSize: "var(--fs-lg)", color: "var(--ink-900)", marginBottom: 12 }}>{title}</h2>
      <div style={{ display: "grid", gap: 12 }}>{children}</div>
    </div>
  );
}

function Card({ children, onOpen, label }: { children: React.ReactNode; onOpen: () => void; label: string }) {
  return (
    <button
      onClick={onOpen}
      aria-label={label}
      style={{
        border: "1px solid var(--ink-200)",
        borderRadius: 10,
        padding: 16,
        background: "var(--surface)",
        textAlign: "left",
        cursor: "pointer",
        font: "inherit",
        width: "100%",
        display: "grid",
        gap: 6,
      }}
    >
      {children}
    </button>
  );
}

// Why this matched: the topic, and how it relates to what was searched.
function Matched({ items }: { items: SmartMatched[] }) {
  if (items.length === 0) return null;
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 }}>
      {items.map((m) => (
        <li key={m.conceptId} style={{ fontSize: "var(--fs-sm)", color: "var(--ink-600)" }}>
          <span
            style={{ display: "inline-block", padding: "0 8px", borderRadius: 999, background: "var(--tq-100)", color: "var(--tq-700)", marginRight: 6 }}
          >
            {m.label}
          </span>
          {m.note}
        </li>
      ))}
    </ul>
  );
}
