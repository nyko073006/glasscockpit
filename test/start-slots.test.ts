import { describe, expect, it } from "vitest";
import { StartSlots } from "../src/core/start-slots";

describe("StartSlots: Sitzungslimit atomar", () => {
  it("zwei gleichzeitige Starts bei Limit 1: nur einer bekommt den Platz", () => {
    const slots = new StartSlots();
    // Beide prüfen, bevor eine PTY läuft (running = 0): das war die Lücke zwischen Prüfung und Spawn.
    const a = slots.reserve(0, 1);
    const b = slots.reserve(0, 1);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(false);
    expect(slots.pending()).toBe(1);
  });

  it("Limit 2 und drei Starts: zwei ok, einer abgelehnt", () => {
    const slots = new StartSlots();
    expect([slots.reserve(0, 2).ok, slots.reserve(0, 2).ok, slots.reserve(0, 2).ok]).toEqual([true, true, false]);
  });

  it("laufende Sitzungen zählen mit", () => {
    const slots = new StartSlots();
    expect(slots.reserve(1, 1).ok).toBe(false);
    expect(slots.reserve(1, 2).ok).toBe(true);
    expect(slots.reserve(1, 2).ok).toBe(false);
  });

  it("release gibt den Platz frei (Fehler beim Start)", () => {
    const slots = new StartSlots();
    const a = slots.reserve(0, 1);
    if (!a.ok) throw new Error("erwartet ok");
    a.release();
    expect(slots.pending()).toBe(0);
    expect(slots.reserve(0, 1).ok).toBe(true);
  });

  it("release ist idempotent und gibt nie einen fremden Platz frei", () => {
    const slots = new StartSlots();
    const a = slots.reserve(0, 2);
    const b = slots.reserve(0, 2);
    if (!a.ok || !b.ok) throw new Error("erwartet ok");
    a.release();
    a.release();
    expect(slots.pending()).toBe(1);
    b.release();
    expect(slots.pending()).toBe(0);
  });

  it("nach dem Spawn ersetzt die laufende PTY die Reservierung, ohne doppelt zu zählen", () => {
    const slots = new StartSlots();
    const a = slots.reserve(0, 1);
    if (!a.ok) throw new Error("erwartet ok");
    a.release(); // direkt nach spawn
    expect(slots.reserve(1, 1).ok).toBe(false); // PTY läuft jetzt
  });
});
