// Pfade aus den Texten, die ein Drop in dataTransfer legt. Rein: Dateizugriff kommt als Funktion herein.

/** text/uri-list: Kommentarzeilen und Leerzeilen überspringen, nur file://-URLs, dekodiert. */
export function parseUriList(text: string): string[] {
  const paths: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.startsWith("file://")) continue;
    try {
      const url = new URL(line);
      paths.push(decodeURIComponent(url.pathname));
    } catch {
      // Kaputte Kodierung: Zeile auslassen.
    }
  }
  return paths;
}

/** Pfadform: eine Zeile, beginnt mit `/` oder `~/`. */
export function isPathLike(text: string): boolean {
  if (/[\r\n]/.test(text)) return false;
  return text.startsWith("/") || text.startsWith("~/");
}

/** Vault-relativen Pfad an die Basis hängen. null bei Ausbruch (`..`) oder leerem Pfad. */
function joinInVault(vaultBase: string, relative: string): string | null {
  const parts = relative.split("/").filter((p) => p !== "" && p !== ".");
  if (parts.length === 0 || parts.includes("..")) return null;
  return `${vaultBase.replace(/\/+$/, "")}/${parts.join("/")}`;
}

const HAS_EXTENSION = /\.[A-Za-z0-9]+$/;

/**
 * Löst einen Namen aus `obsidian://…&file=` auf: der Vault-Pfad der Datei oder null, wenn es sie nicht gibt.
 * Der Host nimmt `app.metadataCache.getFirstLinkpathDest(name, "")`; er kennt Notizen ohne Endung und Namen ohne Ordner.
 */
export type NameResolver = (name: string) => string | null;

/**
 * Obsidian-Drop auflösen: `obsidian://open?vault=…&file=…` (der Name geht an den Resolver, eingefügt wird nur,
 * was es im Vault gibt) oder ein vault-relativer Pfad mit Endung, der wirklich existiert. Sonst null.
 */
export function resolveObsidianDrop(
  text: string,
  vaultBase: string,
  exists: (abs: string) => boolean,
  resolveName: NameResolver,
): string | null {
  const trimmed = text.trim();
  if (!trimmed || /[\r\n]/.test(trimmed)) return null;

  if (trimmed.startsWith("obsidian://")) {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      return null;
    }
    const file = url.searchParams.get("file");
    if (!file || file.split("/").includes("..")) return null;
    const vault = url.searchParams.get("vault");
    const vaultName = vaultBase.replace(/\/+$/, "").split("/").pop();
    if (!vaultName) return null; // Ohne Vault-Basis (Host kennt keine) gäbe es einen Pfad ab `/`.
    if (vault && vault !== vaultName) return null;
    const found = resolveName(file);
    return found === null ? null : joinInVault(vaultBase, found);
  }

  if (trimmed.includes("://") || trimmed.startsWith("/") || trimmed.startsWith("~")) return null;
  if (!HAS_EXTENSION.test(trimmed)) return null;
  const abs = joinInVault(vaultBase, trimmed);
  return abs !== null && exists(abs) ? abs : null;
}

/** Stufe text/plain: Pfadform gilt als Pfad, sonst Obsidian-Auflösung, sonst nichts. */
export function pathsFromText(text: string, vaultBase: string, exists: (abs: string) => boolean, resolveName: NameResolver): string[] {
  const trimmed = text.trim();
  if (isPathLike(trimmed)) return [trimmed];
  const resolved = resolveObsidianDrop(trimmed, vaultBase, exists, resolveName);
  return resolved ? [resolved] : [];
}
