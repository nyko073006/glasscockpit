// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import type { BriefingBox } from "../src/core/focus";
import { CHECKS_UNAVAILABLE_HINT, attachBriefingChecks, renderBriefingWithChecks } from "../src/host/briefing-checks";

// Checkboxen im gerenderten Briefing (Abend 44): DOM von Hand wie Obsidians Renderer
// (`ul > li.task-list-item > input.task-list-item-checkbox`). Zugeordnet wird nur, wenn Anzahl und Text jeder Checkbox passen.

const item = (text: string, extra = ""): string =>
  `<li class="task-list-item"><input type="checkbox" class="task-list-item-checkbox">${text}${extra}</li>`;

function render(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
}

const box = (line: number, key: string, locked = false): BriefingBox => ({ line, key, locked });

function checks(root: HTMLElement): HTMLInputElement[] {
  return Array.from(root.querySelectorAll<HTMLInputElement>("input.task-list-item-checkbox"));
}

/** Klick wie vom Nutzer; liefert das Ereignis, damit der Test `defaultPrevented` sieht. */
function click(el: HTMLElement): MouseEvent {
  const e = new MouseEvent("click", { bubbles: true, cancelable: true });
  el.dispatchEvent(e);
  return e;
}

/** Nichts angefasst: keine Klasse, kein disabled. */
function untouched(root: HTMLElement): void {
  for (const cb of checks(root)) expect(cb.disabled).toBe(false);
  expect(root.querySelectorAll(".cockpit-briefing-point, .cockpit-briefing-done")).toHaveLength(0);
}

describe("attachBriefingChecks", () => {
  it("a) drei Checkboxen, drei Boxen: offen schaltet, erledigt ist durchgestrichen, gesperrt ist disabled", () => {
    const root = render(`<ul>${item("Eins")}${item("Zwei")}${item("Drei")}</ul>`);
    const onToggle = vi.fn();
    const ok = attachBriefingChecks(root, [box(1, "eins"), box(2, "zwei"), box(3, "drei", true)], new Set(["eins"]), onToggle);
    expect(ok).toBe(true);
    const [eins, zwei, drei] = checks(root);
    const e = click(zwei);
    expect(onToggle).toHaveBeenCalledWith("zwei", true);
    expect(e.defaultPrevented).toBe(true);
    click(eins);
    expect(onToggle).toHaveBeenLastCalledWith("eins", false);
    expect(drei.disabled).toBe(true);
    expect(eins.disabled).toBe(false);
    expect(zwei.disabled).toBe(false);
    const lis = Array.from(root.querySelectorAll("li"));
    expect(lis.map((li) => li.classList.contains("cockpit-briefing-point"))).toEqual([true, true, true]);
    expect(lis.map((li) => li.classList.contains("cockpit-briefing-done"))).toEqual([true, false, false]);
  });

  it("b) zwei Checkboxen, drei Boxen: false, kein Listener, keine Klasse", () => {
    const root = render(`<ul>${item("Eins")}${item("Zwei")}</ul>`);
    const onToggle = vi.fn();
    expect(attachBriefingChecks(root, [box(1, "eins"), box(2, "zwei"), box(3, "drei")], new Set(), onToggle)).toBe(false);
    for (const cb of checks(root)) click(cb);
    expect(onToggle).not.toHaveBeenCalled();
    untouched(root);
  });

  it("c) zwei Boxen mit demselben Schlüssel: die zweite schaltet diesen Schlüssel", () => {
    const root = render(`<ul>${item("Mail")}</ul><p>Text</p><ul>${item("Mail")}</ul>`);
    const onToggle = vi.fn();
    expect(attachBriefingChecks(root, [box(1, "mail"), box(5, "mail")], new Set(), onToggle)).toBe(true);
    click(checks(root)[1]);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith("mail", true);
  });

  it("f) Checkboxen in Zitat und Callout zählen nicht, die übrigen sind richtig zugeordnet", () => {
    const root = render(
      `<ul>${item("Eins")}</ul>` +
        `<blockquote><ul>${item("Zitat")}</ul></blockquote>` +
        `<div class="callout"><div class="callout-content"><ul>${item("Kasten")}</ul></div></div>` +
        `<ul>${item("Zwei")}</ul>`,
    );
    const onToggle = vi.fn();
    expect(attachBriefingChecks(root, [box(1, "eins"), box(5, "zwei")], new Set(), onToggle)).toBe(true);
    const [eins, zitat, kasten, zwei] = checks(root);
    click(zitat);
    click(kasten);
    expect(onToggle).not.toHaveBeenCalled();
    click(zwei);
    expect(onToggle).toHaveBeenCalledWith("zwei", true);
    click(eins);
    expect(onToggle).toHaveBeenLastCalledWith("eins", true);
    expect(zitat.closest("li")?.classList.contains("cockpit-briefing-point")).toBe(false);
    expect(kasten.closest("li")?.classList.contains("cockpit-briefing-point")).toBe(false);
  });

  it("g) gleiche Anzahl, aber ein Text passt nicht zum Schlüssel: false, nichts verändert", () => {
    const root = render(`<ul>${item("Eins")}${item("Anderes")}${item("Drei")}</ul>`);
    const onToggle = vi.fn();
    const ok = attachBriefingChecks(root, [box(1, "eins", true), box(2, "zwei"), box(3, "drei")], new Set(["eins"]), onToggle);
    expect(ok).toBe(false);
    for (const cb of checks(root)) click(cb);
    expect(onToggle).not.toHaveBeenCalled();
    untouched(root);
  });

  it("h) li mit Unterliste: der Vergleich nimmt nur den eigenen Text", () => {
    const root = render(`<ul>${item("Eltern", `<ul>${item("Kind")}</ul>`)}</ul>`);
    const onToggle = vi.fn();
    expect(attachBriefingChecks(root, [box(1, "eltern"), box(2, "kind")], new Set(["kind"]), onToggle)).toBe(true);
    const [eltern, kind] = checks(root);
    click(kind);
    expect(onToggle).toHaveBeenLastCalledWith("kind", false);
    click(eltern);
    expect(onToggle).toHaveBeenLastCalledWith("eltern", true);
    const [liEltern, liKind] = Array.from(root.querySelectorAll("li"));
    expect(liEltern.classList.contains("cockpit-briefing-done")).toBe(false);
    expect(liKind.classList.contains("cockpit-briefing-done")).toBe(true);
  });

  it("i) Box mit leerem Schlüssel und gesperrt: disabled, kein Listener, kein Textvergleich", () => {
    const root = render(`<ul>${item("Irgendwas")}${item("Zwei")}</ul>`);
    const onToggle = vi.fn();
    expect(attachBriefingChecks(root, [box(1, "", true), box(2, "zwei")], new Set(), onToggle)).toBe(true);
    const [leer] = checks(root);
    expect(leer.disabled).toBe(true);
    // Auch ohne disabled hängt kein Listener an der gesperrten Checkbox.
    leer.disabled = false;
    click(leer);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("j) Markdown-Reste im Schlüssel stören den Textvergleich nicht", () => {
    const root = render(`<ul><li class="task-list-item"><input type="checkbox" class="task-list-item-checkbox">Mail an <em>Team</em> (heute)</li></ul>`);
    const onToggle = vi.fn();
    expect(attachBriefingChecks(root, [box(1, "mail an *team* (heute)")], new Set(), onToggle)).toBe(true);
    click(checks(root)[0]);
    expect(onToggle).toHaveBeenCalledWith("mail an *team* (heute)", true);
  });
});

describe("attachBriefingChecks: erste Zeile, leere Schlüssel, Ränder (Fix-Runde 1)", () => {
  it("I4) Fortsetzungszeile im Textknoten: nur die erste Zeile zählt", () => {
    const root = render(`<ul>${item("Mail an Team\nDetails folgen")}</ul>`);
    expect(attachBriefingChecks(root, [box(1, "mail an team")], new Set(), vi.fn())).toBe(true);
  });

  it("I4) lockere Liste: nur der erste Absatz zählt", () => {
    const root = render(`<ul><li class="task-list-item"><p><input type="checkbox" class="task-list-item-checkbox">Mail an Team</p><p>Mehr dazu</p></li></ul>`);
    expect(attachBriefingChecks(root, [box(1, "mail an team")], new Set(), vi.fn())).toBe(true);
  });

  it("I4) Zeilenumbruch per <br>: nur der Text davor zählt", () => {
    const root = render(`<ul>${item("Mail an Team<br>Zusatz")}</ul>`);
    expect(attachBriefingChecks(root, [box(1, "mail an team")], new Set(), vi.fn())).toBe(true);
  });

  it("I4) Leerzeile vor dem Text zählt nicht als erste Zeile", () => {
    const root = render(`<ul>${item("\nMail an Team")}</ul>`);
    expect(attachBriefingChecks(root, [box(1, "mail an team")], new Set(), vi.fn())).toBe(true);
  });

  it("I4) wirklich anderer Text in der ersten Zeile bleibt false", () => {
    const root = render(`<ul>${item("Anruf beim Amt\nMail an Team")}</ul>`);
    expect(attachBriefingChecks(root, [box(1, "mail an team")], new Set(), vi.fn())).toBe(false);
    untouched(root);
  });

  it("M1) Schlüssel ohne Buchstaben und Ziffern (Emoji) besteht den Vergleich nie", () => {
    const root = render(`<ul>${item("🚿")}${item("🏋️")}</ul>`);
    expect(attachBriefingChecks(root, [box(1, "🏋️"), box(2, "🚿")], new Set(), vi.fn())).toBe(false);
    untouched(root);
    const same = render(`<ul>${item("🚿")}</ul>`);
    expect(attachBriefingChecks(same, [box(1, "🚿")], new Set(), vi.fn())).toBe(false);
  });

  it("zweiter Klick eines Doppelklicks schaltet nicht (die Karte ist nach dem ersten schon neu geladen)", () => {
    const root = render(`<ul>${item("Eins")}</ul>`);
    const onToggle = vi.fn();
    expect(attachBriefingChecks(root, [box(1, "eins")], new Set(), onToggle)).toBe(true);
    const e = new MouseEvent("click", { bubbles: true, cancelable: true, detail: 2 });
    checks(root)[0].dispatchEvent(e);
    expect(onToggle).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(true);
  });

  it("M5) liegt der gerenderte Bereich selbst in einem Zitat, zählen seine Checkboxen", () => {
    const quote = document.createElement("blockquote");
    const root = render(`<ul>${item("Eins")}</ul>`);
    quote.append(root);
    const onToggle = vi.fn();
    expect(attachBriefingChecks(root, [box(1, "eins")], new Set(), onToggle)).toBe(true);
    click(checks(root)[0]);
    expect(onToggle).toHaveBeenCalledWith("eins", true);
  });

  it("M5) Checkbox ohne umgebendes li bei nicht leerem Schlüssel: false", () => {
    const root = render(`<p><input type="checkbox" class="task-list-item-checkbox">Eins</p>`);
    expect(attachBriefingChecks(root, [box(1, "eins")], new Set(), vi.fn())).toBe(false);
    untouched(root);
  });
});

describe("renderBriefingWithChecks", () => {
  const HTML: Record<string, string> = {
    marked: `<ul>${item("Eins")}${item("Zwei")}</ul>`,
    original: `<ul>${item("Eins")}</ul>`,
    embed: `<p>Text</p><ul>${item("Eingebettet")}</ul>`,
  };
  function fakeRender() {
    const calls: string[] = [];
    const disposed: string[] = [];
    const render = vi.fn((markdown: string) => {
      calls.push(markdown);
      const el = document.createElement("div");
      el.innerHTML = HTML[markdown] ?? "";
      el.dataset.md = markdown;
      return Promise.resolve({ el, dispose: () => disposed.push(markdown) });
    });
    return { calls, disposed, render };
  }

  it("Zuordnung passt: genau ein Render des markierten Texts, checks true, kein Hinweis", async () => {
    const f = fakeRender();
    const onToggle = vi.fn();
    const r = await renderBriefingWithChecks({ text: "original", marked: "marked", boxes: [box(1, "eins"), box(2, "zwei")], done: new Set(), render: f.render, onToggle });
    expect(f.calls).toEqual(["marked"]);
    expect(f.disposed).toEqual([]);
    expect(r.checks).toBe(true);
    expect(r.hint).toBeNull();
    expect(r.el.dataset.md).toBe("marked");
    click(checks(r.el)[1]);
    expect(onToggle).toHaveBeenCalledWith("zwei", true);
  });

  it("Zuordnung scheitert: erstes Ergebnis abgebaut, genau der Originaltext neu gerendert, Hinweis gesetzt", async () => {
    const f = fakeRender();
    const r = await renderBriefingWithChecks({ text: "original", marked: "marked", boxes: [box(1, "eins"), box(2, "anders")], done: new Set(), render: f.render, onToggle: vi.fn() });
    expect(f.calls).toEqual(["marked", "original"]);
    expect(f.disposed).toEqual(["marked"]);
    expect(r.checks).toBe(false);
    expect(r.el.dataset.md).toBe("original");
    expect(r.hint).toBe("Abhaken ist in diesem Briefing gerade nicht möglich; in der Karte „Heute“ geht es weiter.");
    expect(CHECKS_UNAVAILABLE_HINT).toBe(r.hint);
    r.dispose();
    expect(f.disposed).toEqual(["marked", "original"]);
  });

  it("ohne Boxen kein Hinweis, auch wenn der Rückfall greift", async () => {
    const f = fakeRender();
    const r = await renderBriefingWithChecks({ text: "original", marked: "embed", boxes: [], done: new Set(), render: f.render, onToggle: vi.fn() });
    expect(f.calls).toEqual(["embed", "original"]);
    expect(r.checks).toBe(false);
    expect(r.hint).toBeNull();
  });

  it("überholt nach dem ersten Render: kein zweiter Render, nichts angehängt, der Aufrufer verwirft", async () => {
    const f = fakeRender();
    const onToggle = vi.fn();
    const r = await renderBriefingWithChecks({
      text: "original", marked: "marked", boxes: [box(1, "eins"), box(2, "zwei")], done: new Set(), render: f.render, onToggle, stale: () => true,
    });
    expect(f.calls).toEqual(["marked"]);
    expect(f.disposed).toEqual([]);
    expect(r.checks).toBe(false);
    expect(r.el.querySelectorAll(".cockpit-briefing-point")).toHaveLength(0);
    click(checks(r.el)[0]);
    expect(onToggle).not.toHaveBeenCalled();
  });
});
