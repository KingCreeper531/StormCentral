import { describe, expect, it } from "vitest";
import { overlayInsets, proView } from "./pro-view";

describe("the Pro view", () => {
  it("is offered only while Professional mode is on", () => {
    expect(proView(true, false)).toEqual({ available: true, on: false });
    expect(proView(true, true)).toEqual({ available: true, on: true });
    expect(proView(false, false)).toEqual({ available: false, on: false });
  });

  it("goes back to the map when Professional mode is turned off, whatever was saved", () => {
    expect(proView(false, true)).toEqual({ available: false, on: false });
  });
});

describe("overlayInsets", () => {
  const H = 1080;

  it("clears the top graphics and the lower third over the ticker", () => {
    const bug = { top: 16, height: 56 };
    const clock = { top: 16, height: 150 };
    const lower = { top: H - 56 - 78, height: 78 };
    const ticker = { top: H - 46, height: 46 };
    expect(overlayInsets([bug, clock, lower, ticker], H)).toEqual({ top: 16 + 150 + 8, bottom: 56 + 78 + 8 });
  });

  it("ignores graphics that are turned off or hidden on small screens", () => {
    expect(overlayInsets([{ top: 16, height: 0 }, { top: H - 36, height: 36 }], H)).toEqual({ top: 0, bottom: 36 + 8 });
    expect(overlayInsets([], H)).toEqual({ top: 0, bottom: 0 });
  });

  it("rounds to whole pixels and takes another gap", () => {
    expect(overlayInsets([{ top: 16.4, height: 55.3 }], H, 0)).toEqual({ top: 72, bottom: 0 });
  });
});
