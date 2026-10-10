import { describe, expect, it } from "vitest";
import { DIFF_TOOLS, DIFF_TOOL_NAMES, closeAllResult, closeTabResult, openDiffResult, parseOpenDiffArgs } from "../src/core/ide-diff";

const ok = { old_file_path: "/a/alt.txt", new_file_path: "/a/alt.txt", new_file_contents: "neu\n", tab_name: "✻ [Claude Code] alt.txt (abc) ⧉" };

describe("parseOpenDiffArgs", () => {
  it("nimmt die vier Felder aus PROTOCOL.md", () => {
    expect(parseOpenDiffArgs(ok)).toEqual({
      ok: true,
      args: { oldFilePath: "/a/alt.txt", newFilePath: "/a/alt.txt", newFileContents: "neu\n", tabName: ok.tab_name },
    });
  });
  it("leerer neuer Inhalt ist erlaubt (Datei leeren)", () => {
    expect(parseOpenDiffArgs({ ...ok, new_file_contents: "" })).toMatchObject({ ok: true });
  });
  it.each(["old_file_path", "new_file_path", "new_file_contents", "tab_name"])("%s fehlt oder ist kein Text: abgelehnt, Feld genannt", (feld) => {
    const ohne: Record<string, unknown> = { ...ok };
    delete ohne[feld];
    const r = parseOpenDiffArgs(ohne);
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.reason).toContain(feld);
    expect(parseOpenDiffArgs({ ...ok, [feld]: 5 }).ok).toBe(false);
  });
  it("leerer Pfad oder leerer tab_name: abgelehnt", () => {
    expect(parseOpenDiffArgs({ ...ok, new_file_path: "  " }).ok).toBe(false);
    expect(parseOpenDiffArgs({ ...ok, tab_name: "" }).ok).toBe(false);
  });
  it("NUL im Pfad: abgelehnt", () => {
    expect(parseOpenDiffArgs({ ...ok, new_file_path: "/a/b\0c" }).ok).toBe(false);
    expect(parseOpenDiffArgs({ ...ok, old_file_path: "/a/b\0c" }).ok).toBe(false);
  });
  it("relativer Pfad: abgelehnt (geschrieben wird nur an einen absoluten Pfad)", () => {
    const r = parseOpenDiffArgs({ ...ok, new_file_path: "x/y.txt" });
    expect(r.ok).toBe(false);
  });
  it("leerer alter Pfad: abgelehnt (PROTOCOL.md nennt ihn immer)", () => {
    expect(parseOpenDiffArgs({ ...ok, old_file_path: "" }).ok).toBe(false);
  });
});

describe("Antworten", () => {
  it("DIFF_TOOL_NAMES nennt genau die drei Tools", () => {
    expect([...DIFF_TOOL_NAMES].sort()).toEqual(["closeAllDiffTabs", "close_tab", "openDiff"]);
    expect(DIFF_TOOLS.map((t) => t.name).sort()).toEqual(["closeAllDiffTabs", "close_tab", "openDiff"]);
  });
  it("Schemas: openDiff verlangt die vier Felder, close_tab den tab_name", () => {
    expect(DIFF_TOOLS.find((t) => t.name === "openDiff")?.inputSchema.required).toEqual(["old_file_path", "new_file_path", "new_file_contents", "tab_name"]);
    expect(DIFF_TOOLS.find((t) => t.name === "close_tab")?.inputSchema.required).toEqual(["tab_name"]);
    expect(DIFF_TOOLS.find((t) => t.name === "closeAllDiffTabs")?.inputSchema.properties).toEqual({});
  });
  it("closeTab und closeAll nach PROTOCOL.md", () => {
    expect(closeTabResult()).toEqual({ content: [{ type: "text", text: "TAB_CLOSED" }] });
    expect(closeAllResult(3)).toEqual({ content: [{ type: "text", text: "CLOSED_3_DIFF_TABS" }] });
    expect(closeAllResult(0).content[0].text).toBe("CLOSED_0_DIFF_TABS");
  });
  it("abgelehnt: DIFF_REJECTED, kein Fehler", () => {
    const r = openDiffResult("rejected", "egal");
    expect(r.content[0]).toEqual({ type: "text", text: "DIFF_REJECTED" });
    expect(r.isError).toBeUndefined();
  });
  it("angenommen: FILE_SAVED, dann der endgültige Inhalt (gemessen: Claude schreibt die Datei selbst aus diesem zweiten Eintrag)", () => {
    expect(openDiffResult("accepted", "neu\n")).toEqual({ content: [{ type: "text", text: "FILE_SAVED" }, { type: "text", text: "neu\n" }] });
  });
  it("angenommen mit leerem Inhalt: der zweite Eintrag bleibt (leere Datei ist ein gültiges Ergebnis)", () => {
    expect(openDiffResult("accepted", "").content).toEqual([{ type: "text", text: "FILE_SAVED" }, { type: "text", text: "" }]);
  });
  it("abgelehnt trägt keinen Inhalt", () => {
    expect(openDiffResult("rejected", "geheim").content).toHaveLength(1);
  });
});
