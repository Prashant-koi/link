import type { ActorSummary } from "../types/api";

export type ConversationState = "requested" | "accepted" | "declined";

export interface Conversation {
  id: string;
  state: ConversationState;
  incomingRequest: boolean;
  counterparty: ActorSummary;
  lastMessage: { body: string; senderId: string; createdAt: string } | null;
  unread: number;
  updatedAt: string;
}

export interface Message {
  id: string;
  senderId: string;
  body: string;
  createdAt: string;
}

export interface MessagePage {
  state: ConversationState;
  counterpartyId: string;
  incomingRequest: boolean;
  messages: Message[];
}

export interface WorkspaceListItem {
  id: string;
  name: string;
  role: "owner" | "member";
  memberCount: number;
  updatedAt: string;
}
export interface WorkspaceInvite {
  workspaceId: string;
  name: string;
  invitedBy: { id: string; displayName: string } | null;
}
export interface WorkspaceList {
  workspaces: WorkspaceListItem[];
  invites: WorkspaceInvite[];
}

export interface NodeView {
  id: string;
  parentId: string | null;
  kind: "folder" | "file";
  name: string;
  mime: string | null;
  size: number;
  isText: boolean;
  updatedAt: string;
}
export interface Member {
  actorId: string;
  displayName: string;
  role: "owner" | "member";
  state: "invited" | "active";
}
export interface WorkspaceDetail {
  id: string;
  name: string;
  role: "owner" | "member";
  members: Member[];
  nodes: NodeView[];
  usedBytes: number;
  limits: { file: number; workspace: number };
}

// ---- AI assistant ----
export interface AiThread {
  id: string;
  title: string;
  updatedAt: string;
  lastMessage: string | null;
  sourceCount: number;
}
export interface AiSource {
  kind: "conversation" | "workspace";
  refId: string;
  label: string;
}
export interface AiAttachable {
  conversations: (AiSource & { messageCount: number; lastAt: string | null })[];
  workspaces: (AiSource & { fileCount: number })[];
}
export interface AiExcerpt {
  n: number;
  kind: "chat" | "file";
  refId: string;
  nodeId: string | null;
  title: string;
  when: string | null;
  snippet: string;
}
export interface AiMessage {
  id: string;
  role: "user" | "assistant";
  body: string;
  sources: AiExcerpt[];
  createdAt: string;
}
export interface AiThreadDetail {
  id: string;
  title: string;
  sources: AiSource[];
  droppedSources: number;
}
