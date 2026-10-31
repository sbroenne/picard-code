# Reporting a security problem

Picard Code is an early source release. Only the current `main` branch receives
fixes; there are no supported older release branches.

Please use [GitHub's private vulnerability reporting](https://github.com/sbroenne/picard-code/security/advisories/new)
when it is enabled on the public repository. Do not open a public issue with
credentials, private project content, or instructions that would expose other
users. If the private reporting form is unavailable, do not publish the details;
use GitHub's reporting tools for abuse and wait for a private reporting route
to be available.

Include the affected commit, operating system, browser, reproduction steps,
expected and actual behavior, and impact. Use a minimal example containing no
secrets or other people's data. Do not test against another person's computer,
account, project, or cloud resource.

The maintainer reviews reports as availability permits; no response time or
paid support is promised. Coordinate public disclosure after a fix is available.

Never attach Azure keys, provider credentials, `.picard-speech.json`, a complete
launch address with its temporary key, personal log entries, or project files
you cannot share. Remove sensitive information from screenshots and logs.
If a real credential has been exposed, revoke or rotate it with its provider;
deleting a GitHub comment alone does not make it safe again.

## Limits

The app listens on `127.0.0.1`; it is not designed to be served publicly.
The local protections do not defend against a malicious program already
running on the same computer. OpenCode owns its model connections and
permission rules. Selected hosted providers receive project content; Azure
listening receives detected speech even before "Computer" is recognized.
Read README's data-flow explanation before use.

The GitHub Pages website is a static introduction, not a running app.
Automated checks and scanning reduce risk but do not prove that no security
problem exists.
