import test from "node:test";
import assert from "node:assert/strict";
import { shuffleFibbageRevealChoices } from "../functions/_shared/fibbage.js";

const choices = [
  { id: "lie-a" },
  { id: "lie-b" },
  { id: "lie-c" },
  { id: "lie-d" }
];

test("Fibbage reveal order is a stable shuffle separate from display order", () => {
  const first = shuffleFibbageRevealChoices(choices, "room-1|round-1");
  const second = shuffleFibbageRevealChoices(choices, "room-1|round-1");

  assert.deepEqual(first, second);
  assert.deepEqual(
    first.map((choice) => choice.id).sort(),
    choices.map((choice) => choice.id).sort()
  );
  assert.notDeepEqual(first, choices);
});

test("Fibbage reveal order changes with the round seed", () => {
  const first = shuffleFibbageRevealChoices(choices, "room-1|round-1");
  const second = shuffleFibbageRevealChoices(choices, "room-1|round-2");

  assert.notDeepEqual(first, second);
});
