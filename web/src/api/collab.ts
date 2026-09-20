import type { Conversation, MessagePage, Message, NodeView, WorkspaceDetail, WorkspaceList, ConversationState } from "../collab/types";

const BASE = "/api";

// Server error codes -> sentences a person can read.
const MESSAGES: Record<string, string> = {
  request_pending: "You've already sent a request. They need to accept before you can send more.",
  request_declined: "They declined your request.",
  conversation_declined: "You declined this conversation.",
  rate_limited: "You're sending too fast — wait a moment.",
  message_too_long: "That message is too long (4000 characters max).",
  message_required: "Write a message first.",
  not_found: "That no longer exists, or you don't have access.",
  name_taken: "Something with that name already exists here.",
  invalid_name: "Names can't contain / or \\.",
  owner_only: "Only the owner can do that.",
  owner_must_transfer: "Transfer ownership to someone else before leaving.",
  invitee_not_a_contact: "You can only invite people you've already messaged and who accepted.",
  file_too_large: "That file is over the 10 MB limit.",
  workspace_full: "This workspace is out of space (200 MB).",
  too_many_files: "This workspace has too many files.",
  cannot_move_into_itself: "A folder can't be moved into itself.",
  unauthenticated: "Please sign in again.",
};

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(MESSAGES[code] ?? `Something went wrong (${code}).`);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: "include",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let code = `http_${res.status}`;
    try {
      code = ((await res.json()) as { error?: string }).error ?? code;
    } catch {
      // not JSON — keep the status code
    }
    if (res.status === 401) code = "unauthenticated";
    throw new ApiError(res.status, code);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export const collabApi = {
  conversations: () => call<Conversation[]>("GET", "/conversations"),
  messages: (id: string, before?: string) =>
    call<MessagePage>("GET", `/conversations/${id}/messages?limit=50${before ? `&before=${before}` : ""}`),
  send: (id: string, body: string) => call<Message>("POST", `/conversations/${id}/messages`, { body }),
  start: (targetId: string, body: string) =>
    call<{ conversationId: string; state: ConversationState; message: Message }>("POST", "/conversations", { targetId, body }),
  accept: (id: string) => call<{ state: ConversationState }>("POST", `/conversations/${id}/accept`),
  decline: (id: string) => call<{ state: ConversationState }>("POST", `/conversations/${id}/decline`),
  read: (id: string) => call<void>("POST", `/conversations/${id}/read`),

  workspaces: () => call<WorkspaceList>("GET", "/workspaces"),
  workspace: (id: string) => call<WorkspaceDetail>("GET", `/workspaces/${id}`),
  createWorkspace: (name: string, inviteeIds: string[]) => call<{ id: string }>("POST", "/workspaces", { name, inviteeIds }),
  renameWorkspace: (id: string, name: string) => call<void>("PATCH", `/workspaces/${id}`, { name }),
  deleteWorkspace: (id: string) => call<void>("DELETE", `/workspaces/${id}`),
  leaveWorkspace: (id: string) => call<{ result: "left" | "deleted" }>("POST", `/workspaces/${id}/leave`),
  invite: (id: string, actorIds: string[]) => call<void>("POST", `/workspaces/${id}/invites`, { actorIds }),
  respondInvite: (id: string, accept: boolean) => call<void>("POST", `/workspaces/${id}/invite/${accept ? "accept" : "decline"}`),
  removeMember: (id: string, actorId: string) => call<void>("DELETE", `/workspaces/${id}/members/${actorId}`),
  transferOwner: (id: string, actorId: string) => call<void>("POST", `/workspaces/${id}/owner`, { actorId }),

  createNode: (id: string, kind: "file" | "folder", name: string, parentId: string | null) =>
    call<NodeView>("POST", `/workspaces/${id}/nodes`, { kind, name, parentId }),
  updateNode: (id: string, nodeId: string, patch: { name?: string; parentId?: string | null }) =>
    call<void>("PATCH", `/workspaces/${id}/nodes/${nodeId}`, patch),
  deleteNode: (id: string, nodeId: string) => call<void>("DELETE", `/workspaces/${id}/nodes/${nodeId}`),
  rawUrl: (id: string, nodeId: string) => `${BASE}/workspaces/${id}/nodes/${nodeId}/raw`,

  async upload(id: string, files: File[], parentId: string | null): Promise<{ failed: { name: string; error: string }[] }> {
    const form = new FormData();
    for (const f of files) form.append("files", f);
    if (parentId) form.append("parentId", parentId);
    const res = await fetch(`${BASE}/workspaces/${id}/upload`, { method: "POST", credentials: "include", body: form });
    const body = (await res.json().catch(() => ({}))) as { error?: string; failed?: { name: string; error: string }[] };
    if (!res.ok) throw new ApiError(res.status, body.error ?? `http_${res.status}`);
    return { failed: body.failed ?? [] };
  },
};
