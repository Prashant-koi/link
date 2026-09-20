import type { Response } from "express";

// In-process pub/sub for server-sent events. Fine for one API replica (the
// deployment); a second replica would need Postgres LISTEN/NOTIFY here.
export type LinkEvent =
  | { type: "message"; conversationId: string }
  | { type: "request"; conversationId: string }
  | { type: "conversation_update"; conversationId: string }
  | { type: "workspace_invite"; workspaceId: string }
  | { type: "workspace_update"; workspaceId: string };

const subscribers = new Map<string, Set<Response>>();

export function subscribe(actorId: string, res: Response): () => void {
  let set = subscribers.get(actorId);
  if (!set) subscribers.set(actorId, (set = new Set()));
  set.add(res);
  return () => {
    set!.delete(res);
    if (set!.size === 0) subscribers.delete(actorId);
  };
}

export function publish(actorIds: string[], event: LinkEvent): void {
  const payload = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
  for (const id of new Set(actorIds)) {
    for (const res of subscribers.get(id) ?? []) res.write(payload);
  }
}

export function heartbeat(): void {
  for (const set of subscribers.values()) for (const res of set) res.write(`: ping\n\n`);
}

setInterval(heartbeat, 25_000).unref();
