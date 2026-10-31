import type { Event, PermissionRequest, QuestionRequest } from "@opencode-ai/sdk/v2";

export interface Conversation {
  id: string;
  title: string;
  updated: number;
}

export interface ModelChoice {
  providerID: string;
  modelID: string;
  name: string;
}

export interface ChatPart {
  id: string;
  type: "text" | "reasoning" | "tool";
  text: string;
  status?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  parts: ChatPart[];
  error?: string;
}

export interface AppState {
  project: string;
  version: string;
  models: ModelChoice[];
  defaultModel?: ModelChoice;
  conversations: Conversation[];
  statuses: Record<string, { type: string; message?: string }>;
  permissions: PermissionRequest[];
  questions: QuestionRequest[];
  speech?: { configured: boolean; listening: "mai" | "whisper"; speaking: "mai" | "kokoro" };
}

export type BrowserEvent =
  | { type: "opencode"; event: Event }
  | { type: "connection"; connected: boolean; message?: string };
