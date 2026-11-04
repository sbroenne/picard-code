## What changes?

Explain the useful difference and link any related issue. If people using
Picard Code will notice it, add a release note with `npx changeset`.

## How does it fit Picard Code?

Keep the voice-only, desktop Captain Picard experience and original material.
For speech services, explain setup, licenses, data destinations, charges,
cancellation, and failures.

## Checks and evidence

For documentation and website-only changes, report
`npx playwright test browser-tests/site.spec.ts` and its result.
For other changes, say which of `npm run check`, `npm run build`, `npm test`, and
`npx playwright test` ran and what happened. See AGENTS.md for the check rules.
For changed OpenCode, speech, conversation or start-up behavior, name each
matching real check and its result, or explain why it could not run.
For a bug fix or new behavior, name the test that fails without the change.
Label stand-in screenshots and generated audio honestly.
If you ran the `ponytail-review` skill, give its verdict and what you fixed.

## Remaining limits

Mention anything not checked, and the documentation updated.
Do not include keys, personal log entries, local settings, or temporary launch
addresses. You are responsible for reviewing AI-assisted changes too.
