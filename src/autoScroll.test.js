import { describe, expect, it } from "vitest";
import { edgeVelocity, scrollVelocity } from "./autoScroll";

describe("fill auto scroll", () => {
  it("accelerates at both edges and stops in the center", () => {
    expect(edgeVelocity(105, 100, 500, 40, 20)).toBeLessThan(0);
    expect(edgeVelocity(495, 100, 500, 40, 20)).toBeGreaterThan(0);
    expect(edgeVelocity(300, 100, 500, 40, 20)).toBe(0);
  });
  it("calculates iframe-local two-axis velocity", () => {
    expect(scrollVelocity(102, 498, { left: 100, top: 100, right: 500, bottom: 500 }, { edge: 40, maxSpeed: 20 })).toEqual({ x: -19, y: 19 });
  });
});
