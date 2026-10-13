import { afterEach, describe, expect, it, vi } from "vitest";

// Portal-Regel prefer-window-timers: Code ruft window.setTimeout. Im Node-Lauf setzt test/setup-window.ts window = globalThis,
// damit Fake-Timer auch window.setTimeout treffen.
describe("window im Node-Lauf", () => {
  afterEach(() => { vi.useRealTimers(); });
  it("window ist globalThis", () => { expect((globalThis as { window?: unknown }).window).toBe(globalThis); });
  it("Fake-Timer treffen window.setTimeout", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    window.setTimeout(fn, 1000);
    vi.advanceTimersByTime(999);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledOnce();
  });
});
