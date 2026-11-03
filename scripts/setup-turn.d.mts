export const TURN_MODEL: string;
export const TURN_MODEL_SHA256: string;
export function setupTurn(home: string, signal?: AbortSignal): Promise<string>;
