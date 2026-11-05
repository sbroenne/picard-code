import { addressed } from "./wake.js";

/** Longest log entry title in characters, counting the closing ellipsis. */
export const LOG_TITLE_LENGTH = 60;

/**
 * Names a new log entry from the Captain's first request: the words after "Computer", unchanged.
 * A long request is shortened at the end of a whole word and closed with an ellipsis.
 */
export function logEntryTitle(request: string) {
  const text = (addressed(request) || request).trim();
  const characters = [...text];
  if (characters.length <= LOG_TITLE_LENGTH) return text;
  const kept = characters.slice(0, LOG_TITLE_LENGTH - 1).join("");
  const boundary = /\s/.test(characters[LOG_TITLE_LENGTH - 1]!) ? kept.length : kept.search(/\s+\S*$/);
  // One word longer than the whole title is cut where it must be.
  const words = boundary > 0 ? kept.slice(0, boundary).replace(/[\s,;:]+$/, "") : kept;
  return `${words}…`;
}
