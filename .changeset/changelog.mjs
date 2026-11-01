import github from "@changesets/changelog-github";

// Thank other contributors, but not the owner for their own changes.
export default {
  ...github,
  async getReleaseLine(changeset, type, options) {
    const line = await github.getReleaseLine(changeset, type, options);
    const owner = options.repo.split("/")[0];
    return line.replace(` Thanks [@${owner}](https://github.com/${owner})!`, "");
  },
};
