export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null) {
    if ("data" in error) return errorMessage(error.data);
    if ("message" in error && typeof error.message === "string") return error.message;
    if ("name" in error && typeof error.name === "string") return error.name;
  }
  return "OpenCode could not complete the request. Check its setup and try again.";
}
