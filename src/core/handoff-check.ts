// Übergabe-Lampe: reine Bewertung, ob Handoff, Daily Note und Git für /clear bereit sind.
// Kein Zugriff auf Dateien oder Git: der Host liefert die Eingaben (src/host/handoff-check.ts).
import { posix, win32 } from "node:path";
import { beginntMit } from "./transcript-code";
/** Git-Stand des Startordners: none = kein Repo, unknown = Fehler oder Zeitlimit. */
export type GitClean = "clean" | "dirty" | "none" | "unknown";

/** *MtimeMs null heißt: Datei fehlt. startedAtMs null: Sitzungsstart unbekannt, dann genügt Existenz. */
export interface HandoffCheckInput {
  hasBlock: boolean;
  handoffPath: string | null;
  startedAtMs: number | null;
  handoffMtimeMs: number | null;
  dailyUnset: boolean;
  dailyMtimeMs: number | null;
  git: GitClean;
}

export interface HandoffCheck { tone: "green" | "red" | "gray"; gaps: string[]; lines: string[]; tooltip: string }

export const NO_SESSION_CHECK: HandoffCheck = {
  tone: "gray", gaps: [], lines: ["Keine aktive Sitzung."], tooltip: "Übergabe: keine aktive Sitzung",
};

function istWindowsPfad(p: string): boolean {
  return /^[A-Za-z]:/.test(p) || p.startsWith("\\\\");
}

function verbinde(basis: string, rel: string): string {
  return (istWindowsPfad(basis) ? win32 : posix).join(basis, rel);
}

function ohneUmschluss(s: string): string {
  const m = /^(`|"|')(.*)\1$/.exec(s);
  return m ? m[2].trim() : s;
}

/**
 * Mögliche Pfade des Handoffs aus der ersten Zeile des Blocks (nach dem Präfix), in Prüfreihenfolge. Absolut und ~ ergeben
 * einen Kandidaten, relativ zuerst gegen den Vault (auch mit dessen Ordnernamen vorn), dann gegen den Startordner.
 * Leer heißt: nicht lesbar. Text hinter „.md“ (etwa „(Abschnitt 4)“) wird abgeschnitten.
 */
export function handoffPathCandidates(block: string, prefix: string, home: string, vaultBase: string | null, cwd: string): string[] {
  if (prefix.trim() === "" || !beginntMit(block, prefix)) return [];
  const zeile = block.split("\n").find((z) => z.trim() !== "");
  if (zeile === undefined) return [];
  let rest = ohneUmschluss(zeile.trimStart().slice(prefix.length).trim());
  const md = rest.toLowerCase().indexOf(".md");
  if (md >= 0) rest = rest.slice(0, md + 3).replace(/^[`"']+|[`"']+$/g, "").trim();
  if (rest === "") return [];
  if (rest === "~" || rest.startsWith("~/") || rest.startsWith("~\\")) return [home + rest.slice(1)];
  if (rest.startsWith("/") || /^[A-Za-z]:[\\/]/.test(rest) || rest.startsWith("\\\\")) return [rest];
  const kandidaten: string[] = [];
  if (vaultBase !== null) {
    kandidaten.push(verbinde(vaultBase, rest));
    const name = vaultBase.split(/[\\/]/).filter((x) => x !== "").pop();
    if (name !== undefined && /^[\\/]/.test(rest.slice(name.length)) && rest.startsWith(name)) {
      const eltern = vaultBase.replace(/[\\/]+$/, "").replace(/[\\/][^\\/]*$/, "");
      kandidaten.push(verbinde(eltern === "" ? "/" : eltern, rest));
    }
  }
  kandidaten.push(verbinde(cwd, rest));
  return kandidaten.filter((k, i) => kandidaten.indexOf(k) === i);
}

function dateiname(pfad: string): string {
  const teile = pfad.split(/[\\/]/);
  return teile[teile.length - 1];
}

/** "Geändert" heißt mtime > Sitzungsstart; bei unbekanntem Start genügt die Existenz. */
function geaendert(mtime: number, start: number | null): boolean {
  return start === null || mtime > start;
}

export function evaluateHandoffCheck(i: HandoffCheckInput): HandoffCheck {
  if (!i.hasBlock) {
    return { tone: "gray", gaps: [], lines: ["Kein Handoff-Block in dieser Sitzung."], tooltip: "Übergabe: kein Handoff-Block" };
  }
  const lines: string[] = [];
  if (i.handoffPath === null) lines.push("✗ Handoff-Pfad im Block nicht lesbar");
  else if (i.handoffMtimeMs === null) lines.push(`✗ Handoff-Datei fehlt: ${i.handoffPath}`);
  else if (!geaendert(i.handoffMtimeMs, i.startedAtMs)) lines.push("✗ Handoff seit Sitzungsstart nicht geändert");
  else lines.push(`✓ Handoff geschrieben: ${dateiname(i.handoffPath)}`);

  if (i.dailyUnset) lines.push("✗ Daily-Ordner nicht eingerichtet");
  else if (i.dailyMtimeMs === null) lines.push("✗ Daily Note von heute fehlt");
  else if (!geaendert(i.dailyMtimeMs, i.startedAtMs)) lines.push("✗ Daily Note seit Sitzungsstart nicht geändert");
  else lines.push("✓ Daily Note von heute geschrieben");

  if (i.git === "dirty") lines.push("✗ Ungesicherte Änderungen im Startordner");
  else if (i.git === "unknown") lines.push("✗ Git-Status nicht lesbar");
  else if (i.git === "none") lines.push("✓ Kein Git-Repo im Startordner");
  else lines.push("✓ Git sauber");

  const gaps = lines.filter((l) => l.startsWith("✗ ")).map((l) => l.slice(2));
  if (gaps.length === 0) return { tone: "green", gaps, lines, tooltip: "Übergabe: bereit für /clear" };
  const n = gaps.length === 1 ? "1 Lücke" : `${gaps.length} Lücken`;
  return { tone: "red", gaps, lines, tooltip: `Übergabe: ${n}\n${gaps.join("\n")}` };
}

/** Lücken für die Rückfrage vor /clear: nur bei eingeschalteter Prüfung und roter Lampe, sonst null. */
export function clearNeedsConfirm(check: HandoffCheck | null, enabled: boolean): string[] | null {
  return enabled && check !== null && check.tone === "red" ? check.gaps : null;
}
