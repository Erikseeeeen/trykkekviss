import test from "node:test";
import assert from "node:assert/strict";
import { isGuessCorrect } from "../functions/_shared/shapes.js";

test("circle answers account for image aspect ratio", () => {
  const shape = {
    type: "circle",
    center: { x: 0.5, y: 0.5 },
    radius: 0.1
  };
  const imageSize = { width: 1000, height: 500 };

  assert.equal(isGuessCorrect({ x: 0.5, y: 0.5 }, shape, imageSize), true);
  assert.equal(isGuessCorrect({ x: 0.54, y: 0.5 }, shape, imageSize), true);
  assert.equal(isGuessCorrect({ x: 0.7, y: 0.5 }, shape, imageSize), false);
});

test("rect answers support top-right quadrant", () => {
  const shape = {
    type: "rect",
    x: 0.5,
    y: 0,
    width: 0.5,
    height: 0.5
  };

  assert.equal(isGuessCorrect({ x: 0.75, y: 0.25 }, shape), true);
  assert.equal(isGuessCorrect({ x: 0.25, y: 0.25 }, shape), false);
  assert.equal(isGuessCorrect({ x: 0.75, y: 0.75 }, shape), false);
});

test("polygon answers use image-relative coordinates", () => {
  const shape = {
    type: "polygon",
    points: [
      { x: 0.1, y: 0.1 },
      { x: 0.9, y: 0.1 },
      { x: 0.5, y: 0.9 }
    ]
  };

  assert.equal(isGuessCorrect({ x: 0.5, y: 0.3 }, shape), true);
  assert.equal(isGuessCorrect({ x: 0.05, y: 0.9 }, shape), false);
});
