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
  /** Conversations that are working; anything missing is idle. */
  statuses: Record<string, { type: "busy" | "retry"; message?: string }>;
  permissions: PermissionRequest[];
  questions: FormRequest[];
  speech?: { configured: boolean; listening: "mai" | "whisper"; speaking: "mai" | "kokoro"; error?: string };
}

/** Speech choices the settings page can change. Keys are never included. */
export interface SpeechSettings {
  listening: "mai" | "whisper";
  speaking: "mai" | "kokoro";
  subscription: string;
  resourceGroup: string;
  resourceName: string;
  region: string;
  deployment: string;
  voice: string;
  voiceStyle: string;
  kokoroVoice: string;
}

/** An approval OpenCode is waiting for. */
export interface PermissionRequest {
  id: string;
  sessionID: string;
  action: string;
  resources: string[];
  metadata?: Record<string, unknown>;
  message?: string;
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
}

export type FormValue = string | number | boolean | string[];

/** Events the local server sends to the browser. */
export type BrowserEvent =
  | { type: "connection"; connected: boolean; message?: string }
  /** A piece of a reply that is still being written. */
  | { type: "delta"; sessionID: string; messageID: string; partID: string; partType: "text" | "reasoning"; delta: string }
  /** The stored conversation changed; reload it. */
  | { type: "changed"; sessionID: string }
  /** Work started or stopped, or an approval or question appeared or was settled. */
  | { type: "state" }
  /** Work finished with an error. */
  | { type: "error"; sessionID: string; message: string }
  /** OpenCode will try again after a temporary problem. */
  | { type: "retry"; sessionID: string; message: string };
