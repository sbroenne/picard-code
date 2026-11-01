// Candidate voices and the original sample sentences used to compare them with the cast.
// Kokoro grades come from the Kokoro-82M VOICES.md table; voices graded below D are never chosen.

/** Six original sentences, about 600 characters, with ordinary report wording and no show lines. */
export const SENTENCES = [
  "The diagnostic finished a few minutes ago, and every result is now on the main display.",
  "I checked the three files you named, and only the second one needs a small change.",
  "There is a problem with the build: two tests failed after the latest update.",
  "If we wait until morning, the team will have time to review the new plan carefully.",
  "My recommendation is simple. Keep the current design, and fix the slow search first.",
  "Nothing else looks unusual, but I would like to run one more check before we continue.",
];

export const KOKORO_CANDIDATES = [
  ["af_heart", "female", "A"], ["af_bella", "female", "A-"], ["af_nicole", "female", "B-"], ["af_aoede", "female", "C+"],
  ["af_kore", "female", "C+"], ["af_sarah", "female", "C+"], ["af_alloy", "female", "C"], ["af_nova", "female", "C"],
  ["af_sky", "female", "C-"], ["af_jessica", "female", "D"], ["af_river", "female", "D"],
  ["bf_emma", "female", "B-"], ["bf_isabella", "female", "C"], ["bf_alice", "female", "D"], ["bf_lily", "female", "D"],
  ["ff_siwis", "female", "B-"], ["hf_alpha", "female", "C"], ["hf_beta", "female", "C"], ["if_sara", "female", "C"],
  ["am_fenrir", "male", "C+"], ["am_michael", "male", "C+"], ["am_puck", "male", "C+"], ["am_echo", "male", "D"],
  ["am_eric", "male", "D"], ["am_liam", "male", "D"], ["am_onyx", "male", "D"], ["am_santa", "male", "D-"], ["am_adam", "male", "F+"],
  ["bm_fable", "male", "C"], ["bm_george", "male", "C"], ["bm_lewis", "male", "D+"], ["bm_daniel", "male", "D"],
  ["hm_omega", "male", "C"], ["hm_psi", "male", "C"], ["im_nicola", "male", "C"],
].map(([name, gender, grade]) => ({ name, gender, grade }));

/** English MAI-Voice-2.1 voices offered by Azure. The model name is added from the owner's settings. */
export const MAI_CANDIDATES = [
  ["en-GB-Harry", "male"], ["en-US-Ethan", "male"], ["en-US-Grant", "male"], ["en-US-Jasper", "male"],
  ["en-US-Sage", "male"], ["en-IN-Dhruv", "male"],
  ["en-GB-Emily", "female"], ["en-US-Harper", "female"], ["en-US-Iris", "female"], ["en-US-Olivia", "female"],
  ["en-AU-Isla", "female"], ["en-IN-Priya", "female"],
].map(([name, gender]) => ({ name, gender }));
