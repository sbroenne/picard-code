# Making Picard Code public and publishing it

Steps only the owner can take. Coding agents never publish.

## Making the repository public

Some GitHub features only work on a public repository. After making it public:

1. In **Settings → Pages**, choose **GitHub Actions** as the source, then run
   **Publish project website** once from the **Actions** tab. Set the
   repository's website address to `https://sbroenne.github.io/picard-code/`.
2. In **Settings → Code security**, turn on private vulnerability reporting,
   Dependabot alerts and security updates. The CodeQL and dependency review
   checks start running by themselves.
3. Protect `main` with a rule that requires the **Project checks** to pass.
4. Turn on automatic Copilot code review, so the Ponytail skill reviews each
   pull request.

## Publishing to npm

The README tells people to run `npx picard-code`, so publish the first
version as soon as the repository is public. Only the owner publishes; coding
agents never do.

1. **First version, by hand.** npm only lets GitHub publish a package that
   already exists. On an up-to-date `main`, run `npm login`, then
   `npm publish`. Publishing builds the package first and includes only what
   `files` in `package.json` lists. Then check from an empty folder that
   `npx picard-code --help` works.
2. **Let GitHub publish later versions.** On npmjs.com, open the package's
   **Settings → Trusted publishing**, choose **GitHub Actions**, and enter
   owner `sbroenne`, repository `picard-code`, workflow `release.yml` and
   environment `npm`. In GitHub **Settings → Environments**, create the `npm`
   environment and, if you like, require your own approval. No npm token is
   stored anywhere.
3. **Each later version.** In a pull request, raise `version` in
   `package.json` (for example `npm version 0.2.0 --no-git-tag-version`) and
   merge it. Then create a GitHub release with the tag `v0.2.0`. The
   **Publish to npm** workflow checks that the tag matches, runs the checks,
   and publishes with provenance (a public record that GitHub built it from
   this repository).

## Older checkouts

Older checkouts kept speech in `.picard-voice` and sounds in `.picard-sounds`
inside the repository. Picard Code no longer reads those: run
`npm run setup:speech` again, then delete the old folders. Sounds download by
themselves at the next start.
