export interface Conversation {
  id: string;
  title: string;
  created: number;
  updated: number;
}

export interface ModelSelection {
  providerID: string;
  modelID: string;
}

export interface ModelChoice extends ModelSelection {
  /** The provider's display name, such as GitHub Copilot. */
  provider: string;
  name: string;
}

export interface ChatPart {
  id: string;
  type: "text" | "reasoning" | "tool" | "media" | "file";
  text: string;
  status?: string;
  href?: string;
  mime?: string;
  tool?: {
    name: string;
    input?: string;
    output?: string;
    changes?: { file: string; before?: string; after?: string; patch?: string }[];
    exit?: number;
    error?: string;
  };
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  parts: ChatPart[];
  error?: string;
  /** Present only when OpenCode recorded an actual terminal outcome. */
  outcome?: "succeeded" | "failed" | "interrupted";
  speaker?: CrewID;
  background?: boolean;
  /** The related OpenCode entry that produced a background report. */
  sourceSessionID?: string;
  created?: number;
}

export type OpenCodeSource = "installed" | "bundled" | "custom" | "external";

export type OpenCodeConnection = { customSettings: boolean } & (
  | { source: Exclude<OpenCodeSource, "external"> }
  | { source: "external"; address: string }
);

export interface AppState {
  project: string;
  version: string;
  openCode: OpenCodeConnection;
  hasConnectedProvider: boolean;
  models: ModelChoice[];
  defaultModel?: ModelChoice;
  savedModel?: ModelSelection;
  selectedModel?: ModelChoice;
  modelError?: string;
  conversations: Conversation[];
  /** Conversations that are working; anything missing is idle. */
  statuses: Record<string, { type: "busy" | "retry"; message?: string }>;
  permissions: PermissionRequest[];
  questions: FormRequest[];
  crew: { available: boolean; activity: { sessionID: string; logEntryID: string; officer?: CrewID; status: "busy" | "retry"; message?: string }[] };
  speech?: { configured: boolean; listening: "mai" | "nemotron"; speaking: "mai" | "kokoro"; error?: string; setup?: SpeechSetupProgress };
}

export interface SpeechSetupProgress {
  state: "running" | "done" | "failed";
  step: string;
  error?: string;
}

/** Speech choices the settings page can change. Keys are never included. */
export interface SpeechSettings {
  listening: "mai" | "nemotron";
  speaking: "mai" | "kokoro";
  subscription: string;
  resourceGroup: string;
  resourceName: string;
  region: string;
  deployment: string;
}

/** An approval OpenCode is waiting for. */
export interface PermissionRequest {
  id: string;
  sessionID: string;
  action: string;
  resources: string[];
  metadata?: Record<string, unknown>;
  message?: string;
  logEntryID?: string;
  officer?: CrewID;
}

export interface FormOption { value: string; label: string; description?: string }
export interface FormCondition { key: string; op: "eq" | "neq"; value: string | number | boolean }
interface FieldBase { key: string; title?: string; description?: string; required?: boolean; hidden?: boolean; when?: FormCondition[] }
export type FormField =
  | FieldBase & { type: "string"; options?: FormOption[]; custom?: boolean; default?: string; placeholder?: string; maxLength?: number }
  | FieldBase & { type: "multiselect"; options: FormOption[]; custom?: boolean; minItems?: number; maxItems?: number; default?: string[] }
  | FieldBase & { type: "boolean"; default?: boolean }
  | FieldBase & { type: "number" | "integer"; minimum?: number | string; maximum?: number | string; default?: number | string }
  | FieldBase & { type: "external"; url: string };

/** A question OpenCode is waiting for, as a small form. */
export interface FormRequest {
  id: string;
  sessionID: string;
  title: string;
  fields: FormField[];
  logEntryID?: string;
  officer?: CrewID;
}

export type FormValue = string | number | boolean | string[];

/** Events the local server sends to the browser. */
export type BrowserEvent =
  | { type: "connection"; connected: boolean; message?: string }
  /** A piece of a reply that is still being written. */
  | { type: "delta"; sessionID: string; messageID: string; partID: string; partType: "text" | "reasoning"; delta: string; speaker?: CrewID; background?: boolean }
  /** The stored conversation changed; reload it. */
  | { type: "changed"; sessionID: string }
  /** The real execution outcome, used only for locally observed completed requests. */
  | { type: "finished"; sessionID: string; outcome: "succeeded" | "failed" | "interrupted" }
  /** Work started or stopped, or an approval or question appeared or was settled. */
  | { type: "state" }
  /** Work finished with an error. */
  | { type: "error"; sessionID: string; message: string }
  /** OpenCode will try again after a temporary problem. */
  | { type: "retry"; sessionID: string; message: string };
import type { CrewID } from "./crew.js";
