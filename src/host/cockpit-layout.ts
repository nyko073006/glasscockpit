import type { CockpitFeed, CockpitFeedActions } from "../core/cockpit-feed";
import { DEFAULT_COCKPIT_CROP } from "../core/constants";
import { OPEN_SETTINGS_TEXT, UNSET_SHORT, UNSET_TEXT } from "../core/unset";
import {
  type CardId, FIELDS, FIELD_TITLES, type FieldId, type FieldSettings, type FieldValues, PANELS, PANEL_TITLES,
  IMAGE_H, IMAGE_W, type PanelGeometry, type PanelId, type PanelValues, type Instrument, type Tone, fieldValues, polygonCss, stagePlacement, viewAspect, viewRect, zoomTargets,
} from "../core/cockpit-panels";
import type { EffortStep } from "../core/effort";
import type { CockpitCrop } from "../core/settings";
import { mountEffortLever } from "./effort-lever";
import type { PopoutWindow } from "./popout-window";

/**
 * Bühne der Cockpit-Ansicht (Abend 15): Hintergrundbild, Instrumente auf den Flächen und Zoom-Overlay.
 * Nur DOM-APIs, kein Import von obsidian: Das Dokument kommt als Parameter (Pop-out-Fenster haben ein eigenes),
 * damit Tests und die Vorschau-Seite es genauso rendern wie das Plugin. Die Daten liefert der Aufrufer
 * (`update`), geladen wird hier nichts. Kein Timer: Glanz und Übergänge macht allein das CSS.
 *
 * Ausschnitt (Abend 19b): Die Bühne (volles Bild, alle Prozentwerte der Flächen relativ zu ihr) steht in einem Fenster
 * `.cockpit-window`, das die Pane einpasst (Breite füllt sie, solange die Höhe reicht). „zugeschnitten“ zeigt `VIEW_CROP`: Die Bühne ist
 * dann größer als das Fenster und nach links oben geschoben, `overflow: hidden` schneidet den Rest ab; „voll“ lässt die Bühne das Fenster füllen.
 * Klickflächen und Zoom hängen an der Bühne und ziehen mit; das Zoom-Overlay ist ein Kind der Wurzel und deckt immer die ganze Pane.
 */
export interface CockpitLayoutOptions {
  doc: Document;
  /** Adresse des Hintergrundbilds (im Plugin die eingebettete Data-URL). */
  backgroundUrl: string;
  /** Die vollen Karten; sie liegen im Regal und wandern für den Zoom ins Overlay, es sind immer dieselben Elemente. */
  cards: Record<CardId, HTMLElement>;
  /** Ansicht beim Aufbau (Vorgabe: zugeschnitten); später über `setCrop`. */
  crop?: CockpitCrop;
  /** Vor dem Öffnen eines Zooms (das Briefing klappt dort auf). */
  onZoom?: (panel: PanelId) => void;
  /** Nach dem Schließen eines Zooms (der Aufrufer stellt zurück, was er für den Zoom geändert hat). */
  onZoomClose?: () => void;
  /** Klicks und Tasten der neuen Flächen (Abend 18); ohne sie bleiben die Flächen stumm. */
  actions?: CockpitFeedActions;
}

export interface CockpitLayout {
  /** Wurzel; der Aufrufer hängt sie in seine View. */
  readonly el: HTMLElement;
  /** Verborgenes Regal der Karten (außerhalb des Bildschirms, aber im Layout, damit `isShown()` der Karten stimmt). */
  readonly shelf: HTMLElement;
  update(values: PanelValues): void;
  /** Neue Flächen (Abend 18) aus dem Feed; gleicher Stand baut nichts neu auf (ein Klick im Neuaufbau ginge verloren). */
  updateFeed(feed: CockpitFeed, settings: FieldSettings, now: number): void;
  zoomed(): PanelId | null;
  /** Offener Zoom einer neuen Fläche (Sitzungen, Ringe, Vault, Repos, Radare) oder null. */
  zoomedField(): FieldId | null;
  /** Wechselt zwischen zugeschnitten und voll, sofort; Zoom, Karten und Instrumente bleiben unberührt. */
  setCrop(mode: CockpitCrop): void;
  crop(): CockpitCrop;
  zoom(id: PanelId): void;
  zoomField(id: FieldId): void;
  closeZoom(): void;
  /** Schließt den Zoom, gibt die Karten ans Regal zurück, meldet alle Listener ab und entfernt die Bühne. */
  destroy(): void;
}

/** Reihenfolge der Karten im Regal und im Zoom (Kopf, dann wie im Listen-Dashboard). */
const CARD_ORDER: readonly CardId[] = ["pull", "briefing", "usage", "tasks", "skills", "research"];

const CARD_TITLES: Record<CardId, string> = {
  pull: "Pull", briefing: "Briefing", usage: "Usage", tasks: "Aufgaben", skills: "Skills", research: "Research",
};

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  // Obsidians createEl hängt an den Knoten, an dem es aufgerufen wird; das Fragment hält das Element, bis der Aufrufer es einhängt.
  const e = (doc.win as PopoutWindow).createFragment().createEl(tag, { cls });
  if (text !== undefined) e.textContent = text;
  return e;
}

function q1(root: HTMLElement, sel: string): HTMLElement {
  const e = root.querySelector<HTMLElement>(sel);
  if (!e) throw new Error(`fehlt: ${sel}`);
  return e;
}

function place(e: HTMLElement, r: { x: number; y: number; w: number; h: number }): void {
  e.style.left = `${r.x}%`;
  e.style.top = `${r.y}%`;
  e.style.width = `${r.w}%`;
  e.style.height = `${r.h}%`;
}

export function createCockpitLayout(opts: CockpitLayoutOptions): CockpitLayout {
  const { doc, cards } = opts;

  const root = el(doc, "div", "cockpit-stage-wrap");
  const win = el(doc, "div", "cockpit-window");
  const stage = el(doc, "div", "cockpit-stage");
  stage.style.setProperty("aspect-ratio", `${IMAGE_W} / ${IMAGE_H}`);
  const bg = el(doc, "img", "cockpit-bg");
  bg.setAttribute("src", opts.backgroundUrl);
  bg.setAttribute("alt", "");
  bg.setAttribute("draggable", "false");
  stage.append(bg);
  win.append(stage);
  root.append(win);

  // Ausschnitt: Seitenverhältnis des Fensters und Lage der Bühne darin. Nur diese vier Werte ändern sich, die Flächen nicht.
  let cropMode: CockpitCrop = opts.crop ?? DEFAULT_COCKPIT_CROP;
  const applyCrop = () => {
    const view = viewRect(cropMode);
    const p = stagePlacement(view);
    win.style.setProperty("--cockpit-view-aspect", String(viewAspect(view)));
    stage.style.width = `${p.width}%`;
    stage.style.left = `${p.left}%`;
    stage.style.top = `${p.top}%`;
    root.setAttribute("data-crop", cropMode);
  };
  applyCrop();

  const shelf = el(doc, "div", "cockpit-shelf");
  shelf.setAttribute("aria-hidden", "true");
  root.append(shelf);
  const toShelf = () => { for (const id of CARD_ORDER) shelf.append(cards[id]); };
  toShelf();

  // ---- Zoom ----
  let zoomId: PanelId | null = null;
  let fieldZoomId: FieldId | null = null;
  let zoomBody: HTMLElement | null = null;
  let overlay: HTMLElement | null = null;
  let opener: HTMLElement | null = null;
  const onKeydown = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || overlay === null) return;
    // Nur, was im Cockpit passiert: Escape im Terminal daneben gehört Claude und darf den Zoom nicht schließen.
    if (!(e.target instanceof Node) || !root.contains(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    closeZoom();
  };

  function closeZoom(): void {
    if (overlay === null) return;
    doc.removeEventListener("keydown", onKeydown, true);
    const wasPanel = zoomId !== null;
    zoomId = null;
    fieldZoomId = null;
    zoomBody = null;
    overlay.remove();
    overlay = null;
    toShelf();
    const back = opener;
    opener = null;
    if (back?.isConnected) back.focus();
    if (wasPanel) opts.onZoomClose?.();
  }

  /** Gemeinsames Gerüst: Overlay mit Kopf (Titel, ✕) und Körper; der Aufrufer füllt den Körper. */
  function openOverlay(label: string, title: string, fill: (body: HTMLElement) => void): void {
    overlay = el(doc, "div", "cockpit-zoom");
    overlay.addEventListener("click", (e) => { if (e.target === overlay) closeZoom(); });
    const panel = el(doc, "div", "cockpit-zoom-panel");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", label);
    panel.setAttribute("tabindex", "-1");
    const head = el(doc, "div", "cockpit-zoom-head");
    head.append(el(doc, "span", "cockpit-zoom-title", title));
    const close = el(doc, "button", "cockpit-zoom-close", "✕");
    close.setAttribute("type", "button");
    close.setAttribute("aria-label", "Schließen");
    close.addEventListener("click", () => closeZoom());
    head.append(close);
    const body = el(doc, "div", "cockpit-zoom-body");
    zoomBody = body;
    fill(body);
    panel.append(head, body);
    overlay.append(panel);
    root.append(overlay);
    doc.addEventListener("keydown", onKeydown, true);
    panel.focus();
  }

  function zoom(id: PanelId): void {
    if (zoomId === id) return;
    const from = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
    closeZoom();
    opts.onZoom?.(id);
    const targets = zoomTargets(id);
    openOverlay(PANEL_TITLES[id], targets.length === 1 ? CARD_TITLES[targets[0]] : PANEL_TITLES[id], (body) => {
      for (const t of targets) body.append(cards[t]);
    });
    zoomId = id;
    opener = from;
  }

  function zoomField(id: FieldId): void {
    if (fieldZoomId === id) return;
    const from = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
    closeZoom();
    openOverlay(FIELD_TITLES[id], fieldZoomTitle(id), (body) => renderFieldZoom(id, body));
    fieldZoomId = id;
    opener = from;
  }

  // ---- Flächen ----
  const panelEls = new Map<PanelId, HTMLElement>();
  const contentEls = new Map<PanelId, HTMLElement>();

  const activate = (e: HTMLElement, id: PanelId) => {
    e.setAttribute("role", "button");
    e.setAttribute("tabindex", "0");
    e.setAttribute("aria-label", `${PANEL_TITLES[id]} vergrößern`);
    e.addEventListener("click", () => zoom(id));
    e.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        zoom(id);
      }
    });
  };

  for (const g of PANELS) {
    const outer = el(doc, "div", `cockpit-panel cockpit-panel-${g.id} cockpit-tone-plain`);
    place(outer, g.rect);
    // Der Glanz beim Darüberfahren liegt als drop-shadow am äußeren Element: clip-path am inneren schnitte ihn ab.
    const clipEl = el(doc, "div", "cockpit-panel-clip");
    clipEl.style.setProperty("clip-path", polygonCss(g.polygon));
    const content = el(doc, "div", "cockpit-panel-content");
    place(content, g.content);
    clipEl.append(content);
    outer.append(clipEl);
    activate(outer, g.id);
    stage.append(outer);
    panelEls.set(g.id, outer);
    contentEls.set(g.id, content);
  }

  // ---- Neue Flächen (Abend 18) ----
  const fieldEls = new Map<FieldId, { outer: HTMLElement; clip: HTMLElement; content: HTMLElement }>();
  let current: FieldValues | null = null;
  const actions = opts.actions;

  const press = (e: HTMLElement, fn: () => void) => {
    e.addEventListener("click", fn);
    e.addEventListener("keydown", (ev) => {
      // Nur Tasten auf der Fläche selbst; Enter auf einer Taste darin gehört dieser Taste.
      if (ev.target !== e || (ev.key !== "Enter" && ev.key !== " ")) return;
      ev.preventDefault();
      fn();
    });
  };

  for (const g of FIELDS) {
    const outer = el(doc, "div", `cockpit-field cockpit-field-${g.id} cockpit-tone-plain`);
    place(outer, g.rect);
    // Die Boxen von Repos und Radaren überlappen: nur die Fläche im clip-path fängt Klicks (clip-path wirkt auch auf die Trefferprüfung);
    // der äußere Rahmen ist im Stylesheet pointer-events: none, die Fläche auto.
    const clipEl = el(doc, "div", "cockpit-field-clip");
    clipEl.style.setProperty("clip-path", polygonCss(g.polygon));
    const content = el(doc, "div", "cockpit-field-content");
    place(content, g.content);
    if (g.id === "focus") content.setAttribute("lang", "de"); // Silbentrennung (CSS hyphens) braucht die Sprache
    if (g.circle) {
      const ring = el(doc, "div", "cockpit-ring");
      clipEl.append(ring);
    }
    clipEl.append(content);
    outer.append(clipEl);
    stage.append(outer);
    fieldEls.set(g.id, { outer, clip: clipEl, content });
  }
  const F = (id: FieldId) => fieldEls.get(id)!;

  const setFieldTone = (id: FieldId, tone: Tone | "rainbow", extra = "") => {
    F(id).outer.className = `cockpit-field cockpit-field-${id} cockpit-tone-${tone}${extra === "" ? "" : ` ${extra}`}`;
  };
  // Tooltip je Element aus genau einer Quelle: Obsidian zeigt aria-label als eigenen Tooltip (bricht bei \n um), der native
  // title erscheint in Obsidian nicht verlässlich. label null heißt, das Feld setzt sein aria-label später selbst (mit Zahlen).
  const makeButton = (id: FieldId, label: string | null, fn: () => void) => {
    const c = F(id).clip;
    c.setAttribute("role", "button");
    c.setAttribute("tabindex", "0");
    if (label !== null) c.setAttribute("aria-label", label);
    press(c, fn);
  };

  makeButton("radar", "Sitzungen vergrößern", () => zoomField("radar"));
  makeButton("focus", "Briefing öffnen", () => actions?.openBriefing());

  makeButton("gaugeLeft", null, () => zoomField("gaugeLeft"));
  makeButton("gaugeRight", null, () => zoomField("gaugeRight"));
  makeButton("vault", "Vault vergrößern", () => zoomField("vault"));
  makeButton("repos", "Repos vergrößern", () => zoomField("repos"));
  makeButton("radars", "Radare vergrößern", () => zoomField("radars"));
  // Knauf des Schalthebels (a18e): grünes Plus, Klick, Enter und Leertaste öffnen den Dialog „Neue Sitzung“.
  makeButton("newSession", "Neue Sitzung", () => actions?.newSession());
  F("newSession").content.replaceChildren(el(doc, "div", "cockpit-newsession-plus", "+"));
  // Kippschalter (Telegram, Ton): gleicher Aufbau, gleiche Klassen.
  // Das aria-label mit Zustand („Ton und Banner an“) setzt das Update, siehe makeButton.
  const makeSwitch = (id: FieldId, label: string, fn: () => void): HTMLElement => {
    const c = F(id).clip;
    c.setAttribute("role", "switch");
    c.setAttribute("tabindex", "0");
    press(c, fn);
    const lever = el(doc, "div", "cockpit-switch-lever");
    lever.append(el(doc, "div", "cockpit-switch-knob"));
    const state = el(doc, "div", "cockpit-switch-state", "");
    F(id).content.append(el(doc, "div", "cockpit-switch-label", label), lever, state);
    return state;
  };
  const telegramState = makeSwitch("telegram", "TG", () => actions?.toggleTelegram());
  const soundState = makeSwitch("sound", "TON", () => actions?.toggleSound());

  // Effort-Bildschirm (19e): ein Schieber statt der Knopfliste aus 19b. Der Griff wandert beim Ziehen frei und rastet beim Loslassen ein;
  // gemeldet wird erst dann, ein `setEffort` je Zug und nur bei geänderter Stufe (siehe `host/effort-lever.ts`). Anders als die Liste zeigt er die
  // gewählte Stufe sofort (der Nutzer hat ihn dorthin gezogen); der Ton folgt gleich mit. Meldet der Feed beim nächsten Stand die alte Stufe zurück
  // (Speichern missglückt), kehren Griff und Ton um: `show` und der Ton laufen darum bei jedem Stand, nicht über `redraw`.
  F("effort").clip.setAttribute("role", "group");
  /** Ton und Beschriftung der Fläche zur Stufe (grau bei `aus`, sonst grün); der Griff selbst gehört dem Schieber. */
  const setEffortLook = (step: EffortStep) => {
    const tone = step === "aus" ? "gray" : "green";
    if (!F("effort").outer.classList.contains(`cockpit-tone-${tone}`)) setFieldTone("effort", tone);
    F("effort").clip.setAttribute("aria-label", `Effort der nächsten Sitzung: ${step}`);
  };
  const effortLever = mountEffortLever({
    doc,
    host: F("effort").content,
    onSet: (step) => {
      setEffortLook(step);
      actions?.setEffort(step);
    },
  });

  const sigs = new Map<string, string>();
  /** Zeichnet nur neu, wenn sich der Stand der Fläche geändert hat. */
  const redraw = (id: string, sig: unknown, draw: () => void) => {
    const text = JSON.stringify(sig);
    if (sigs.get(id) === text) return;
    sigs.set(id, text);
    draw();
  };

  function ringUpdate(id: FieldId, r: FieldValues["gaugeLeft"], label: string): void {
    const f = F(id);
    setFieldTone(id, r.tone);
    const ring = q1(f.clip, ".cockpit-ring");
    ring.style.setProperty("--fill", `${Math.round(r.fill * 10000) / 100}%`);
    ring.className = r.pulse ? "cockpit-ring cockpit-ring-pulse" : "cockpit-ring";
    f.clip.setAttribute("aria-label", r.tooltip);
    f.content.textContent = label;
  }

  function updateFeed(feed: CockpitFeed, settings: FieldSettings, now: number): void {
    const v = fieldValues(feed, settings, now);
    current = v;

    redraw("radar", [v.radar.rows, v.radar.more], () => {
      const parts: HTMLElement[] = v.radar.rows.map((r) => {
        const row = el(doc, "button", "cockpit-radar-row");
        row.setAttribute("type", "button");
        row.dataset.id = r.id;
        row.setAttribute("title", r.name);
        row.append(el(doc, "span", `cockpit-lamp cockpit-lamp-${r.lamp}`), el(doc, "span", "cockpit-radar-name", r.name));
        row.addEventListener("click", (e) => { e.stopPropagation(); actions?.focusSession(r.id); });
        return row;
      });
      if (v.radar.more !== null) parts.push(el(doc, "div", "cockpit-radar-more", v.radar.more));
      F("radar").content.replaceChildren(...parts);
    });

    redraw("newSession", [v.newSession.hint], () => {
      const c = F("newSession").content;
      c.replaceChildren(el(doc, "div", "cockpit-newsession-plus", "+"));
      if (v.newSession.hint) c.appendChild(el(doc, "div", "cockpit-field-hint", v.newSession.hint));
    });

    redraw("focus", [v.focus, v.focusHint], () => {
      // Kopfzeile nur mit Punkten; jeder Punkt bricht um (CSS), der volle Text steht als aria-label.
      const lines = v.focus.map((l) => {
        const line = el(doc, "div", "cockpit-focus-line", l);
        line.setAttribute("aria-label", l);
        return line;
      });
      if (v.focusHint !== null) {
        const unset = el(doc, "div", "cockpit-focus-line cockpit-focus-unset", UNSET_TEXT);
        unset.setAttribute("aria-label", v.focusHint);
        F("focus").content.replaceChildren(el(doc, "div", "cockpit-focus-head", "HEUTE DRAN"), unset);
        return;
      }
      F("focus").content.replaceChildren(...(lines.length === 0 ? [] : [el(doc, "div", "cockpit-focus-head", "HEUTE DRAN"), ...lines]));
    });

    ringUpdate("gaugeLeft", v.gaugeLeft, "CTX");
    ringUpdate("gaugeRight", v.gaugeRight, "OUT");

    redraw("vault", v.vault.lines, () => {
      F("vault").content.replaceChildren(
        el(doc, "div", "cockpit-field-title", "VAULT"),
        ...v.vault.lines.map((l) => {
          const line = el(doc, "div", `cockpit-vault-line cockpit-tone-${l.tone}`);
          line.append(el(doc, "span", "cockpit-vault-label", l.label), doc.createTextNode(" "), el(doc, "span", "cockpit-vault-value", l.value));
          if (l.hint !== undefined) line.setAttribute("aria-label", `${l.label}: ${l.hint}`);
          return line;
        }),
      );
    });

    redraw("repos", [v.repos.big, v.repos.tone, v.repos.hint], () => {
      setFieldTone("repos", v.repos.tone);
      F("repos").clip.setAttribute("aria-label", v.repos.hint === undefined ? "Repos vergrößern" : `Repos vergrößern: ${v.repos.hint}`);
      F("repos").content.replaceChildren(el(doc, "div", "cockpit-field-title", "REPOS"), el(doc, "div", v.repos.big === UNSET_SHORT ? "cockpit-big cockpit-big-short" : "cockpit-big", v.repos.big));
    });

    redraw("radars", [v.radars.lamps.map((l) => [l.id, l.tone, l.short, l.label]), v.radars.hint], () => {
      if (v.radars.hint !== null) {
        // Kurz „aus“ in der Größe der Radar-Beschriftung; der volle Hinweis steht in aria-label und title.
        const unset = el(doc, "div", "cockpit-radars-unset", UNSET_SHORT);
        unset.setAttribute("aria-label", v.radars.hint);
        unset.setAttribute("title", v.radars.hint);
        F("radars").content.replaceChildren(unset);
        return;
      }
      F("radars").content.replaceChildren(...v.radars.lamps.map((l) => {
        const lamp = el(doc, "div", `cockpit-radar-lamp cockpit-tone-${l.tone}`);
        lamp.setAttribute("title", `${l.label}: ${l.text}`);
        lamp.append(el(doc, "span", "cockpit-radar-lamp-dot"), el(doc, "span", "cockpit-radar-lamp-name", l.short));
        return lamp;
      }));
    });

    effortLever.show(v.effort.step);
    setEffortLook(v.effort.step);

    redraw("telegram", v.telegram.on, () => {
      setFieldTone("telegram", v.telegram.on ? "green" : "gray", v.telegram.on ? "cockpit-switch-on" : "");
      F("telegram").clip.setAttribute("aria-checked", String(v.telegram.on));
      F("telegram").clip.setAttribute("aria-label", v.telegram.on ? "Telegram-Meldungen an" : "Telegram-Meldungen aus");
      telegramState.textContent = v.telegram.on ? "AN" : "AUS";
    });

    redraw("sound", v.sound.on, () => {
      setFieldTone("sound", v.sound.on ? "green" : "gray", v.sound.on ? "cockpit-switch-on" : "");
      F("sound").clip.setAttribute("aria-checked", String(v.sound.on));
      F("sound").clip.setAttribute("aria-label", v.sound.on ? "Ton und Banner an" : "Ton und Banner aus");
      soundState.textContent = v.sound.on ? "AN" : "AUS";
    });

    // LOC und Commits heute: reine Anzeige (kein Zoom), Tooltip mit den stärksten Repos.
    for (const [id, short] of [["loc", "LOC"], ["commits", "COM"]] as const) {
      const d = v[id];
      redraw(id, [d.big, d.tooltip], () => {
        F(id).clip.setAttribute("aria-label", `${FIELD_TITLES[id]}: ${d.big}\n${d.tooltip}`);
        // Der Schlitz ist schmal: Tausender-„k“ wandert in die Beschriftung (kLOC), die Schrift wächst nach Zeichenzahl (CSS --chars).
        const kilo = d.big.endsWith("k");
        const zahl = kilo ? d.big.slice(0, -1) : d.big;
        const big = el(doc, "div", "cockpit-big", zahl);
        big.style.setProperty("--chars", String(zahl.length));
        F(id).content.replaceChildren(el(doc, "div", "cockpit-field-title", kilo ? `k${short}` : short), big);
      });
    }

    // Offener Zoom: nur bei geändertem Stand neu füllen.
    if (fieldZoomId !== null && zoomBody !== null) {
      const body = zoomBody;
      const id = fieldZoomId;
      redraw(`zoom:${id}`, zoomSig(id, v), () => { body.replaceChildren(); renderFieldZoom(id, body); });
    }
  }

  function fieldZoomTitle(id: FieldId): string {
    return id === "gaugeLeft" || id === "gaugeRight" ? "Kontext und Tokens" : FIELD_TITLES[id];
  }

  function zoomSig(id: FieldId, v: FieldValues): unknown {
    switch (id) {
      case "radar": return v.radar.sessions;
      case "gaugeLeft": case "gaugeRight": return [v.gaugeLeft, v.gaugeRight];
      case "vault": return v.vault;
      case "repos": return v.repos;
      case "radars": return v.radars;
      default: return null;
    }
  }

  const row = (cls: string, ...parts: Array<string | Node>): HTMLElement => {
    const r = el(doc, "div", cls);
    r.append(...parts);
    return r;
  };

  /** Knopf unter einem Hinweis „nicht eingerichtet“: springt in die Einstellungen. */
  function openSettingsButton(): HTMLElement {
    const b = el(doc, "button", "cockpit-unset-open", OPEN_SETTINGS_TEXT);
    b.setAttribute("type", "button");
    b.addEventListener("click", () => actions?.openSettings());
    return b;
  }

  function renderFieldZoom(id: FieldId, body: HTMLElement): void {
    const v = current;
    if (v === null) return;
    sigs.set(`zoom:${id}`, JSON.stringify(zoomSig(id, v)));
    switch (id) {
      case "radar":
        if (v.radar.sessions.length === 0) body.append(el(doc, "div", "cockpit-zoom-empty", "Keine Sitzung offen."));
        for (const s of v.radar.sessions) {
          const b = el(doc, "button", "cockpit-zoom-session");
          b.setAttribute("type", "button");
          b.append(
            el(doc, "span", `cockpit-lamp cockpit-lamp-${s.lamp}`),
            el(doc, "span", "cockpit-zoom-session-name", s.name),
            el(doc, "span", "cockpit-zoom-session-state", s.ageText === null ? s.lampText : `${s.lampText}, ${s.ageText}`),
            el(doc, "span", "cockpit-zoom-session-cwd", s.cwd),
          );
          b.addEventListener("click", () => { closeZoom(); actions?.focusSession(s.id); });
          body.append(b);
        }
        break;
      case "gaugeLeft":
      case "gaugeRight":
        for (const [title, r] of [["Kontext der aktiven Sitzung", v.gaugeLeft], ["Output-Tokens heute", v.gaugeRight]] as const) {
          const sec = el(doc, "div", `cockpit-zoom-gauge cockpit-tone-${r.tone}`);
          sec.append(el(doc, "div", "cockpit-zoom-gauge-title", title), ...r.lines.map((l) => el(doc, "div", "cockpit-zoom-line", l)));
          body.append(sec);
        }
        break;
      case "vault": {
        for (const l of v.vault.lines) {
          body.append(row(`cockpit-zoom-line cockpit-tone-${l.tone}`, `${l.label}: `, el(doc, "span", "cockpit-vault-value", l.value)));
          if (l.hint !== undefined) body.append(el(doc, "div", "cockpit-zoom-hint", l.hint));
        }
        if (v.vault.lines.some((l) => l.hint !== undefined)) body.append(openSettingsButton());
        // Ohne lintCommand gibt es die Taste nicht (Abend 21).
        if (v.vault.lint) {
          const lint = el(doc, "button", "cockpit-lint-button", "Lint starten");
          lint.setAttribute("type", "button");
          lint.addEventListener("click", () => actions?.startLint());
          body.append(lint);
        }
        body.append(el(doc, "div", "cockpit-zoom-subtitle", v.vault.inbox.length === 0 ? "Inbox leer" : "Inbox"));
        for (const path of v.vault.inbox) {
          const a = el(doc, "button", "cockpit-link", path);
          a.setAttribute("type", "button");
          a.addEventListener("click", () => actions?.openNote(path));
          body.append(a);
        }
        break;
      }
      case "repos":
        if (v.repos.hint !== undefined) body.append(el(doc, "div", "cockpit-zoom-hint", v.repos.hint), openSettingsButton());
        else if (v.repos.list.length === 0) body.append(el(doc, "div", "cockpit-zoom-empty", "Noch keine Repo-Abfrage."));
        for (const r of v.repos.list) body.append(row(`cockpit-repo-row cockpit-tone-${r.tone}`, el(doc, "span", "cockpit-repo-name", r.name), doc.createTextNode(" "), el(doc, "span", "cockpit-repo-state", r.state)));
        break;
      case "radars":
        if (v.radars.hint !== null) body.append(el(doc, "div", "cockpit-zoom-hint", v.radars.hint), openSettingsButton());
        for (const l of v.radars.lamps) body.append(row(`cockpit-zoom-radar cockpit-tone-${l.tone}`, el(doc, "span", "cockpit-radar-lamp-dot"), el(doc, "span", "cockpit-zoom-radar-name", l.label), el(doc, "span", "cockpit-zoom-radar-text", l.text)));
        break;
      default:
        break;
    }
  }

  // ---- Inhalte ----
  const setTone = (id: PanelId, tone: Tone) => {
    const e = panelEls.get(id);
    if (e) e.className = `cockpit-panel cockpit-panel-${id} cockpit-tone-${tone}`;
  };

  const instrument = (g: PanelGeometry, v: Instrument) => {
    const c = contentEls.get(g.id);
    if (!c) return;
    const parts: HTMLElement[] = [el(doc, "div", "cockpit-inst-title", PANEL_TITLES[g.id].toUpperCase())];
    if (v.big !== "") parts.push(el(doc, "div", "cockpit-inst-big", v.big));
    parts.push(...v.lines.map((l) => el(doc, "div", "cockpit-inst-line", l)));
    if (v.bar !== undefined) {
      const bar = el(doc, "div", "cockpit-inst-bar");
      bar.setAttribute("role", "progressbar");
      bar.setAttribute("aria-valuemin", "0");
      bar.setAttribute("aria-valuemax", "100");
      bar.setAttribute("aria-valuenow", String(v.bar));
      const fill = el(doc, "div", "cockpit-inst-bar-fill");
      fill.style.width = `${v.bar}%`;
      bar.append(fill);
      parts.push(bar);
    }
    c.replaceChildren(...parts);
    // Kurzfassung im Feld, voller Text im Tooltip (Obsidian zeigt aria-label); ohne Hinweis wieder der Standardtext.
    panelEls.get(g.id)?.setAttribute("aria-label", v.hint === undefined ? `${PANEL_TITLES[g.id]} vergrößern` : `${PANEL_TITLES[g.id]} vergrößern: ${v.hint}`);
    setTone(g.id, v.tone);
  };

  function update(v: PanelValues): void {
    for (const g of PANELS) {
      if (g.id === "briefing") instrument(g, v.briefing);
      else if (g.id === "usage") instrument(g, v.usage);
      else if (g.id === "week") instrument(g, v.week);
      else if (g.id === "warnings") instrument(g, v.warnings);
      else if (g.id === "tasks") instrument(g, v.tasks);
      else if (g.id === "research") instrument(g, v.research);
      else if (g.id === "system") instrument(g, v.system);
    }
    setTone("lamp-pull", v.lampPull);
  }

  function setCrop(mode: CockpitCrop): void {
    if (mode === cropMode) return;
    cropMode = mode;
    applyCrop();
  }

  function destroy(): void {
    closeZoom();
    toShelf();
    root.remove();
  }

  return { el: root, shelf, update, updateFeed, zoomed: () => zoomId, zoomedField: () => fieldZoomId, setCrop, crop: () => cropMode, zoom, zoomField, closeZoom, destroy };
}
