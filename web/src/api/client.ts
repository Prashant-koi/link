import type {
  ActorSummary,
  CourseOffering,
  ImportKind,
  ImportSummary,
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
  // Onboarding: a person at a demo has no actor row yet, so the first step
  // is creating one.
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
  listInterests: (actorId: string) => get<InterestRow[]>(`/actors/${actorId}/interests`),
  setInterestVisibility: (actorId: string, interestId: string, visibility: Visibility) =>
    patch<{ ok: true }>(`/actors/${actorId}/interests/${interestId}`, { visibility }),
};
