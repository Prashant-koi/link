import type {
  ActorSummary,
  AskSummary,
  AspirationMatch,
  ConnectionSuggestion,
  Cursor,
  IntroState,
  InterestRow,
  Reason,
  Stance,
  Visibility,
} from "../types/api";

const BASE = "/api";

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
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
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

export const api = {
  // "me" is accepted as a literal path segment server-side and resolved
  // from the session — the frontend never needs to know its own actor id.
  getActor: () => get<ActorSummary>(`/actors/me`),
  getActorSettings: () => get<ActorSummary & { discoverable: boolean }>(`/actors/me/settings`),
  getSuggestions: (limit?: number) =>
    get<ConnectionSuggestion[]>(`/actors/me/suggestions${limit ? `?limit=${limit}` : ""}`),
  getConnection: (otherId: string) => get<Reason[]>(`/actors/me/connections/${otherId}`),
  getConceptActors: (conceptId: string) => get<ActorSummary[]>(`/concepts/${conceptId}/actors`),
  listAsks: (cursor?: string) => get<Cursor<AskSummary>>(`/asks${cursor ? `?cursor=${cursor}` : ""}`),
  createAsk: (text: string) => post<{ id: string }>("/asks", { text }),
  requestIntro: (targetId: string) => post<{ state: IntroState }>("/intros", { targetId }),
  search: (q: string) => get<unknown[]>(`/search?q=${encodeURIComponent(q)}`),
  searchAspirations: (q: string) => get<AspirationMatch[]>(`/search/aspirations?q=${encodeURIComponent(q)}`),
  postInterest: (rawText: string, stance: Stance) => post<{ ok: true }>("/me/interests", { rawText, stance }),
  setDiscoverable: (discoverable: boolean) => patch<ActorSummary>(`/actors/me`, { discoverable }),
  listInterests: () => get<InterestRow[]>(`/actors/me/interests`),
  setInterestVisibility: (interestId: string, visibility: Visibility) =>
    patch<{ ok: true }>(`/actors/me/interests/${interestId}`, { visibility }),

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
