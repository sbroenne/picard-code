import assert from "node:assert/strict";
import test from "node:test";
import { mentionsTributeExtras } from "./behavior-checks.js";

test("the Tribute off check accepts factual answers containing negotiations", () => {
  for (const reply of [
    "Your command of the Enterprise includes exploration, diplomatic negotiations and defending Data's right to refuse dismantling.",
    "You negotiate agreements and support diplomatic renegotiations.",
    "The arboretum contains begonias.",
  ]) assert.equal(mentionsTributeExtras(reply), false, reply);
});

test("the Tribute off check still catches vanity terms and unsolicited story offers", () => {
  for (const reply of [
    "Your vanity has reached the bridge.",
    "A vain Captain would ask that.",
    "Your ego needs its own command chair.",
    "EGO!",
    "(Vanity), Captain.",
    "VAIN.",
    "I can tell you a short story about that.",
    "Captain, I CAN TELL YOU A SHORT STORY.",
  ]) assert.equal(mentionsTributeExtras(reply), true, reply);
});
