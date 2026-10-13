/** Obsidians DOM-Helfer für happy-dom und die Chrome-Vorschau: createEl/createDiv/createSpan hängen das neue Element an den Knoten,
 *  an dem sie aufgerufen werden (wie in Obsidian, auch an einem DocumentFragment); empty leert; `doc` und `win` liefern Dokument und Fenster
 *  des Knotens; `createFragment` am Fenster legt ein Fragment dieses Dokuments an. Jeder Eintrag wird nur gesetzt, wenn er fehlt. */
interface Info { cls?: string | string[]; text?: string; attr?: Record<string, string> }
type Maker = { createEl(tag: string, info?: Info | string): HTMLElement };

export function installObsidianDom(win: { Node: { prototype: object }; document: Document }): void {
  const proto = win.Node.prototype as Record<string, unknown>;
  if (typeof proto.createEl !== "function") {
    proto.createEl = function (this: Node, tag: string, info: Info | string = {}) {
      const o: Info = typeof info === "string" ? { cls: info } : info;
      const doc = this.ownerDocument ?? (this as unknown as Document);
      const e = doc.createElement(tag);
      if (o.cls) e.className = Array.isArray(o.cls) ? o.cls.join(" ") : o.cls;
      if (o.text !== undefined) e.textContent = o.text;
      for (const [k, v] of Object.entries(o.attr ?? {})) e.setAttribute(k, v);
      this.appendChild(e);
      return e;
    };
  }
  if (typeof proto.createDiv !== "function") proto.createDiv = function (this: Node, info?: Info | string) { return (this as unknown as Maker).createEl("div", info); };
  if (typeof proto.createSpan !== "function") proto.createSpan = function (this: Node, info?: Info | string) { return (this as unknown as Maker).createEl("span", info); };
  if (typeof proto.empty !== "function") proto.empty = function (this: Element) { this.replaceChildren(); };
  // Ein Document ist sein eigenes Dokument (ownerDocument ist dort null).
  if (!("doc" in proto)) {
    Object.defineProperty(proto, "doc", { configurable: true, get(this: Node): Document | null { return this.ownerDocument ?? (this as unknown as Document); } });
  }
  if (!("win" in proto)) {
    Object.defineProperty(proto, "win", { configurable: true, get(this: Node): Window | null { return (this.ownerDocument ?? (this as unknown as Document)).defaultView; } });
  }
  const w = win as unknown as Record<string, unknown>;
  if (typeof w.createFragment !== "function") {
    w.createFragment = (callback?: (f: DocumentFragment) => void): DocumentFragment => {
      const f = win.document.createDocumentFragment();
      callback?.(f);
      return f;
    };
  }
}
