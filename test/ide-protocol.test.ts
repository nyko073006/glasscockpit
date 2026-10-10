import { describe, expect, it, vi } from "vitest";
import {
  IDE_NAME,
  IDE_TOOLS,
  RPC,
  atMentionParams,
  authorized,
  dispatchRequest,
  ideEnv,
  initializeResult,
  jsonResult,
  lockContent,
  mentionLines,
  notification,
  parseLock,
  parseMessage,
  resolveInVault,
  rpcError,
  rpcResult,
  selectionParams,
  textResult,
  tokenEquals,
  type IdeHandlers,
} from "../src/core/ide-protocol";

const BASE = "/Users/x/Vault";

function handlers(over: Partial<IdeHandlers> = {}): IdeHandlers {
  return {
    getCurrentSelection: () => jsonResult({ success: false, message: "No active editor found" }),
    getLatestSelection: () => jsonResult({ success: false, message: "No selection available" }),
    getOpenEditors: () => jsonResult({ tabs: [] }),
    getWorkspaceFolders: () => jsonResult({ success: true, folders: [], rootPath: BASE }),
    openFile: () => textResult("Opened file"),
    checkDocumentDirty: () => jsonResult({ success: true, isDirty: false }),
    saveDocument: () => jsonResult({ success: true, saved: true }),
    ...over,
  };
}
const ctx = (h: IdeHandlers = handlers(), base: string | null = BASE) => ({ handlers: h, vaultBase: () => base });

describe("parseMessage", () => {
  it("Anfrage mit id", () => {
    expect(parseMessage('{"jsonrpc":"2.0","id":3,"method":"tools/list"}')).toEqual({ kind: "request", id: 3, method: "tools/list", params: undefined });
  });
  it("Text-id bleibt Text, id 0 ist eine gültige id", () => {
    expect(parseMessage('{"jsonrpc":"2.0","id":"a","method":"x"}')).toMatchObject({ kind: "request", id: "a" });
    expect(parseMessage('{"jsonrpc":"2.0","id":0,"method":"initialize"}')).toMatchObject({ kind: "request", id: 0 });
  });
  it("Benachrichtigung ohne id", () => {
    expect(parseMessage('{"jsonrpc":"2.0","method":"notifications/initialized"}')).toEqual({ kind: "notification", method: "notifications/initialized", params: undefined });
  });
  it("Antwort des Clients wird erkannt, nicht als Anfrage behandelt", () => {
    expect(parseMessage('{"jsonrpc":"2.0","id":1,"result":{}}').kind).toBe("response");
  });
  it("kaputtes JSON ergibt Parse-Fehler mit id null", () => {
    expect(parseMessage("{kaputt")).toEqual({ kind: "invalid", id: null, code: RPC.PARSE_ERROR, reason: expect.any(String) });
  });
  it("kein Objekt oder ohne method: ungültige Anfrage, id bleibt erhalten", () => {
    expect(parseMessage("[1]")).toMatchObject({ kind: "invalid", code: RPC.INVALID_REQUEST });
    expect(parseMessage('{"jsonrpc":"2.0","id":7}')).toMatchObject({ kind: "invalid", id: 7, code: RPC.INVALID_REQUEST });
    expect(parseMessage('{"jsonrpc":"2.0","id":7,"method":5}')).toMatchObject({ kind: "invalid", id: 7 });
  });
});

describe("Antworten und Fehlerobjekte", () => {
  it("rpcResult und rpcError tragen jsonrpc 2.0 und die id", () => {
    expect(rpcResult(4, { a: 1 })).toEqual({ jsonrpc: "2.0", id: 4, result: { a: 1 } });
    expect(rpcError(4, RPC.METHOD_NOT_FOUND, "weg")).toEqual({ jsonrpc: "2.0", id: 4, error: { code: -32601, message: "weg" } });
    expect(rpcError(null, RPC.PARSE_ERROR, "x").id).toBeNull();
  });
  it("notification hat keine id", () => {
    const n = notification("selection_changed", { a: 1 });
    expect(n).toEqual({ jsonrpc: "2.0", method: "selection_changed", params: { a: 1 } });
    expect("id" in n).toBe(false);
  });
});

describe("initialize", () => {
  it("antwortet mit der vom Client genannten Version", () => {
    expect(initializeResult("2025-11-25").protocolVersion).toBe("2025-11-25");
    expect(initializeResult("2030-01-01").protocolVersion).toBe("2030-01-01");
  });
  it("ohne Angabe oder falscher Typ: feste Rückfallversion", () => {
    expect(initializeResult(undefined).protocolVersion).toBe("2025-11-25");
    expect(initializeResult(42).protocolVersion).toBe("2025-11-25");
  });
  it("serverInfo ist Glasscockpit, capabilities nur tools", () => {
    const r = initializeResult("2025-11-25");
    expect(r.serverInfo.name).toBe("Glasscockpit");
    expect(IDE_NAME).toBe("Glasscockpit");
    expect(r.capabilities).toEqual({ tools: {} });
  });
});

describe("tools/list", () => {
  it("genau die sieben Tools der Spezifikation, kein openDiff", () => {
    expect(IDE_TOOLS.map((t) => t.name).sort()).toEqual(
      ["checkDocumentDirty", "getCurrentSelection", "getLatestSelection", "getOpenEditors", "getWorkspaceFolders", "openFile", "saveDocument"],
    );
    expect(IDE_TOOLS.map((t) => t.name)).not.toContain("openDiff");
  });
  it("jedes Tool hat Beschreibung und ein Objekt-Schema; Pfad-Tools verlangen filePath", () => {
    for (const t of IDE_TOOLS) {
      expect(t.description.length).toBeGreaterThan(5);
      expect(t.inputSchema.type).toBe("object");
    }
    for (const name of ["openFile", "checkDocumentDirty", "saveDocument"]) {
      expect(IDE_TOOLS.find((t) => t.name === name)?.inputSchema.required).toEqual(["filePath"]);
    }
  });
  it("dispatchRequest antwortet auf tools/list mit der Liste", async () => {
    const r = await dispatchRequest({ id: 1, method: "tools/list", params: undefined }, ctx());
    expect(r).toEqual({ jsonrpc: "2.0", id: 1, result: { tools: IDE_TOOLS } });
  });
});

describe("dispatchRequest", () => {
  it("initialize gibt die Antwort mit der Client-Version zurück", async () => {
    const r = await dispatchRequest({ id: 0, method: "initialize", params: { protocolVersion: "2025-11-25" } }, ctx());
    expect(r).toMatchObject({ id: 0, result: { protocolVersion: "2025-11-25", serverInfo: { name: "Glasscockpit" } } });
  });
  it("ping ergibt ein leeres Ergebnis", async () => {
    expect(await dispatchRequest({ id: 2, method: "ping", params: undefined }, ctx())).toEqual({ jsonrpc: "2.0", id: 2, result: {} });
  });
  it("unbekannte Methode: Fehler -32601 mit der id", async () => {
    const r = await dispatchRequest({ id: 5, method: "resources/list", params: undefined }, ctx());
    expect(r).toMatchObject({ id: 5, error: { code: RPC.METHOD_NOT_FOUND } });
  });
  it("tools/call ruft den Handler und gibt dessen Ergebnis zurück", async () => {
    const h = handlers({ getWorkspaceFolders: vi.fn(() => jsonResult({ success: true, rootPath: BASE })) });
    const r = await dispatchRequest({ id: 9, method: "tools/call", params: { name: "getWorkspaceFolders", arguments: {} } }, ctx(h));
    expect(h.getWorkspaceFolders).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ jsonrpc: "2.0", id: 9, result: jsonResult({ success: true, rootPath: BASE }) });
  });
  it("tools/call ohne arguments funktioniert für Tools ohne Eingabe", async () => {
    const r = await dispatchRequest({ id: 9, method: "tools/call", params: { name: "getOpenEditors" } }, ctx());
    expect(r).toMatchObject({ id: 9, result: { content: [{ type: "text" }] } });
  });
  it("unbekanntes Tool, auch openDiff: Fehler -32602", async () => {
    for (const name of ["openDiff", "gibtEsNicht"]) {
      const r = await dispatchRequest({ id: 1, method: "tools/call", params: { name, arguments: {} } }, ctx());
      expect(r).toMatchObject({ id: 1, error: { code: RPC.INVALID_PARAMS } });
    }
  });
  it("tools/call ohne Namen: Fehler -32602", async () => {
    expect(await dispatchRequest({ id: 1, method: "tools/call", params: {} }, ctx())).toMatchObject({ error: { code: RPC.INVALID_PARAMS } });
    expect(await dispatchRequest({ id: 1, method: "tools/call", params: undefined }, ctx())).toMatchObject({ error: { code: RPC.INVALID_PARAMS } });
  });
  it("Handler wirft: isError im Ergebnis mit dem Text, kein Protokollfehler", async () => {
    const h = handlers({ getOpenEditors: () => { throw new Error("kaputt"); } });
    const r = await dispatchRequest({ id: 1, method: "tools/call", params: { name: "getOpenEditors", arguments: {} } }, ctx(h));
    expect(r).toEqual({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "kaputt" }], isError: true } });
  });
  it("asynchroner Handler wird abgewartet", async () => {
    const h = handlers({ getOpenEditors: async () => jsonResult({ tabs: [1] }) });
    const r = await dispatchRequest({ id: 1, method: "tools/call", params: { name: "getOpenEditors", arguments: {} } }, ctx(h));
    expect(r).toEqual({ jsonrpc: "2.0", id: 1, result: jsonResult({ tabs: [1] }) });
  });
  it("Benachrichtigung (ohne id) bekommt keine Antwort", async () => {
    expect(await dispatchRequest({ id: undefined, method: "tools/list", params: undefined }, ctx())).toBeNull();
    expect(await dispatchRequest({ id: undefined, method: "notifications/initialized", params: undefined }, ctx())).toBeNull();
  });
});

describe("openFile und die Pfadprüfung im Dispatch", () => {
  const call = (name: string, args: unknown, h = handlers(), base: string | null = BASE) =>
    dispatchRequest({ id: 1, method: "tools/call", params: { name, arguments: args } }, ctx(h, base));

  it("Pfad im Vault: Handler bekommt den vault-relativen Pfad", async () => {
    const openFile = vi.fn(() => textResult("ok"));
    await call("openFile", { filePath: `${BASE}/Notizen/a.md` }, handlers({ openFile }));
    expect(openFile).toHaveBeenCalledWith({ path: "Notizen/a.md", absolute: `${BASE}/Notizen/a.md` });
  });
  it("Pfad außerhalb des Vaults: Fehler im Ergebnis, Handler nicht gerufen", async () => {
    const openFile = vi.fn(() => textResult("ok"));
    const r = await call("openFile", { filePath: "/etc/passwd" }, handlers({ openFile }));
    expect(openFile).not.toHaveBeenCalled();
    expect(r).toMatchObject({ result: { isError: true } });
  });
  it("Pfad mit .. wird abgelehnt, auch wenn er im Vault bliebe", async () => {
    const openFile = vi.fn(() => textResult("ok"));
    const r = await call("openFile", { filePath: `${BASE}/a/../b.md` }, handlers({ openFile }));
    expect(openFile).not.toHaveBeenCalled();
    expect(r).toMatchObject({ result: { isError: true } });
  });
  it("checkDocumentDirty und saveDocument haben dieselbe Sperre", async () => {
    const h = handlers({ checkDocumentDirty: vi.fn(() => textResult("x")), saveDocument: vi.fn(() => textResult("x")) });
    await call("checkDocumentDirty", { filePath: "/etc/hosts" }, h);
    await call("saveDocument", { filePath: `${BASE}/../x.md` }, h);
    expect(h.checkDocumentDirty).not.toHaveBeenCalled();
    expect(h.saveDocument).not.toHaveBeenCalled();
  });
  it("filePath fehlt oder ist kein Text: Fehler -32602", async () => {
    expect(await call("openFile", {})).toMatchObject({ error: { code: RPC.INVALID_PARAMS } });
    expect(await call("openFile", { filePath: 5 })).toMatchObject({ error: { code: RPC.INVALID_PARAMS } });
  });
  it("kein Vault-Ordner bekannt: Fehler im Ergebnis", async () => {
    const openFile = vi.fn(() => textResult("ok"));
    const r = await call("openFile", { filePath: `${BASE}/a.md` }, handlers({ openFile }), null);
    expect(openFile).not.toHaveBeenCalled();
    expect(r).toMatchObject({ result: { isError: true } });
  });
});

describe("resolveInVault", () => {
  it.each([
    [`${BASE}/a.md`, "a.md"],
    [`${BASE}/sub/dir/a b.md`, "sub/dir/a b.md"],
    ["sub/a.md", "sub/a.md"],
    ["./a.md", "a.md"],
    [`${BASE}//a.md`, "a.md"],
  ])("%s ist erlaubt als %s", (input, rel) => {
    expect(resolveInVault(BASE, input)).toEqual({ ok: true, path: rel, absolute: `${BASE}/${rel}` });
  });
  it("Basis mit Schrägstrich am Ende ändert nichts", () => {
    expect(resolveInVault(`${BASE}/`, `${BASE}/a.md`)).toMatchObject({ ok: true, path: "a.md" });
  });
  it.each([
    ["/etc/passwd"],
    [`${BASE}2/a.md`], // gleiches Präfix, anderer Ordner
    [`${BASE}`], // der Vault selbst ist keine Datei
    [`${BASE}/`],
    [`${BASE}/../a.md`],
    ["../a.md"],
    ["sub/../../a.md"],
    [`${BASE}/sub/..`],
    [""],
    ["   "],
    [`${BASE}/a\0.md`],
    ["~/x.md"],
  ])("%j wird abgelehnt", (input) => {
    expect(resolveInVault(BASE, input).ok).toBe(false);
  });
  it("auch ein Segment .. mit Punkten davor ist kein Freibrief (...  ist ein Name)", () => {
    expect(resolveInVault(BASE, `${BASE}/...md`)).toMatchObject({ ok: true });
    expect(resolveInVault(BASE, `${BASE}/..hidden/x.md`)).toMatchObject({ ok: true });
  });
});

describe("selection_changed und at_mentioned", () => {
  it("selectionParams: Felder wie in PROTOCOL.md", () => {
    expect(selectionParams({ filePath: `${BASE}/a b.md`, text: "hallo", start: { line: 1, character: 2 }, end: { line: 1, character: 7 } })).toEqual({
      text: "hallo",
      filePath: `${BASE}/a b.md`,
      fileUrl: `file://${BASE}/a%20b.md`,
      selection: { start: { line: 1, character: 2 }, end: { line: 1, character: 7 }, isEmpty: false },
    });
  });
  it("leere Auswahl: isEmpty true, auch wenn Anfang und Ende gleich sind", () => {
    const p = selectionParams({ filePath: "/x.md", text: "", start: { line: 3, character: 4 }, end: { line: 3, character: 4 } });
    expect(p.selection.isEmpty).toBe(true);
    expect(p.text).toBe("");
  });
  it("Sonderzeichen im Pfad werden in der URL kodiert, Schrägstriche bleiben", () => {
    expect(selectionParams({ filePath: "/a/ü#?.md", text: "t", start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }).fileUrl).toBe(
      "file:///a/%C3%BC%23%3F.md",
    );
  });
  it("atMentionParams: filePath, lineStart, lineEnd", () => {
    expect(atMentionParams("/x.md", 3, 9)).toEqual({ filePath: "/x.md", lineStart: 3, lineEnd: 9 });
  });
});

describe("Lockfile und Anmeldung", () => {
  it("lockContent hat genau die fünf Felder der Spezifikation", () => {
    const text = lockContent({ pid: 42, workspaceFolders: [BASE], authToken: "ab".repeat(16) });
    expect(JSON.parse(text)).toEqual({ pid: 42, workspaceFolders: [BASE], ideName: "Glasscockpit", transport: "ws", authToken: "ab".repeat(16) });
  });
  it("parseLock liest pid und ideName, alles Ungültige ergibt null", () => {
    expect(parseLock(lockContent({ pid: 42, workspaceFolders: [], authToken: "t" }))).toEqual({ pid: 42, ideName: "Glasscockpit" });
    expect(parseLock("{kaputt")).toBeNull();
    expect(parseLock('{"pid":"x","ideName":"A"}')).toBeNull();
    expect(parseLock("[]")).toBeNull();
    expect(parseLock('{"pid":5}')).toBeNull();
  });
  it("tokenEquals: gleich, anders, andere Länge, leer", () => {
    expect(tokenEquals("abc123", "abc123")).toBe(true);
    expect(tokenEquals("abc123", "abc124")).toBe(false);
    expect(tokenEquals("abc123", "abc12")).toBe(false);
    expect(tokenEquals("abc12", "abc123")).toBe(false);
    expect(tokenEquals("", "")).toBe(false); // leerer Token gilt nie als gültig
  });
  it("authorized: nur ein einzelner, genau passender Header-Wert", () => {
    expect(authorized("tok", "tok")).toBe(true);
    expect(authorized("falsch", "tok")).toBe(false);
    expect(authorized(undefined, "tok")).toBe(false);
    expect(authorized(["tok"], "tok")).toBe(false);
    expect(authorized("tok", "")).toBe(false);
  });
  it("ideEnv: die beiden Variablen, Port als Text", () => {
    expect(ideEnv(51234)).toEqual({ ENABLE_IDE_INTEGRATION: "true", CLAUDE_CODE_SSE_PORT: "51234" });
  });
});

describe("mentionLines: Zeilen für at_mentioned (0-basiert, Claude zeigt +1; gemessen 05.10.2026: lineStart 1, lineEnd 2 ergibt #L2-3)", () => {
  const sel = (sl: number, sc: number, el: number, ec: number) => ({ start: { line: sl, character: sc }, end: { line: el, character: ec }, isEmpty: sl === el && sc === ec });
  it("Auswahl über mehrere Zeilen", () => expect(mentionLines(sel(1, 2, 3, 4))).toEqual({ lineStart: 1, lineEnd: 3 }));
  it("leere Auswahl: nur die Zeile des Cursors", () => expect(mentionLines(sel(5, 3, 5, 3))).toEqual({ lineStart: 5, lineEnd: 5 }));
  it("Auswahl endet am Anfang einer Zeile: diese Zeile gehört nicht mehr dazu", () => expect(mentionLines(sel(2, 0, 4, 0))).toEqual({ lineStart: 2, lineEnd: 3 }));
  it("eine Zeile ganz markiert bis zum Zeilenanfang der nächsten", () => expect(mentionLines(sel(2, 0, 3, 0))).toEqual({ lineStart: 2, lineEnd: 2 }));
  it("Ende bei Spalte 0 in derselben Zeile (leer) bleibt eine Zeile", () => expect(mentionLines(sel(2, 0, 2, 0))).toEqual({ lineStart: 2, lineEnd: 2 }));
});

describe("Diff-Tools (Abend 17): nur bei ideDiff", () => {
  const diffHandlers = () => {
    const calls: unknown[] = [];
    const diff = {
      openDiff: vi.fn(async (a: unknown, clientId: number | null) => { calls.push(["openDiff", a, clientId]); return textResult("FILE_SAVED"); }),
      closeTab: vi.fn((n: string, c: number | null) => { calls.push(["closeTab", n, c]); return textResult("TAB_CLOSED"); }),
      closeAllDiffTabs: vi.fn((c: number | null) => { calls.push(["closeAll", c]); return textResult("CLOSED_2_DIFF_TABS"); }),
    };
    return { diff, calls };
  };
  const on = (h: IdeHandlers, clientId: number | null = 7) => ({ handlers: h, vaultBase: () => BASE, diffEnabled: () => true, clientId });
  const names = (r: Awaited<ReturnType<typeof dispatchRequest>>) => ((r?.result as { tools: Array<{ name: string }> }).tools).map((t) => t.name);
  const call = { openDiff: { name: "openDiff", arguments: { old_file_path: "/a/x", new_file_path: "/a/x", new_file_contents: "n", tab_name: "t" } } };

  it("ohne diffEnabled (aus): tools/list nur die sieben, kein Diff-Tool", async () => {
    const r = await dispatchRequest({ id: 1, method: "tools/list", params: undefined }, { handlers: { ...handlers(), diff: diffHandlers().diff }, vaultBase: () => BASE });
    expect(names(r)).toEqual(IDE_TOOLS.map((t) => t.name));
    expect(names(r)).not.toContain("openDiff");
  });
  it("diffEnabled liefert false: ebenso", async () => {
    const r = await dispatchRequest({ id: 1, method: "tools/list", params: undefined }, { ...on({ ...handlers(), diff: diffHandlers().diff }), diffEnabled: () => false });
    expect(names(r)).not.toContain("openDiff");
    expect(names(r)).not.toContain("close_tab");
    expect(names(r)).not.toContain("closeAllDiffTabs");
  });
  it("an: die sieben plus openDiff, close_tab, closeAllDiffTabs", async () => {
    const r = await dispatchRequest({ id: 1, method: "tools/list", params: undefined }, on({ ...handlers(), diff: diffHandlers().diff }));
    expect(names(r)).toEqual([...IDE_TOOLS.map((t) => t.name), "openDiff", "close_tab", "closeAllDiffTabs"]);
  });
  it("an, aber ohne Diff-Handler: die Tools werden nicht angeboten", async () => {
    const r = await dispatchRequest({ id: 1, method: "tools/list", params: undefined }, on(handlers()));
    expect(names(r)).toEqual(IDE_TOOLS.map((t) => t.name));
  });
  it("die Einstellung wird bei jeder Anfrage frisch gelesen (wirkt ohne Neustart)", async () => {
    let an = false;
    const c = { handlers: { ...handlers(), diff: diffHandlers().diff }, vaultBase: () => BASE, diffEnabled: () => an };
    expect(names(await dispatchRequest({ id: 1, method: "tools/list", params: undefined }, c))).not.toContain("openDiff");
    an = true;
    expect(names(await dispatchRequest({ id: 2, method: "tools/list", params: undefined }, c))).toContain("openDiff");
    an = false;
    expect(names(await dispatchRequest({ id: 3, method: "tools/list", params: undefined }, c))).not.toContain("openDiff");
  });
  it("aus: tools/call openDiff ist ein unbekanntes Tool (-32602), der Handler wird nicht gerufen", async () => {
    const { diff } = diffHandlers();
    const r = await dispatchRequest({ id: 1, method: "tools/call", params: call.openDiff }, { handlers: { ...handlers(), diff }, vaultBase: () => BASE, diffEnabled: () => false });
    expect(r?.error?.code).toBe(RPC.INVALID_PARAMS);
    expect(diff.openDiff).not.toHaveBeenCalled();
    for (const name of ["close_tab", "closeAllDiffTabs"]) {
      const x = await dispatchRequest({ id: 2, method: "tools/call", params: { name, arguments: { tab_name: "t" } } }, { handlers: { ...handlers(), diff }, vaultBase: () => BASE });
      expect(x?.error?.code).toBe(RPC.INVALID_PARAMS);
    }
    expect(diff.closeTab).not.toHaveBeenCalled();
    expect(diff.closeAllDiffTabs).not.toHaveBeenCalled();
  });
  it("an: openDiff reicht die geprüften Argumente und die Verbindung an den Handler", async () => {
    const { diff, calls } = diffHandlers();
    const r = await dispatchRequest({ id: 1, method: "tools/call", params: call.openDiff }, on({ ...handlers(), diff }, 7));
    expect(r?.result).toEqual({ content: [{ type: "text", text: "FILE_SAVED" }] });
    expect(calls).toEqual([["openDiff", { oldFilePath: "/a/x", newFilePath: "/a/x", newFileContents: "n", tabName: "t" }, 7]]);
  });
  it("an: ungültige openDiff-Argumente ergeben ein Fehlerergebnis (isError), kein Handleraufruf", async () => {
    const { diff } = diffHandlers();
    const r = await dispatchRequest({ id: 1, method: "tools/call", params: { name: "openDiff", arguments: { old_file_path: "/a/x" } } }, on({ ...handlers(), diff }));
    expect((r?.result as { isError?: boolean }).isError).toBe(true);
    expect(diff.openDiff).not.toHaveBeenCalled();
  });
  it("an: openDiff ist nicht an den Vault gebunden (Dateien in Repos außerhalb sind erlaubt)", async () => {
    const { diff } = diffHandlers();
    const r = await dispatchRequest({ id: 1, method: "tools/call", params: { name: "openDiff", arguments: { ...call.openDiff.arguments, new_file_path: "/Users/x/Repo/a.ts", old_file_path: "/Users/x/Repo/a.ts" } } }, on({ ...handlers(), diff }));
    expect((r?.result as { isError?: boolean }).isError).toBeUndefined();
    expect(diff.openDiff).toHaveBeenCalledOnce();
  });
  it("an: close_tab nimmt tab_name, closeAllDiffTabs keine Argumente", async () => {
    const { diff, calls } = diffHandlers();
    const c = on({ ...handlers(), diff });
    expect((await dispatchRequest({ id: 1, method: "tools/call", params: { name: "close_tab", arguments: { tab_name: "t" } } }, c))?.result).toEqual({ content: [{ type: "text", text: "TAB_CLOSED" }] });
    expect((await dispatchRequest({ id: 2, method: "tools/call", params: { name: "closeAllDiffTabs" } }, c))?.result).toEqual({ content: [{ type: "text", text: "CLOSED_2_DIFF_TABS" }] });
    // Beide bekommen die Verbindung mit: Sie wirken nur auf deren eigene Diffs.
    expect(calls).toEqual([["closeTab", "t", 7], ["closeAll", 7]]);
  });
  it("an: close_tab ohne Text als tab_name: Fehlerergebnis", async () => {
    const { diff } = diffHandlers();
    const r = await dispatchRequest({ id: 1, method: "tools/call", params: { name: "close_tab", arguments: { tab_name: 4 } } }, on({ ...handlers(), diff }));
    expect((r?.result as { isError?: boolean }).isError).toBe(true);
    expect(diff.closeTab).not.toHaveBeenCalled();
  });
  it("wirft der Handler, ist das ein Fehlerergebnis, kein Protokollfehler", async () => {
    const { diff } = diffHandlers();
    diff.openDiff.mockRejectedValueOnce(new Error("kaputt"));
    const r = await dispatchRequest({ id: 1, method: "tools/call", params: call.openDiff }, on({ ...handlers(), diff }));
    expect(r?.error).toBeUndefined();
    expect(r?.result).toMatchObject({ isError: true });
  });
});
