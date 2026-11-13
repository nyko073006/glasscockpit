import type { BriefingBox } from "../core/focus";

/** Nur Buchstaben und Ziffern, klein: Markdown-Reste im Schlüssel und Formatierung im gerenderten Text fallen weg. */
const reduce = (text: string): string => text.replace(/[^\p{L}\p{N}]+/gu, "").toLowerCase();

/**
 * Erste Zeile des eigenen Texts eines Listenpunkts: ohne verschachtelte Unterlisten (die haben eigene Checkboxen und
 * Boxen), bei lockeren Listen nur der erste Absatz (`p`-Kind), sonst bis zum ersten Zeilenumbruch (`\n` oder `<br>`).
 * Leerzeilen davor zählen nicht. Fortsetzungszeilen und Folgeabsätze gehören nicht zum Schlüssel.
 */
function firstLine(li: Element): string {
  const copy = li.cloneNode(true) as Element;
  for (const sub of Array.from(copy.querySelectorAll("ul, ol"))) sub.remove();
  for (const br of Array.from(copy.querySelectorAll("br"))) br.replaceWith("\n");
  const para = Array.from(copy.children).find((c) => c.tagName === "P");
  const text = (para ?? copy).textContent ?? "";
  return text.split("\n").find((line) => line.trim() !== "") ?? "";
}

/** Zeile über dem Briefing, wenn es Punkte gibt, das Abhaken im Text aber nicht zugeordnet werden konnte. */
export const CHECKS_UNAVAILABLE_HINT = "Abhaken ist in diesem Briefing gerade nicht möglich; in der Karte „Heute“ geht es weiter.";

export interface RenderedBriefing {
  el: HTMLElement;
  dispose: () => void;
}

/**
 * Rendert das heutige Briefing mit Checkboxen (Abend 44, Fix-Runde 1): erst `marked` (Ergebnis von `markBriefing`), dann
 * `attachBriefingChecks`. Gelingt die Zuordnung: genau ein Render, `checks` true. Sonst wird das erste Ergebnis per `dispose`
 * abgebaut und genau der Originaltext `text` gerendert, `checks` false; gab es Boxen, kommt dazu der Hinweis
 * `CHECKS_UNAVAILABLE_HINT`. Meldet `stale()` nach dem ersten Render wahr, kehrt die Funktion ohne Zuordnung und ohne
 * zweiten Render zurück; der Aufrufer verwirft das Ergebnis (samt `dispose`).
 */
export async function renderBriefingWithChecks(opts: {
  text: string;
  marked: string;
  boxes: readonly BriefingBox[];
  done: ReadonlySet<string>;
  render: (markdown: string) => Promise<RenderedBriefing>;
  onToggle: (key: string, done: boolean) => void;
  stale?: () => boolean;
}): Promise<RenderedBriefing & { checks: boolean; hint: string | null }> {
  const first = await opts.render(opts.marked);
  if (opts.stale?.()) return { ...first, checks: false, hint: null };
  if (attachBriefingChecks(first.el, opts.boxes, opts.done, opts.onToggle)) return { ...first, checks: true, hint: null };
  // Zuordnung von Checkbox und Punkt unsicher: lieber der unveränderte Text ohne Abhaken als ein falscher Haken.
  first.dispose();
  const plain = await opts.render(opts.text);
  return { ...plain, checks: false, hint: opts.boxes.length > 0 ? CHECKS_UNAVAILABLE_HINT : null };
}

/**
 * Hängt die Checkboxen des gerenderten heutigen Briefings an den Erledigt-Stand (Abend 44). `boxes` kommt aus
 * `scanBriefing`, gerendert wurde `markBriefing(text, scan, done)`. Gezählt werden `input.task-list-item-checkbox` in
 * Dokumentreihenfolge, ohne die in Zitaten und Callouts (dort gibt es keine Box). Die n-te Checkbox gehört zur n-ten Box,
 * wenn die Anzahl stimmt und die erste Zeile des eigenen Texts jedes Listenpunkts, auf Buchstaben und Ziffern reduziert, dem
 * ebenso reduzierten Schlüssel gleicht (Boxen mit leerem Schlüssel ohne Vergleich; bleibt vom Schlüssel reduziert nichts
 * übrig, etwa bei reinen Emoji, gilt der Vergleich als nicht bestanden). Passt etwas nicht, bleibt alles unberührt
 * und das Ergebnis ist false: Die View rendert dann den unveränderten Text. Geprüft wird vollständig, bevor das erste
 * Element verändert wird. Schreibt nie in eine Datei; `onToggle` setzt den Stand im Store.
 */
export function attachBriefingChecks(
  rendered: HTMLElement,
  boxes: readonly BriefingBox[],
  done: ReadonlySet<string>,
  onToggle: (key: string, done: boolean) => void,
): boolean {
  const inputs = Array.from(rendered.querySelectorAll<HTMLInputElement>("input.task-list-item-checkbox")).filter((cb) => {
    const quote = cb.parentElement?.closest("blockquote, .callout");
    return !quote || !rendered.contains(quote);
  });
  if (inputs.length !== boxes.length) return false;
  const pairs = inputs.map((cb, i) => ({ cb, box: boxes[i], li: cb.closest("li") }));
  for (const { box, li } of pairs) {
    if (box.key === "") continue;
    const key = reduce(box.key);
    if (key === "" || !li || reduce(firstLine(li)) !== key) return false;
  }
  for (const { cb, box, li } of pairs) {
    li?.classList.add("cockpit-briefing-point");
    if (done.has(box.key)) li?.classList.add("cockpit-briefing-done");
    if (box.locked) {
      cb.disabled = true;
      continue;
    }
    cb.addEventListener("click", (e) => {
      // Kein Umschalten im DOM: Die Anzeige kommt über den Store (onTodayChange lädt neu).
      e.preventDefault();
      // Zweiter Klick eines Doppelklicks: Die Karte lädt nach dem ersten sofort neu, er träfe sonst die neue Checkbox und kippte zurück.
      if (e.detail > 1) return;
      onToggle(box.key, !done.has(box.key));
    });
  }
  return true;
}
