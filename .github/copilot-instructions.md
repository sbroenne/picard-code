# Copilot instructions for Picard Code

Follow [AGENTS.md](../AGENTS.md); it is the single source of rules for this
repository. In short:

- Use plain English, without jargon, in interface text, errors, docs, issues and pull requests.
- Never weaken OpenCode approvals, invent success, or hide real errors.
- Keep secrets out of the repository, logs and browser; services stay on `127.0.0.1`.
- Do not write files into the user's project; Picard Code sends its own instructions per request.
- Do not commit show recordings, models or local settings (`.picard-sounds`, `.picard-voice`, `.picard-speech.json`).
- Before committing, run `npm run check`, `npm run build`, `npm test` and `npx playwright test`.
