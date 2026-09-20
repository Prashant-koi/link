import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { collabApi } from "../api/collab";
import type { Conversation, WorkspaceList } from "./types";

type EventName = "message" | "request" | "conversation_update" | "workspace_invite" | "workspace_update";
type Listener = (type: EventName, id: string) => void;

interface CollabState {
  conversations: Conversation[];
  workspaceList: WorkspaceList;
  unreadTotal: number; // unread messages + pending incoming requests
  inviteCount: number;
  live: boolean; // event stream connected
  refresh: () => void;
  // Subscribe to raw events (id = conversationId or workspaceId).
  subscribe: (fn: Listener) => () => void;
}

const EMPTY: WorkspaceList = { workspaces: [], invites: [] };
const Ctx = createContext<CollabState | null>(null);
const EVENTS: EventName[] = ["message", "request", "conversation_update", "workspace_invite", "workspace_update"];

// One server-sent-events connection for the whole signed-in session. Events
// carry ids only; every event (and every reconnect) re-fetches the lists, so a
// dropped connection can never leave stale data — worst case is a few seconds.
export function CollabProvider({ children }: { children: React.ReactNode }) {
  const { actor } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [workspaceList, setWorkspaceList] = useState<WorkspaceList>(EMPTY);
  const [live, setLive] = useState(false);
  const listeners = useRef(new Set<Listener>());
  const pending = useRef<number | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      const [c, w] = await Promise.all([collabApi.conversations(), collabApi.workspaces()]);
      setConversations(c);
      setWorkspaceList(w);
    } catch {
      // signed out or offline — keep what we have
    }
  }, []);

  // Coalesce bursts (a message fires several events) into one refetch.
  const refresh = useCallback(() => {
    window.clearTimeout(pending.current);
    pending.current = window.setTimeout(load, 150);
  }, [load]);

  useEffect(() => {
    if (!actor) return;
    load();
    const es = new EventSource("/api/events", { withCredentials: true });
    es.onopen = () => {
      setLive(true);
      load(); // catch up on anything missed while disconnected
    };
    es.onerror = () => setLive(false); // EventSource retries by itself (server sends retry: 3000)
    for (const name of EVENTS) {
      es.addEventListener(name, (e) => {
        const data = JSON.parse((e as MessageEvent).data) as { conversationId?: string; workspaceId?: string };
        refresh();
        for (const fn of listeners.current) fn(name, data.conversationId ?? data.workspaceId ?? "");
      });
    }
    return () => {
      es.close();
      window.clearTimeout(pending.current);
    };
  }, [actor, load, refresh]);

  const subscribe = useCallback((fn: Listener) => {
    listeners.current.add(fn);
    return () => {
      listeners.current.delete(fn);
    };
  }, []);

  const value = useMemo<CollabState>(() => {
    const unread = conversations.reduce((n, c) => n + (c.incomingRequest ? 1 : c.unread), 0);
    return {
      conversations,
      workspaceList,
      unreadTotal: unread,
      inviteCount: workspaceList.invites.length,
      live,
      refresh,
      subscribe,
    };
  }, [conversations, workspaceList, live, refresh, subscribe]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCollab(): CollabState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCollab must be used within CollabProvider");
  return ctx;
}
