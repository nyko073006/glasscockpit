import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT } from "./helpers/files";

const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
/** Rumpf einer Methode oder Funktion: ab der Kopfzeile bis zur ersten schließenden Klammer in Spalte 0 bzw. 2. */
function body(src: string, head: RegExp): string {
  const m = head.exec(src);
  if (!m) throw new Error(`Kopfzeile nicht gefunden: ${head}`);
  const indent = /^ */.exec(src.slice(src.lastIndexOf("\n", m.index) + 1))?.[0] ?? "";
  const end = src.indexOf(`\n${indent}}\n`, m.index);
  if (end < 0) throw new Error("Ende nicht gefunden");
  return src.slice(m.index, end);
}

describe("Tasks schreiben nur über vault.process", () => {
  const files = ["src/host/tasks-card.ts", "src/host/dashboard-view.ts"].map((p) => [p, read(p)] as const);
  const card = read("src/host/tasks-card.ts");

  it.each(files)("%s: kein modify, kein adapter.write, kein fs-Import", (_p, src) => {
    expect(src).not.toMatch(/vault\.modify|\.modify\(/);
    expect(src).not.toMatch(/adapter\.write|adapter\.append|adapter\.process|writeBinary/);
    expect(src).not.toMatch(/from\s+["'](node:)?fs(\/promises)?["']|require\(["'](node:)?fs/);
  });

  it("vault.process kommt vor, und zwar in der Umschalt-Methode", () => {
    expect(card).toMatch(/vault\.process\(/);
    expect(body(card, /private async toggle\(/)).toMatch(/vault\.process\(/);
  });

  it("ein Fehlergrund wirft in der process-Funktion (dann schreibt Obsidian nicht)", () => {
    expect(body(card, /private async toggle\(/)).toMatch(/throw new TaskChangedError/);
  });

  it("vault.create steht nur in der Anlege-Funktion", () => {
    expect(card.match(/vault\.create\(/g)?.length).toBe(1);
    expect(body(card, /export async function createTasksFile\(/)).toMatch(/vault\.create\(/);
    expect(read("src/host/dashboard-view.ts")).not.toMatch(/vault\.create/);
  });

  it("die Lesefunktion legt nichts an", () => {
    expect(body(card, /private async loadTasks\(/)).not.toMatch(/create|process|modify/);
  });

  it("Command und Karte rufen dieselbe Anlege-Funktion", () => {
    expect(read("src/main.ts")).toMatch(/id: "create-tasks-file"[\s\S]*?createTasksFile\(this\.app/);
    expect(card).toMatch(/createTasksFile\(this\.app/);
  });

  it("das Command öffnet danach das Dashboard, wenn die Datei da ist (Abnahme 05.10.2026)", () => {
    const cmd = /id: "create-tasks-file"[\s\S]*?\n    \}\);/.exec(read("src/main.ts"))?.[0] ?? "";
    expect(cmd).toMatch(/if \(await createTasksFile\(this\.app.*\)\) await this\.openDashboard\(\);/);
    // Die Anlege-Funktion meldet, ob die Datei danach da ist (angelegt oder schon vorhanden).
    expect(card).toMatch(/export async function createTasksFile\([^)]*\): Promise<boolean>/);
  });

  it("Timer des Container-Fensters, kein Polling", () => {
    expect(card).toMatch(/containerEl\.win\.setTimeout/);
    expect(card).not.toMatch(/setInterval|registerInterval/);
  });
});

describe("Zuletzt benutzt nur nach erfolgreichem Senden", () => {
  const main = read("src/main.ts");

  it("useSkill steht genau einmal, im Erfolgszweig von sendToActive", () => {
    expect(main.match(/useSkill\(/g)?.length).toBe(1);
    expect(main).toMatch(/if \(this\.sendToActive\(buildSend\(`\/\$\{name\}`\)\)\) this\.store\?\.useSkill\(name\);/);
  });

  it("Launcher (Skills) und Dashboard gehen beide über sendSkill, Commands und Agents nicht", () => {
    expect(main).toMatch(/runSkill: \(name\) => this\.sendSkill\(name\)/);
    const choose = body(main, /private chooseEntry\(/);
    expect(choose).toMatch(/if \(kind === "skill"\) this\.sendSkill\(entry\.name\)/);
    expect(choose).not.toMatch(/useSkill/);
  });

  it("sendToActive liefert boolean, deliver ebenfalls", () => {
    expect(main).toMatch(/private sendToActive\(steps: SendStep\[\]\): boolean/);
    expect(main).toMatch(/private deliver\(id: string, steps: SendStep\[\]\): boolean/);
  });

  it("die Skill-Karte kennt kein useSkill und baut keinen eigenen Sendeweg", () => {
    const card = read("src/host/skills-card.ts");
    expect(card).not.toMatch(/useSkill|buildSend|\.write\(|manager/);
  });
});
