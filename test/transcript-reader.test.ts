import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_LINK_BASES, MAX_TOOL_PATHS, TRANSCRIPT_TAIL_BYTES } from "../src/core/constants";
import { HandoffKeeper, barItems } from "../src/core/transcript-poll";
import { TranscriptReader, transcriptExists } from "../src/host/transcript-reader";

const ID = "11111111-2222-3333-4444-555555555555";
let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cockpit-transcript-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function schreibeAntwort(): Promise<void> {
  const eintrag = { type: "assistant", message: { id: "m1", content: [{ type: "text", text: "hi\n```sh\nls -la\n```" }] } };
  await mkdir(join(root, "proj"), { recursive: true });
  await writeFile(join(root, "proj", `${ID}.jsonl`), JSON.stringify(eintrag) + "\n");
}

describe("TranscriptReader", () => {
  it("force umgeht die Drosselung der Ordnersuche", async () => {
    const reader = new TranscriptReader(ID, root);
    expect(await reader.read()).toEqual({ changed: false, blocks: [], handoff: null });
    await schreibeAntwort();
    // Ohne force bleibt die Suche gedrosselt.
    expect((await reader.read()).blocks).toEqual([]);
    const forced = await reader.read(true);
    expect(forced.blocks).toEqual([{ lang: "sh", code: "ls -la" }]);
  });

  it("findet die Datei beim ersten Poll", async () => {
    await schreibeAntwort();
    const result = await new TranscriptReader(ID, root).read();
    expect(result.blocks).toEqual([{ lang: "sh", code: "ls -la" }]);
  });
});

describe("TranscriptReader: Handoff-Block (Abend 19b)", () => {
  const P = "Handoff:";
  const antwort = (id: string, text: string) => JSON.stringify({ type: "assistant", message: { id, content: [{ type: "text", text }] } });
  async function schreibe(zeilen: string[]): Promise<void> {
    await mkdir(join(root, "proj"), { recursive: true });
    await writeFile(join(root, "proj", `${ID}.jsonl`), zeilen.join("\n") + "\n");
  }

  it("liefert den Handoff-Block einer früheren Antwort, auch wenn die letzte Antwort keinen Block hat", async () => {
    await schreibe([antwort("m1", "Start:\n```text\nHandoff: weiter\nzweite Zeile\n```"), antwort("m2", "ok")]);
    const r = await new TranscriptReader(ID, root).read(true, P);
    expect(r.handoff).toBe("Handoff: weiter\nzweite Zeile");
    expect(r.blocks).toEqual([]);
  });

  it("derselbe Block steht auch in blocks, wenn die letzte Antwort ihn enthält (Voraussetzung fürs Entdoppeln)", async () => {
    await schreibe([antwort("m1", "x\n```\nHandoff: jetzt\n```\n\n```sh\nls\n```")]);
    const r = await new TranscriptReader(ID, root).read(true, P);
    expect(r.handoff).toBe("Handoff: jetzt");
    expect(r.blocks.map((b) => b.code)).toContain(r.handoff);
  });

  it("ohne Präfix (Vorgabe leer) oder ohne passenden Block ist handoff null", async () => {
    await schreibe([antwort("m1", "```\nHandoff: da\n```")]);
    expect((await new TranscriptReader(ID, root).read(true)).handoff).toBeNull();
    expect((await new TranscriptReader(ID, root).read(true, "Übergabe:")).handoff).toBeNull();
  });

  it("unveränderte Datei: changed false und handoff null, der Aufrufer behält seinen Wert", async () => {
    await schreibe([antwort("m1", "```\nHandoff: da\n```")]);
    const reader = new TranscriptReader(ID, root);
    expect((await reader.read(false, P)).handoff).toBe("Handoff: da");
    expect(await reader.read(false, P)).toEqual({ changed: false, blocks: [], handoff: null });
  });

  it("fehlende Datei: handoff null", async () => {
    expect(await new TranscriptReader(ID, root).read(true, P)).toEqual({ changed: false, blocks: [], handoff: null });
  });
});

describe("Handoff über /clear: zwei Leser, ein HandoffKeeper (Schlüssel Cockpit-id)", () => {
  const P = "Handoff:";
  const NEU = "99999999-2222-3333-4444-555555555555";
  const antwort = (id: string, text: string) => JSON.stringify({ type: "assistant", message: { id, content: [{ type: "text", text }] } });
  const datei = (id: string) => join(root, "proj", `${id}.jsonl`);
  const arten = (items: ReturnType<typeof barItems>) => items.map((i) => i.kind);

  it("der Knopf bleibt, solange das neue Transkript fehlt oder keinen Block hat, und wechselt mit dem neuen Block", async () => {
    await mkdir(join(root, "proj"), { recursive: true });
    const keeper = new HandoffKeeper();
    const poll = async (reader: TranscriptReader) => {
      const r = await reader.read(true, P);
      keeper.keep("cockpit-1", r.handoff);
      return barItems(r.blocks, keeper.get("cockpit-1"));
    };

    // Vor /clear: Startnachricht, danach Antworten ohne Block. Die Leiste zeigt nur den festen Knopf.
    await writeFile(datei(ID), [antwort("m1", "```\nHandoff: alt\n```"), antwort("m2", "ok")].join("\n") + "\n");
    expect(arten(await poll(new TranscriptReader(ID, root)))).toEqual(["handoff"]);

    // /clear: neuer Leser, die neue Datei gibt es noch nicht. Der feste Knopf steht weiter.
    const neuerLeser = new TranscriptReader(NEU, root);
    expect(arten(await poll(neuerLeser))).toEqual(["handoff"]);
    expect(keeper.get("cockpit-1")).toBe("Handoff: alt");

    // Neue Datei, letzte Antwort mit eigenem Block, aber ohne Handoff: fester Knopf plus Block.
    await writeFile(datei(NEU), antwort("n1", "```sh\nls\n```") + "\n");
    expect(arten(await poll(neuerLeser))).toEqual(["handoff", "block"]);
    expect(keeper.get("cockpit-1")).toBe("Handoff: alt");

    // Neuer Handoff im neuen Transkript, zugleich in der letzten Antwort: ein fester Knopf, kein zweiter.
    await writeFile(datei(NEU), [antwort("n1", "```sh\nls\n```"), antwort("n2", "```\nHandoff: neu\n```")].join("\n") + "\n");
    expect(arten(await poll(neuerLeser))).toEqual(["handoff"]);
    expect(keeper.get("cockpit-1")).toBe("Handoff: neu");
  });
});

describe("TranscriptReader: Basisordner aus Werkzeugaufrufen (Abend 27b)", () => {
  const HOME = "/Users/u";
  const call = (command: string) =>
    JSON.stringify({ type: "assistant", cwd: "/Users/u/vault", message: { id: "m", content: [{ type: "tool_use", id: "toolu_1", name: "Bash", input: { command } }] } });
  /** Eine Antwort ohne Werkzeugaufruf, die das gelesene Ende des Transkripts füllt. */
  const filler = (bytes: number) => JSON.stringify({ type: "assistant", message: { id: "f", content: [{ type: "text", text: "x".repeat(bytes) }] } });
  async function schreibe(zeilen: string[]): Promise<void> {
    await mkdir(join(root, "proj"), { recursive: true });
    await writeFile(join(root, "proj", `${ID}.jsonl`), zeilen.join("\n") + "\n");
  }
  const leser = () => new TranscriptReader(ID, root, HOME);

  it("ohne gelesenes Transkript keine Basisordner", () => {
    expect(leser().linkBases()).toEqual([]);
  });

  it("Ordner aus cd und Dateizugriffen, neueste zuerst, nie home", async () => {
    await schreibe([call("cd ~/proj/alt && ls"), call("cd ~/proj/neu/src && ls")]);
    const reader = leser();
    await reader.read();
    expect(reader.linkBases()).toEqual(["/Users/u/proj/neu/src", "/Users/u/proj/neu", "/Users/u/proj", "/Users/u/proj/alt"]);
  });

  it("Gegentest: Funde bleiben über Polls erhalten, auch wenn sie aus dem gelesenen Ende fallen", async () => {
    await schreibe([call("cd ~/proj/alt && ls")]);
    const reader = leser();
    await reader.read();
    expect(reader.linkBases()).toContain("/Users/u/proj/alt");
    await schreibe([call("cd ~/proj/alt && ls"), filler(TRANSCRIPT_TAIL_BYTES + 1000), call("cd ~/proj/neu && ls")]);
    // Voraussetzung: Ein frischer Leser sieht den alten Aufruf nicht mehr, er liegt vor dem gelesenen Ende.
    const frisch = leser();
    await frisch.read();
    expect(frisch.linkBases()).not.toContain("/Users/u/proj/alt");
    await reader.read();
    expect(reader.linkBases()).toEqual(["/Users/u/proj/neu", "/Users/u/proj", "/Users/u/proj/alt"]);
  });

  it("unveränderte oder verschwundene Datei: die Funde bleiben", async () => {
    await schreibe([call("cd ~/proj/alt && ls")]);
    const reader = leser();
    await reader.read();
    expect((await reader.read()).changed).toBe(false);
    expect(reader.linkBases()).toEqual(["/Users/u/proj/alt", "/Users/u/proj"]);
    await rm(join(root, "proj", `${ID}.jsonl`));
    expect((await reader.read()).changed).toBe(true);
    expect(reader.linkBases()).toEqual(["/Users/u/proj/alt", "/Users/u/proj"]);
  });

  it("ein neuer Leser (neue Claude-ID nach /clear) beginnt leer", async () => {
    await schreibe([call("cd ~/proj/alt && ls")]);
    const reader = leser();
    await reader.read();
    const nach = new TranscriptReader("66666666-7777-8888-9999-000000000000", root, HOME);
    await nach.read();
    expect(nach.linkBases()).toEqual([]);
    expect(reader.linkBases()).not.toEqual([]);
  });

  it("Obergrenzen: MAX_TOOL_PATHS Funde, höchstens MAX_LINK_BASES Basisordner, die ältesten fallen zuerst raus", async () => {
    const aufrufe = Array.from({ length: MAX_TOOL_PATHS + 8 }, (_, i) => call(`cd /srv/d${i}/x && ls`));
    await schreibe(aufrufe);
    const reader = leser();
    await reader.read();
    const bases = reader.linkBases();
    expect(bases.length).toBeLessThanOrEqual(MAX_LINK_BASES);
    expect(bases[0]).toBe(`/srv/d${MAX_TOOL_PATHS + 7}/x`);
    expect(bases).not.toContain("/srv/d7/x");
    expect(bases).toContain("/srv/d8/x");
  });
});

describe("transcriptExists", () => {
  it("true, wenn das Transkript in einem Projektordner liegt", async () => {
    await schreibeAntwort();
    expect(await transcriptExists(ID, root)).toBe(true);
  });

  it("false, wenn nur andere Sitzungen Transkripte haben", async () => {
    await schreibeAntwort();
    expect(await transcriptExists("99999999-2222-3333-4444-555555555555", root)).toBe(false);
  });

  it("false, wenn die Wurzel fehlt", async () => {
    expect(await transcriptExists(ID, join(root, "gibt-es-nicht"))).toBe(false);
  });
});
