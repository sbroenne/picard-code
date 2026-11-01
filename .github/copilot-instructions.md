# Copilot instructions for Picard Code

Follow [AGENTS.md](../AGENTS.md); it is the single source of rules for this
repository. In short:

- Use plain English, without jargon, in interface text, errors, docs, issues and pull requests.
- Use Star Trek: The Next Generation terms on screen and in speech: Captain’s log, log entry, New log entry, Current log entry, Stardate, Belay that (see the table in AGENTS.md).
- Never invent success or hide real errors.
- Keep secrets out of the repository, logs and browser; services stay on `127.0.0.1`.
- Do not write files into the user's project; Picard Code sends its own instructions per request.
- Do not commit show recordings, models, samples or local settings; downloads and settings live in `~/.picard-code`.
- Never publish to npm; only the owner does, through a GitHub release.
- For a change users will notice, add a release note with `npx changeset` (patch, never major).
- Before committing, run `npm run check`, `npm run build`, `npm test` and `npx playwright test`.
- Maintainers and coding agents: before opening a pull request, review the complete branch diff with the `ponytail-review` skill.
