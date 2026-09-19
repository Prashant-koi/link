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

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

async function patch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PATCH ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  getActor: (id: string) => get<ActorSummary>(`/actors/${id}`),
  getActorSettings: (id: string) => get<ActorSummary & { discoverable: boolean }>(`/actors/${id}/settings`),
  getSuggestions: (id: string, limit?: number) =>
    get<ConnectionSuggestion[]>(`/actors/${id}/suggestions${limit ? `?limit=${limit}` : ""}`),
  getConnection: (id: string, otherId: string) => get<Reason[]>(`/actors/${id}/connections/${otherId}`),
  getConceptActors: (conceptId: string) => get<ActorSummary[]>(`/concepts/${conceptId}/actors`),
  listAsks: (cursor?: string) => get<Cursor<AskSummary>>(`/asks${cursor ? `?cursor=${cursor}` : ""}`),
  createAsk: (authorId: string, text: string) => post<{ id: string }>("/asks", { authorId, text }),
  requestIntro: (requesterId: string, targetId: string) =>
    post<{ state: IntroState }>("/intros", { requesterId, targetId }),
  search: (q: string) => get<unknown[]>(`/search?q=${encodeURIComponent(q)}`),
  searchAspirations: (me: string, q: string) =>
    get<AspirationMatch[]>(`/search/aspirations?me=${me}&q=${encodeURIComponent(q)}`),
  postInterest: (actorId: string, rawText: string, stance: Stance) =>
    post<{ ok: true }>("/me/interests", { actorId, rawText, stance }),
  setDiscoverable: (actorId: string, discoverable: boolean) =>
    patch<ActorSummary>(`/actors/${actorId}`, { discoverable }),
  listInterests: (actorId: string) => get<InterestRow[]>(`/actors/${actorId}/interests`),
  setInterestVisibility: (actorId: string, interestId: string, visibility: Visibility) =>
    patch<{ ok: true }>(`/actors/${actorId}/interests/${interestId}`, { visibility }),
};
