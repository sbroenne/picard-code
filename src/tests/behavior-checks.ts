export function mentionsTributeExtras(reply: string): boolean {
  return /\b(?:vanity|vain|ego)\b|i can tell you a short story/i.test(reply);
}
