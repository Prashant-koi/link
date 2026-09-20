import type {
  ActorSummary,
  AtlasResponse,
  BridgeSuggestion,
  CourseOffering,
  EventSuggestion,
  ImportKind,
  ImportSummary,
  AskSummary,
  AspirationMatch,
  SmartSearchResult,
  ConnectionSuggestion,
  Cursor,
  InterestRow,
  Reason,
  Stance,
  Visibility,
} from "../types/api";
import { fixtures } from "../home/fixtures";

const BASE = "/api";

/**
 * Fixture mode. The real stack needs Postgres and Ollama, so `?fixtures=1` (or
 * VITE_FIXTURES=1 at build time) swaps the whole client for a canned dataset.
 * The switch lives here and nowhere else: AuthContext, the route guard and
 * every page work unmodified, and the production path is one early branch.
 */
export const USING_FIXTURES: boolean = (() => {
  try {
    if (new URLSearchParams(window.location.search).get("fixtures") === "1") return true;
  } catch {
    // No window (SSR, a test runner) — fall through to the build-time flag.
  }
  return import.meta.env.VITE_FIXTURES === "1";
})();

// credentials: 'include' so the signed session cookie rides along —
// without it every request behind requireSession would 401.
async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { credentials: "include" });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await errorMessage(res, `POST ${path}`));
  return res.json() as Promise<T>;
}

// Import rejections carry a message the person needs to read ("that PDF has
// no text layer"), so it is preserved rather than flattened to a status code.
async function errorMessage(res: Response, prefix: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    if (body?.error) return body.error;
  } catch {
    // Non-JSON error body — fall through to the status line.
  }
  return `${prefix} failed: ${res.status}`;
}

async function patch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PATCH ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

export interface AuthMeResponse {
  actor?: ActorSummary;
  authMode: "demo" | "real";
}

const realApi = {
  // "me" is accepted as a literal path segment server-side and resolved
  // from the session — the frontend never needs to know its own actor id.
  getActor: () => get<ActorSummary>(`/actors/me`),

  async getAtlas(conceptId?: string, limit = 12, signal?: AbortSignal): Promise<AtlasResponse> {
    const query = new URLSearchParams({ limit: String(limit) });
    if (conceptId) query.set("conceptId", conceptId);
    const res = await fetch(`${BASE}/actors/me/atlas?${query}`, { credentials: "include", signal });
    if (!res.ok) throw new Error(await errorMessage(res, "GET /actors/me/atlas"));
    return res.json() as Promise<AtlasResponse>;
  },

  // Neither of these has an endpoint yet. They resolve empty rather than
  // throwing, so against the live backend the home page renders the real
  // graph with those two layers simply absent — never with invented data.
  getBridges: async (): Promise<BridgeSuggestion[]> => [],
  getEventSuggestions: async (): Promise<EventSuggestion[]> => [],
  getActorSettings: () => get<ActorSummary & { discoverable: boolean }>(`/actors/me/settings`),
  getSuggestions: (limit?: number) =>
    get<ConnectionSuggestion[]>(`/actors/me/suggestions${limit ? `?limit=${limit}` : ""}`),
  getConnection: (otherId: string) => get<Reason[]>(`/actors/me/connections/${otherId}`),
  getConceptActors: (conceptId: string) => get<ActorSummary[]>(`/concepts/${conceptId}/actors`),
  listAsks: (cursor?: string) => get<Cursor<AskSummary>>(`/asks${cursor ? `?cursor=${cursor}` : ""}`),
  createAsk: (text: string) => post<{ id: string }>("/asks", { text }),
  // Phase 1 is instant; ai=true asks the local model to refine (resolves null when
  // it has nothing to add — the caller keeps what it already has).
  async searchSmart(q: string, ai = false, signal?: AbortSignal): Promise<SmartSearchResult | null> {
    const res = await fetch(`${BASE}/search/smart?q=${encodeURIComponent(q)}${ai ? "&ai=1" : ""}`, { credentials: "include", signal });
    if (res.status === 204) return null;
    if (!res.ok) throw new Error(await errorMessage(res, "GET /search/smart"));
    return res.json() as Promise<SmartSearchResult>;
  },
  // AI descriptions for the top results (best effort: null when the model has nothing grounded to say).
  async searchBlurbs(q: string, ids: string[], signal?: AbortSignal): Promise<Record<string, string> | null> {
    const res = await fetch(`${BASE}/search/blurbs?q=${encodeURIComponent(q)}&ids=${ids.join(",")}`, { credentials: "include", signal });
    if (res.status === 204 || !res.ok) return null;
    return ((await res.json()) as { blurbs: Record<string, string> }).blurbs;
  },
  searchAspirations: (q: string) => get<AspirationMatch[]>(`/search/aspirations?q=${encodeURIComponent(q)}`),
  postInterest: (rawText: string, stance: Stance) => post<{ ok: true }>("/me/interests", { rawText, stance }),
  setDiscoverable: (discoverable: boolean) => patch<ActorSummary>(`/actors/me`, { discoverable }),
  listInterests: () => get<InterestRow[]>(`/actors/me/interests`),
  setInterestVisibility: (interestId: string, visibility: Visibility) =>
    patch<{ ok: true }>(`/actors/me/interests/${interestId}`, { visibility }),

  // Onboarding/imports run before a session exists — see the imports
  // router, which is mounted ahead of requireSession for exactly this
  // reason — so these still pass actorId explicitly rather than relying on
  // the session, unlike everything above.
  createActor: (displayName: string) => post<ActorSummary>("/actors", { displayName }),
  getCourseCatalog: () => get<CourseOffering[]>("/courses/catalog"),
  listImports: (actorId: string) => get<ImportSummary[]>(`/me/imports?actorId=${actorId}`),
  // Accepted immediately (202); the import runs on the worker and its
  // progress is read back from listImports.
  createImport: (body: {
    actorId: string;
    kind: ImportKind;
    origin?: string;
    text?: string;
    filename?: string;
    contentBase64?: string;
    courses?: CourseOffering[];
  }) => post<{ id: string }>("/me/imports", body),

  // Auth — these read the JSON body regardless of status code, since the
  // login page needs the error message (or authMode) either way.
  async me(): Promise<{ status: number; body: AuthMeResponse }> {
    const res = await fetch(`${BASE}/auth/me`, { credentials: "include" });
    return { status: res.status, body: await res.json() };
  },
  async login(
    username: string,
    password: string,
  ): Promise<{ status: number; body: AuthMeResponse & { error?: string } }> {
    const res = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    return { status: res.status, body: await res.json() };
  },
  async logout(): Promise<void> {
    await fetch(`${BASE}/auth/logout`, { method: "POST", credentials: "include" });
  },
};

// ---- Fixture client --------------------------------------------------------
// Same surface, resolved from the canned dataset. Mutations are kept in module
// state so the demo responds to what you do to it within a session.

const fixtureInterests = [...fixtures.interests];
let fixtureDiscoverable = true;

/** A small delay on reads, so loading states are exercised rather than skipped. */
const settle = <T>(value: T, ms = 120): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

const fixtureApi: typeof realApi = {
  getActor: () => settle(fixtures.viewer),
  async getAtlas(conceptId?: string, limit = 12, signal?: AbortSignal): Promise<AtlasResponse> {
    if (signal?.aborted) throw new DOMException("Atlas request cancelled", "AbortError");
    const interestMap = new Map(fixtureInterests
      .filter((interest) => interest.resolved && interest.conceptId && interest.conceptLabel && interest.visibility !== "private")
      .map((interest) => [interest.conceptId!, { conceptId: interest.conceptId!, label: interest.conceptLabel!, count: 0 }]));
    const ranked = fixtures.people.map((suggestion) => ({
      ...suggestion,
      sharedConceptIds: suggestion.actor.topConcepts.map((concept) => concept.conceptId).filter((id) => interestMap.has(id)),
      // Match the server's privacy-aware scorer after demo settings change.
      reasons: suggestion.reasons.filter((reason) => reason.kind !== "shared_concept" ||
        reason.evidence.every((evidence) => evidence.kind !== "concept" || interestMap.has(evidence.id))),
    })).filter((suggestion) => suggestion.sharedConceptIds.length > 0)
      .sort((a, b) => b.score - a.score);
    for (const suggestion of ranked) {
      for (const id of suggestion.sharedConceptIds) interestMap.get(id)!.count++;
    }
    const matching = conceptId ? ranked.filter((suggestion) => suggestion.sharedConceptIds.includes(conceptId)) : ranked;
    const selected = conceptId ? interestMap.get(conceptId) : undefined;
    const suggestions = matching.slice(0, Math.min(24, Math.max(1, Math.floor(limit)))).map((suggestion) => {
      if (!selected) return suggestion;
      const reason: Reason = {
        kind: "shared_concept",
        summary: `Both interested in ${selected.label}`,
        evidence: [{ kind: "concept", id: selected.conceptId, label: selected.label }],
      };
      return { ...suggestion, reasons: [reason, ...suggestion.reasons.filter((entry) =>
        !entry.evidence.some((evidence) => evidence.kind === "concept" && evidence.id === selected.conceptId),
      )].slice(0, 3) };
    });
    const result = await settle({
      interests: [...interestMap.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
      suggestions,
      total: matching.length,
    });
    if (signal?.aborted) throw new DOMException("Atlas request cancelled", "AbortError");
    return result;
  },
  getBridges: () => settle(fixtures.bridges),
  getEventSuggestions: () => settle(fixtures.events),
  getActorSettings: () => settle({ ...fixtures.viewer, discoverable: fixtureDiscoverable }),
  getSuggestions: (limit?: number) =>
    settle([...fixtures.people, ...fixtures.societies].slice(0, limit ?? 5)),
  getConnection: (otherId: string) =>
    settle(fixtures.people.find((p) => p.actor.id === otherId)?.reasons ?? []),
  getConceptActors: (conceptId: string) =>
    settle(
      [...fixtures.people, ...fixtures.societies]
        .filter((s) => s.actor.topConcepts.some((c) => c.conceptId === conceptId))
        .map((s) => s.actor),
    ),
  listAsks: () => settle({ items: fixtures.asks }),
  createAsk: () => settle({ id: "ask-new" }),
  searchAspirations: (q: string) => settle(fixtures.aspirations(q), 320),
  searchBlurbs: async () => null,
  searchSmart: async (q: string, ai = false) =>
    ai
      ? null
      : settle({ query: q, correctedQuery: null, interpretation: null, refined: false, facets: [], people: [], totalPeople: 0, groups: [], nameMatches: [], unmatchedFacets: [], timingsMs: {} }, 200),
  postInterest: (rawText: string, stance) => {
    fixtureInterests.push({
      id: `i-${fixtureInterests.length}`,
      rawText,
      conceptLabel: null,
      stance,
      visibility: "institution",
      resolved: false,
      conceptId: null,
    });
    return settle({ ok: true as const });
  },
  setDiscoverable: (discoverable: boolean) => {
    fixtureDiscoverable = discoverable;
    return settle(fixtures.viewer);
  },
  listInterests: () => settle(fixtureInterests),
  setInterestVisibility: (interestId: string, visibility) => {
    const row = fixtureInterests.find((i) => i.id === interestId);
    if (row) row.visibility = visibility;
    return settle({ ok: true as const });
  },
  createActor: () => settle(fixtures.viewer),
  getCourseCatalog: () => settle(fixtures.courses),
  listImports: () => settle(fixtures.imports),
  createImport: () => settle({ id: "im-new" }),
  me: () => settle({ status: 200, body: { actor: fixtures.viewer, authMode: "demo" as const } }),
  login: () => settle({ status: 200, body: { actor: fixtures.viewer, authMode: "demo" as const } }),
  logout: () => settle(undefined),
};

export const api: typeof realApi = USING_FIXTURES ? fixtureApi : realApi;
