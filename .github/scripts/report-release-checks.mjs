import { pathToFileURL } from "node:url";

// GitHub can require results on its test-merge commit. Report only when that
// commit has exactly the same files as the release commit the jobs tested.
export async function reportReleaseChecks({ repo, pr, sha, token, results, runURL }, request = fetch) {
  const api = async (path, body) => {
    const response = await request(`https://api.github.com/repos/${repo}/${path}`, {
      method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new Error(`Could not report release checks (${path}, HTTP ${response.status}).`);
    return response.json();
  };
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !/^[1-9]\d*$/.test(String(pr)) || !/^[a-f0-9]{40}$/.test(sha)) {
    throw new Error("Provide a valid repository, release pull request and checked commit.");
  }
  const pull = await api(`pulls/${pr}`);
  if (pull.state !== "open" || pull.head.ref !== "release" || pull.head.repo.full_name !== repo || pull.head.sha !== sha) {
    throw new Error("The release pull request changed or is not the checked release branch. No results were reported.");
  }
  const merge = await api(`git/ref/pull/${pr}/merge`);
  const [checked, merged] = await Promise.all([
    api(`git/commits/${sha}`), api(`git/commits/${merge.object.sha}`),
  ]);
  if (checked.tree.sha !== merged.tree.sha) {
    throw new Error("The test-merge files differ from the checked release files. No results were reported.");
  }
  const scopePassed = results.scope === "success";
  const checks = [
    ["Types and browser checks", scopePassed && results.browser === "success"],
    ...["ubuntu-latest", "windows-latest", "macos-latest"].map((os) => [
      `Server and package (${os})`, scopePassed && results.systems === "success",
    ]),
  ];
  for (const [name, passed] of checks) {
    await api("check-runs", {
      name, head_sha: merge.object.sha, status: "completed",
      conclusion: passed ? "success" : "failure", details_url: runURL,
      output: { title: name, summary: `Real workflow results for identical release files. See ${runURL}.` },
    });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await reportReleaseChecks({
    repo: process.env.GITHUB_REPOSITORY, pr: process.env.RELEASE_PR,
    sha: process.env.CHECKED_SHA, token: process.env.GH_TOKEN, runURL: process.env.RUN_URL,
    results: { scope: process.env.SCOPE_RESULT, browser: process.env.BROWSER_RESULT, systems: process.env.SYSTEMS_RESULT },
  });
}
