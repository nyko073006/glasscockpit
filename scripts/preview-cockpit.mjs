// Vorschau der Cockpit-Ansicht (Abend 15, ab Abend 18 mit den neuen Flächen): erzeugt build/preview-cockpit.html, eine statische Seite, die per file://
// im Browser aufgeht. Sie nimmt dieselbe src/host/cockpit-layout.ts, dieselbe Logik (src/core/cockpit-panels.ts)
// und dasselbe CSS (src/styles.css) wie das Plugin, gebündelt per esbuild, das Bild als Data-URL. Die Werte sind
// Beispieldaten; die vollen Karten im Zoom sind Platzhalter (die echten brauchen Obsidian).
//
// Adresse der Seite (alles hinter #, mit & trennen): crop=full | crop=crop (Ausschnitt, Vorgabe zugeschnitten), zoom=<flächenId> öffnet einen Zoom
// (radar, vault, repos, ... oder ein Panel wie system), limits=hoch zeigt knappe Limits (5h 92 %, Woche 75 %: Warnkasten rot mit „!“ und „knapp“),
// size=640x780 legt die Größe der Ansicht fest (headless Chrome hat bei --dump-dom ein um die Fensterleiste kürzeres Sichtfenster), probe schreibt das
// Ergebnis der Trefferprobe nach <pre id="probe-result"> und in den Titel. Effort-Schieber (Abend 19e): effort=<stufe> setzt den Anfangsstand, drag=<stufe>
// fasst den Griff an und hält ihn auf der Beschriftung dieser Stufe (Foto mitten im Zug), measure schreibt DOM-Maße und einen echten Zug je Stufe nach <pre id="measure-result">.
//
// Leeres Vault (Abend 21): vault=leer zeigt das Cockpit wie bei frischer Installation (DEFAULT_SETTINGS, keine Radare, alle Vault-Quellen „nicht eingerichtet“,
// kein Lint-Knopf, Briefing nicht eingerichtet, keine Aufgabendatei, Pull nicht eingerichtet; Usage, Sitzungen, Research und Kontext/Tokens bleiben Beispieldaten, weil sie nicht aus dem Vault kommen). Ohne vault=leer bekommt die Seite Beispieleinstellungen mit zwei Radaren und /lint. Mit --fotos entsteht zusätzlich leer-640x780.png.
//
// Fotos und Trefferprobe (Abend 19b): `node scripts/preview-cockpit.mjs --fotos <ordner>` baut die Seite und lässt Chrome headless je vier Fotos
// (640 x 780 und 1280 x 780, jeweils zugeschnitten und voll, Retina) schreiben und die Trefferprobe laufen (mit --nur-probe ohne die Fotos). Die Probe
// prüft in beiden Ansichten für Radar und Effort mit elementFromPoint: Mitte und je Kante des Polygons 3 px innerhalb treffen das Element der Fläche,
// 3 px außerhalb nicht. Exit-Code 1, wenn ein Treffer danebenliegt. Chrome liegt unter /Applications, anders über die Umgebungsvariable CHROME.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const buildDir = join(root, "build");
mkdirSync(buildDir, { recursive: true });

const entry = join(buildDir, "preview-entry.ts");
writeFileSync(entry, `
import type { CockpitFeed } from "../src/core/cockpit-feed";
import { type CockpitInputs, FIELDS, PANELS, type FieldId, type PanelId, panelValues } from "../src/core/cockpit-panels";
import { DEFAULT_SETTINGS, type CockpitCrop } from "../src/core/settings";
import { localDayKey } from "../src/core/vault-state";
import { createCockpitLayout } from "../src/host/cockpit-layout";
import background from "../assets/cockpit-bg.jpg";

const h = (tag: string, cls: string, text?: string): HTMLElement => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

// Platzhalterkarten: Kopf und ein paar Zeilen, damit der Zoom etwas zu zeigen hat.
const card = (title: string, date: string, lines: string[]): HTMLElement => {
  const c = h("div", "cockpit-card");
  const head = h("div", "cockpit-card-head");
  head.append(h("span", "cockpit-card-title", title), h("span", "cockpit-card-date", date));
  const body = h("div", "cockpit-card-body");
  for (const l of lines) body.append(h("div", "cockpit-hint", l));
  c.append(head, body);
  return c;
};
const pullHead = h("div", "cockpit-dashboard-head");
pullHead.append(h("span", "cockpit-pull-status", "zuletzt gepullt 21:20, ok"), h("button", "cockpit-pull-button", "Jetzt pullen"));

const cards = {
  pull: pullHead,
  briefing: card("Briefing", localDayKey(Date.now()), ["Platzhalter: In Obsidian steht hier der gerenderte Text der Tagesdatei."]),
  usage: card("Usage", "Stand gerade eben", ["5 Stunden: 42 % · Reset in 2 Std. 13 Min.", "Woche: 38 %", "Output-Tokens heute: 340.000"]),
  tasks: card("Aufgaben", "0/3", ["Platzhalter: Aufgabe eins", "Platzhalter: Aufgabe zwei", "Platzhalter: Aufgabe drei"]),
  skills: card("Skills", "", ["handoff", "plan-tag", "council"]),
  research: card("Research", "Stand vor 5 Min.", ["Platzhalter: zwei neue Repos"]),
};

const now = Date.now();
const pullAt = new Date();
pullAt.setHours(21, 20, 0, 0);
const repo = (id: number, name: string) => ({ id, full_name: "beispiel/" + name, html_url: "https://github.com/beispiel/" + name, stargazers_count: 42, description: "", pushed_at: "2026-10-04T10:00:00Z" });
const task = (line: number, text: string) => ({ kind: "task" as const, line, text, done: false, depth: 0 });

const hashOf0 = (key: string): string | null => new RegExp("[#&]" + key + "=([a-zA-Z]+)").exec(location.hash)?.[1] ?? null;
const hoch = /[#&]limits=hoch/.test(location.hash);
const inputs: CockpitInputs = {
  now,
  briefing: { kind: "ok", date: localDayKey(now) },
  usage: {
    snapshot: {
      writtenAt: now / 1000 - 20,
      windows: {
        five_hour: { usedPercentage: hoch ? 92 : 42, resetsAt: now / 1000 + 2 * 3600 + 13 * 60 + 30 },
        seven_day: { usedPercentage: hoch ? 75 : 38, resetsAt: now / 1000 + 3 * 86400 },
      },
    },
  },
  tasks: { kind: "ok", rows: [task(2, "Briefing abarbeiten"), task(3, "Skills ordnen"), task(4, "Research prüfen")] },
  research: {
    fetched_at: now,
    sections: [{ query: "claude-code", sort: "updated", count: 8, fetched_at: now, items: [repo(1, "cockpit-kit"), repo(2, "claude-notes"), repo(3, "alt")] }],
    seen: [3],
  },
  pull: { status: "ok", at: pullAt.getTime(), error: null },
};

const toast = document.getElementById("toast")!;
let toastTimer = 0;
const say = (text: string) => {
  toast.textContent = text;
  toast.classList.add("on");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("on"), 2200);
};

// Beispieldaten der neuen Flächen (Abend 18): sechs Sitzungen in gemischten Zuständen, Kontext gelb, Tokens grün,
// Inbox 3, Index 9 Tage alt (gelb), zwei Repos mit Handlungsbedarf, zwei Radare (Radar 1 grün, Radar 2 grau).
const sess = (id: string, name: string, o: object = {}) => ({ id, name, cwd: "/Users/alex/Documents/Projects/" + name, running: true, failed: false, signal: null, signalAt: null, seen: false, ...o });
const feed: CockpitFeed = {
  sessions: [
    sess("1", "glasscockpit", { signal: "busy", signalAt: now - 20_000, seen: true }),
    sess("2", "Vault", { signal: "question", signalAt: now - 3 * 60_000 }),
    sess("3", "grade-calc", { signal: "done", signalAt: now - 12 * 60_000 }),
    sess("4", "mobile-app", {}),
    sess("5", "office-tools", { signal: "done", signalAt: now - 3600_000, seen: true }),
    sess("6", "alt-und-beendet", { running: false }),
  ],
  active: { id: "1", name: "glasscockpit", file: { sessionId: "1", contextTokens: 158_000, usedPercentage: 79, model: "opus", writtenAt: now / 1000 - 90 } },
  tokensToday: { tokens: 301_000, asOf: now - 45_000 },
  focus: [
    "Beispiel: Bericht für Freitag gliedern, Zahlen prüfen, Entwurf an das Team schicken.",
    "Beispiel: Sicherung einrichten und einmal zurückspielen, bevor der Server neu startet.",
  ],
  vault: { inbox: ["01 Inbox/Brain Dump Cockpit.md", "01 Inbox/Idee Effort-Hebel.md", "01 Inbox/Telegram Test.md"], indexGeneratedAt: now - 9 * 86_400_000, dailyToday: true },
  repos: [
    { name: "glasscockpit", status: { dirty: true, ahead: 0, noUpstream: false } },
    { name: "Vault", status: { dirty: false, ahead: 2, noUpstream: false } },
    { name: "grade-calc", status: { dirty: false, ahead: 0, noUpstream: false } },
  ],
  radars: [{ name: "Radar 1", lamp: "green" }, { name: "Radar 2", lamp: "gray" }],
  unset: { projects: false, briefings: false, inbox: false, index: false, daily: false },
  effort: "high",
  telegramOn: true,
  soundOn: true,
  handoffs: [
    { project: "Beispiel A", path: "P/A/Handoffs/a.md", created: "2026-01-01", task: "", repo: null },
    { project: "Beispiel B", path: "P/B/Handoffs/b.md", created: "2026-01-01", task: "", repo: null },
  ],
  day: { loc: 1234, commits: 7, repos: [{ name: "glasscockpit", loc: 1100, commits: 5 }, { name: "mobile-app", loc: 134, commits: 2 }] },
};

// Leeres Vault (Abend 21): Einstellungen und Feed wie nach frischer Installation.
const leer = hashOf0("vault") === "leer";
if (leer) {
  feed.focus = [];
  feed.vault = null;
  feed.repos = null;
  feed.day = null;
  feed.radars = [];
  feed.unset = { projects: true, briefings: true, inbox: true, index: true, daily: true };
  // Alles Vault-Abhängige leer: Briefing nicht eingerichtet, Aufgabendatei fehlt, Pull nicht eingerichtet.
  inputs.briefing = { kind: "unset" };
  inputs.tasks = { kind: "missing" };
  inputs.pull = { status: "unset", at: now, error: null };
}
const settings = leer ? DEFAULT_SETTINGS : { ...DEFAULT_SETTINGS, lintCommand: "/lint" };

// Adresse: crop=full | crop=crop, zoom=<id>, probe, size=BxH, effort=<stufe>, drag=<stufe>, measure
const sizeHash = /[#&]size=(\\d+)x(\\d+)/.exec(location.hash);
if (sizeHash) {
  const v = document.getElementById("view")!;
  v.style.width = sizeHash[1] + "px";
  v.style.height = sizeHash[2] + "px";
}
const hashOf = (key: string): string | null => new RegExp("[#&]" + key + "=([a-zA-Z]+)").exec(location.hash)?.[1] ?? null;
const startCrop: CockpitCrop = hashOf("crop") === "full" ? "full" : "crop";
const startEffort = hashOf("effort");
if (startEffort !== null && (["aus", "low", "medium", "high", "xhigh", "max"] as string[]).includes(startEffort)) feed.effort = startEffort as CockpitFeed["effort"];

const layout = createCockpitLayout({
  crop: startCrop,
  actions: {
    focusSession: (id) => say("Tab nach vorn: Sitzung " + id),
    openBriefing: () => say("Briefing öffnen"),
    openNote: (p) => say("Notiz öffnen: " + p),
    startLint: () => say("/lint in die aktive Sitzung"),
    openSettings: () => say("Einstellungen öffnen"),
    setEffort: (step) => { feed.effort = step; layout.updateFeed(feed, settings, now); say("Effort " + feed.effort); },
    toggleTelegram: () => { feed.telegramOn = !feed.telegramOn; layout.updateFeed(feed, settings, now); say("Telegram " + (feed.telegramOn ? "an" : "aus")); },
    toggleSound: () => { feed.soundOn = !feed.soundOn; layout.updateFeed(feed, settings, now); say("Ton " + (feed.soundOn ? "an" : "aus")); },
    newSession: () => say("Neue Sitzung"),
  },
  doc: document,
  backgroundUrl: background,
  cards,
});
document.getElementById("view")!.append(layout.el);
layout.update(panelValues(inputs, (ms) => new Date(ms).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })));
layout.updateFeed(feed, settings, now);
// Zoom per Adresse (#zoom=radar oder #zoom=system) für Fotos.
const zoomId = hashOf("zoom");
if (zoomId !== null) {
  if (PANELS.some((p) => p.id === zoomId)) layout.zoom(zoomId as PanelId);
  else layout.zoomField(zoomId as FieldId);
}

// Effort-Schieber (Abend 19e): Foto mitten im Zug und Messung im echten Layout (kein Mock der Maße).
const pointer = (target: Element, type: string, y: number, id = 1) =>
  target.dispatchEvent(new PointerEvent(type, { clientY: y, clientX: 0, pointerId: id, pointerType: "mouse", button: 0, bubbles: true, cancelable: true }));
const markCentre = (step: string): number => {
  const m = document.querySelector<HTMLElement>('.cockpit-effort-mark[data-step="' + step + '"]')!.getBoundingClientRect();
  return m.top + m.height / 2;
};
const dragStep = hashOf("drag");
if (dragStep !== null) {
  const k = document.querySelector<HTMLElement>(".cockpit-effort-knob")!;
  const kr = k.getBoundingClientRect();
  pointer(k, "pointerdown", kr.top + kr.height / 2);
  pointer(document.querySelector(".cockpit-effort-lever")!, "pointermove", markCentre(dragStep));
}
function measureEffort(): { lines: string[]; failed: number } {
  const lines: string[] = [];
  let failed = 0;
  const lever = document.querySelector<HTMLElement>(".cockpit-effort-lever")!;
  const rail = document.querySelector<HTMLElement>(".cockpit-effort-rail")!;
  const knob = document.querySelector<HTMLElement>(".cockpit-effort-knob")!;
  const content = document.querySelector<HTMLElement>(".cockpit-field-effort .cockpit-field-content")!;
  const steps = ["max", "xhigh", "high", "medium", "low", "aus"];
  const ys = steps.map(markCentre);
  const gaps = ys.slice(1).map((y, i) => y - ys[i]);
  const spacing = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const kr = knob.getBoundingClientRect();
  const lr = lever.getBoundingClientRect();
  const cr = content.getBoundingClientRect();
  const rr = rail.getBoundingClientRect();
  const check = (what: string, ok: boolean, detail: string) => {
    if (!ok) failed++;
    lines.push((ok ? "OK   " : "FAIL ") + what + " " + detail);
  };
  const f1 = (n: number) => n.toFixed(2);
  lines.push("Ansicht " + document.getElementById("view")!.clientWidth + "x" + document.getElementById("view")!.clientHeight + ", Ausschnitt " + (startCrop === "full" ? "voll" : "zugeschnitten"));
  lines.push("Inhalt des Schirms " + f1(cr.width) + " x " + f1(cr.height) + " px; Schlitzweg " + f1(rr.height) + " px; Stufenabstand " + f1(spacing) + " px");
  lines.push("Griff " + f1(kr.width) + " x " + f1(kr.height) + " px (Verhältnis Griffhöhe zu Stufenabstand " + f1(kr.height / spacing) + ")");
  check("Griff flacher als der Stufenabstand", kr.height < spacing, f1(kr.height) + " < " + f1(spacing));
  check("Griff breiter als hoch", kr.width > kr.height, f1(kr.width) + " > " + f1(kr.height));
  check("Stufenabstand gleichmäßig", Math.max(...gaps) - Math.min(...gaps) < 0.6, "kleinster " + f1(Math.min(...gaps)) + ", größter " + f1(Math.max(...gaps)));
  const right = Math.max(...steps.map((st) => document.querySelector<HTMLElement>('.cockpit-effort-mark[data-step="' + st + '"]')!.getBoundingClientRect().right));
  check("Beschriftungen liegen ganz im Inhalt (rechts)", right <= cr.right + 0.5, "rechter Rand " + f1(right) + " <= " + f1(cr.right));
  check("oberste und unterste Beschriftung liegen im Inhalt", ys[0] - 5 >= cr.top && ys[5] + 5 <= cr.bottom, "oben " + f1(ys[0] - cr.top) + " px, unten " + f1(cr.bottom - ys[5]) + " px Luft");
  check("Schlitzbreite zum Anfassen: Streifen so breit wie der Griff", lr.width >= kr.width, f1(lr.width) + " >= " + f1(kr.width));
  // Echter Zug je Stufe im echten Layout: Griff anfassen, auf die Beschriftung ziehen, loslassen.
  const lev = lever;
  const order = ["aus", "low", "medium", "high", "xhigh", "max", "high"];
  for (const target of order) {
    const k2 = knob.getBoundingClientRect();
    const before = feed.effort;
    pointer(knob, "pointerdown", k2.top + k2.height / 2 + 2);
    const afterDown = knob.getBoundingClientRect();
    const jump = Math.abs((afterDown.top + afterDown.height / 2) - (k2.top + k2.height / 2));
    pointer(lev, "pointermove", markCentre(target) + 1);
    const during = feed.effort;
    pointer(lev, "pointerup", markCentre(target) + 1);
    const kk = knob.getBoundingClientRect();
    const off = Math.abs((kk.top + kk.height / 2) - markCentre(target));
    check("Zug " + before + " -> " + target, feed.effort === target && during === before && jump < 0.6 && off < 0.6,
      "gesetzt " + feed.effort + ", mitten im Zug noch " + during + ", Sprung beim Anfassen " + f1(jump) + " px, Abstand Griffmitte zur Beschriftung " + f1(off) + " px");
  }
  // Klemmen im echten Layout: weit über und unter dem Schlitz
  pointer(knob, "pointerdown", knob.getBoundingClientRect().top + 3);
  pointer(lev, "pointermove", -4000);
  pointer(lev, "pointerup", -4000);
  check("Zug weit über den Schlitz klemmt auf max", feed.effort === "max", feed.effort);
  pointer(knob, "pointerdown", knob.getBoundingClientRect().top + 3);
  pointer(lev, "pointermove", 9000);
  pointer(lev, "pointerup", 9000);
  check("Zug weit unter den Schlitz klemmt auf aus", feed.effort === "aus", feed.effort);
  const inside = (k: DOMRect) => k.top >= cr.top - 0.5 && k.bottom <= cr.bottom + 0.5;
  check("Griff bei aus liegt ganz im Inhalt", inside(knob.getBoundingClientRect()), "oben " + f1(knob.getBoundingClientRect().top - cr.top) + " unten " + f1(cr.bottom - knob.getBoundingClientRect().bottom) + " px Luft");
  // Klick auf eine Beschriftung
  document.querySelector<HTMLElement>('.cockpit-effort-mark[data-step="xhigh"]')!.click();
  check("Klick auf die Beschriftung xhigh", feed.effort === "xhigh", feed.effort);
  check("Griff bei xhigh auf der Beschriftung", Math.abs((knob.getBoundingClientRect().top + knob.getBoundingClientRect().height / 2) - markCentre("xhigh")) < 0.6, "");
  return { lines, failed };
}
if (hashOf("measure") !== null || /[#&]measure\\b/.test(location.hash)) {
  const result = measureEffort();
  const pre = document.createElement("pre");
  pre.id = "measure-result";
  pre.textContent = result.lines.join("\\n") + "\\nERGEBNIS " + (result.failed === 0 ? "OK" : result.failed + " FEHLER");
  document.body.append(pre);
}

// Trefferprobe (Stolperfalle 2 der Bauanleitung 19b): Klicks rechnen mit der Bühne, die zugeschnitten verschoben und skaliert steht. Für Radar und Effort,
// in beiden Ansichten: die Mitte und je Kante des Polygons der Punkt 3 px innerhalb (muss die Fläche treffen) und 3 px außerhalb (darf sie nicht treffen).
function probeAll(): { lines: string[]; failed: number; total: number } {
  const lines: string[] = [];
  let failed = 0;
  let total = 0;
  const label = (e: Element | null) => (e === null ? "nichts" : e.tagName.toLowerCase() + "." + (e.getAttribute("class") ?? "").split(" ")[0]);
  const insidePoly = (x: number, y: number, p: ReadonlyArray<readonly [number, number]>) => {
    let in_ = false;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const [xi, yi] = p[i];
      const [xj, yj] = p[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) in_ = !in_;
    }
    return in_;
  };
  for (const mode of ["crop", "full"] as const) {
    layout.setCrop(mode);
    for (const id of ["radar", "effort"] as const) {
      const g = FIELDS.find((f) => f.id === id)!;
      const outer = document.querySelector<HTMLElement>(".cockpit-field-" + id)!;
      const r = outer.getBoundingClientRect();
      const P = g.polygon.map(([x, y]) => [r.left + (x / 100) * r.width, r.top + (y / 100) * r.height] as const);
      const check = (what: string, x: number, y: number, want: boolean) => {
        const hit = document.elementFromPoint(x, y);
        const ok = (hit !== null && outer.contains(hit)) === want;
        total++;
        if (!ok) failed++;
        lines.push((ok ? "OK   " : "FAIL ") + mode + " " + id + " " + what + " (" + Math.round(x) + ", " + Math.round(y) + ") " + (want ? "soll treffen" : "soll nicht treffen") + ", trifft " + label(hit));
      };
      check("Mitte", r.left + r.width / 2, r.top + r.height / 2, true);
      for (let i = 0; i < P.length; i++) {
        const a = P[i];
        const b = P[(i + 1) % P.length];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < 10) continue; // zu kurze Kante zum Treffen
        const mx = (a[0] + b[0]) / 2;
        const my = (a[1] + b[1]) / 2;
        const nx = -(b[1] - a[1]) / len;
        const ny = (b[0] - a[0]) / len;
        const plus = insidePoly(mx + 3 * nx, my + 3 * ny, P);
        const minus = insidePoly(mx - 3 * nx, my - 3 * ny, P);
        if (plus === minus) continue; // Kante im Gewirr einer Spitze: eindeutig innen oder außen gibt es hier nicht
        const [ix, iy, ox, oy] = plus ? [mx + 3 * nx, my + 3 * ny, mx - 3 * nx, my - 3 * ny] : [mx - 3 * nx, my - 3 * ny, mx + 3 * nx, my + 3 * ny];
        check("Kante " + i + " innen", ix, iy, true);
        check("Kante " + i + " außen", ox, oy, false);
      }
    }
  }
  layout.setCrop(startCrop);
  return { lines, failed, total };
}
if (hashOf("probe") !== null || /[#&]probe\\b/.test(location.hash)) {
  const result = probeAll();
  const pre = document.createElement("pre");
  pre.id = "probe-result";
  const sicht = document.getElementById("view")!;
  pre.textContent = result.lines.join("\\n") + "\\nAnsicht " + sicht.clientWidth + "x" + sicht.clientHeight + ", Sichtfenster " + innerWidth + "x" + innerHeight + "\\nERGEBNIS " + (result.total - result.failed) + "/" + result.total + (result.failed === 0 ? " OK" : " FEHLER");
  document.body.append(pre);
  document.title = "probe " + (result.total - result.failed) + "/" + result.total;
}
`);

const bundle = await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  target: "es2020",
  loader: { ".jpg": "dataurl" },
  logLevel: "warning",
});
const css = await esbuild.build({ entryPoints: [join(root, "src/styles.css")], bundle: true, write: false, logLevel: "warning" });

const html = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cockpit-Ansicht (Vorschau)</title>
<style>
/* Ersatz für die Obsidian-Variablen, die das Plugin-CSS benutzt. */
:root {
  --background-primary: #1e1e1e; --background-secondary: #262626; --background-modifier-border: #444;
  --background-modifier-hover: #333; --background-modifier-form-field: #2a2a2a; --text-normal: #dadada;
  --text-muted: #9a9a9a; --text-faint: #6a6a6a; --text-error: #e55; --interactive-accent: #7b6cd9; --text-on-accent: #fff;
  --font-ui-smaller: 12px; --font-ui-small: 13px; --font-monospace: Menlo, Monaco, monospace;
}
html, body { margin: 0; height: 100%; background: #111; color: var(--text-normal); font-family: system-ui, sans-serif; font-size: 14px; }
#view { height: 100vh; }
#toast { position: fixed; left: 50%; bottom: 14px; transform: translateX(-50%); padding: 6px 12px; border-radius: 6px; background: #000c; color: #dff3ff; font: 12px Menlo, monospace; opacity: 0; transition: opacity .2s; pointer-events: none; z-index: 20; }
#toast.on { opacity: 1; }
</style>
<style>
${css.outputFiles[0].text}
</style>
</head>
<body>
<div id="view" class="view-content cockpit-dashboard cockpit-dashboard-cockpit"></div>
<div id="toast"></div>
<script>
${bundle.outputFiles[0].text.replace(/<\/script/g, "<\\/script")}
</script>
</body>
</html>
`;
const out = join(buildDir, "preview-cockpit.html");
writeFileSync(out, html);
console.log(`Vorschau geschrieben: ${out} (${(html.length / 1024).toFixed(0)} KB)`);

// Chrome headless beendet sich nach --screenshot und --dump-dom nicht immer von selbst (beobachtet 09.10.2026, Chrome 154, ein zweites Chrome lief).
// Darum startet runChrome ihn asynchron, sieht auf das fertige Ergebnis (Screenshot: "written to file" auf stderr, Dump: schließendes </html>) und beendet ihn dann.
function runChrome(chromePath, args, { timeoutMs = 90_000 } = {}) {
  return new Promise((resolveRun) => {
    const child = spawn(chromePath, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let done = false;
    const finish = (status) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.kill("SIGKILL");
      resolveRun({ status, stdout, stderr });
    };
    const check = () => {
      if (/written to file/.test(stderr) || /<\/html>\s*$/.test(stdout)) setTimeout(() => finish(0), 300);
    };
    child.stdout.on("data", (d) => { stdout += d; check(); });
    child.stderr.on("data", (d) => { stderr += d; check(); });
    child.on("exit", (code) => finish(code ?? 1));
    const timer = setTimeout(() => finish(124), timeoutMs);
  });
}

// Fotos und Trefferprobe (Abend 19b): node scripts/preview-cockpit.mjs --fotos <ordner>
const fotos = process.argv.indexOf("--fotos");
if (fotos !== -1) {
  const dir = process.argv[fotos + 1];
  if (!dir) {
    console.error("Aufruf: node scripts/preview-cockpit.mjs --fotos <ordner>");
    process.exit(2);
  }
  mkdirSync(resolve(dir), { recursive: true });
  const chrome = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const profile = mkdtempSync(join(tmpdir(), "cockpit-preview-"));
  const base = ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", `--user-data-dir=${profile}`, "--virtual-time-budget=2000"];
  const url = (hash) => `file://${out}#${hash}`;
  const nurProbe = process.argv.includes("--nur-probe");
  let failed = 0;
  try {
    for (const [w, h] of [[640, 780], [1280, 780]]) {
      for (const mode of nurProbe ? [] : ["crop", "full"]) {
        const file = join(resolve(dir), `${mode === "crop" ? "zugeschnitten" : "voll"}-${w}x${h}.png`);
        const r = await runChrome(chrome, [...base, `--window-size=${w},${h}`, "--force-device-scale-factor=2", `--screenshot=${file}`, url(`crop=${mode}`)]);
        if (r.status !== 0) {
          console.error(`Foto ${file} gescheitert (Exit ${r.status}): ${(r.stderr ?? "").slice(0, 300)}`);
          failed++;
        } else console.log(`Foto: ${file}`);
      }
      const probe = await runChrome(chrome, [...base, `--window-size=${w},${h}`, "--dump-dom", url(`probe&size=${w}x${h}`)]);
      const text = /<pre id="probe-result">([\s\S]*?)<\/pre>/.exec(probe.stdout ?? "")?.[1];
      if (text === undefined) {
        console.error(`Trefferprobe ${w}x${h}: kein Ergebnis (Exit ${probe.status})`);
        failed++;
        continue;
      }
      const lines = text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").split("\n");
      console.log(`Trefferprobe ${w}x${h}: ${lines[lines.length - 1]} (${lines[lines.length - 2]})`);
      for (const l of lines) if (l.startsWith("FAIL")) console.log(`  ${l}`);
      if (!/OK$/.test(lines[lines.length - 1])) failed++;
      writeFileSync(join(resolve(dir), `trefferprobe-${w}x${h}.txt`), lines.join("\n") + "\n");
    }
    // Effort-Schieber (Abend 19e): DOM-Maße und echter Zug je Stufe, in beiden Ansichten bei 640, 720 (780 und 900 px hoch: erst bei 900 füllt die Breite die Pane, bei 780 begrenzt die Höhe) und 1280 px Breite.
    // Leeres Vault (Abend 21): Foto bei 640 x 780.
    {
      const file = join(resolve(dir), "leer-640x780.png");
      const r = await runChrome(chrome, [...base, "--window-size=640,780", "--force-device-scale-factor=2", `--screenshot=${file}`, url("vault=leer&crop=crop&size=640x780")]);
      if (r.status !== 0) {
        console.error(`Foto ${file} gescheitert (Exit ${r.status}): ${(r.stderr ?? "").slice(0, 300)}`);
        failed++;
      } else console.log(`Foto: ${file}`);
    }
    for (const [w, h] of [[640, 780], [720, 780], [720, 900], [1280, 780]]) {
      for (const mode of ["crop", "full"]) {
        const m = await runChrome(chrome, [...base, `--window-size=${w},${h}`, "--dump-dom", url(`crop=${mode}&measure&size=${w}x${h}`)]);
        const mt = /<pre id="measure-result">([\s\S]*?)<\/pre>/.exec(m.stdout ?? "")?.[1];
        if (mt === undefined) {
          console.error(`Messung Effort ${mode} ${w}x${h}: kein Ergebnis (Exit ${m.status})`);
          failed++;
          continue;
        }
        const ml = mt.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").split("\n");
        console.log(`Messung Effort ${mode} ${w}x${h}: ${ml[ml.length - 1]}`);
        for (const l of ml) if (l.startsWith("FAIL")) console.log(`  ${l}`);
        if (!/OK$/.test(ml[ml.length - 1])) failed++;
        writeFileSync(join(resolve(dir), `schieber-masse-${mode === "crop" ? "zugeschnitten" : "voll"}-${w}x${h}.txt`), ml.join("\n") + "\n");
      }
    }
    // Fotos des Schiebers: mitten im Zug (Griff auf der Beschriftung low gehalten) und mit Effort aus.
    for (const [name, hash] of [["zug-low", "drag=low"], ["zug-max", "drag=max"], ["stand-aus", "effort=aus"], ["stand-max", "effort=max"]]) {
      for (const mode of ["crop", "full"]) {
        const file = join(resolve(dir), `schieber-${name}-${mode === "crop" ? "zugeschnitten" : "voll"}-720x900.png`);
        const r = await runChrome(chrome, [...base, "--window-size=720,900", "--force-device-scale-factor=3", `--screenshot=${file}`, url(`crop=${mode}&${hash}&size=720x900`)]);
        if (r.status !== 0) {
          console.error(`Foto ${file} gescheitert (Exit ${r.status}): ${(r.stderr ?? "").slice(0, 300)}`);
          failed++;
        } else console.log(`Foto: ${file}`);
      }
    }
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
  process.exit(failed === 0 ? 0 : 1);
}
