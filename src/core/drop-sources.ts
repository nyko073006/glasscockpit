// Pfade aus den Texten, die ein Drop in dataTransfer legt. Rein: Dateizugriff kommt als Funktion herein.
// Abend 42: Die Plattform kommt als letzter Parameter (Vorgabe darwin); unter win32 entstehen Pfade mit Backslash.
import { isAbsolutePath, isRootRelative, lastSegment, type Platform, resolveAgainst } from "./platform-path";

/**
 * text/uri-list: Kommentarzeilen und Leerzeilen überspringen, nur file://-URLs, dekodiert.
 * win32: `file:///C:/x` wird `C:\x` (ohne führenden Schrägstrich), `file://server/share/x` wird `\\server\share\x`.
 */
export function parseUriList(text: string, platform: Platform = "darwin"): string[] {
  const paths: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.startsWith("file://")) continue;
    try {
      const url = new URL(line);
      const path = decodeURIComponent(url.pathname);
      if (platform !== "win32") paths.push(path);
      else paths.push(`${url.host ? `\\\\${url.host}` : ""}${path.replace(/^\/(?=[A-Za-z]:)/, "").replace(/\//g, "\\")}`);
    } catch {
      // Kaputte Kodierung: Zeile auslassen.
    }
  }
  return paths;
}

/** Pfadform: eine Zeile, beginnt mit `/` oder `~/`. win32: absoluter Pfad (Laufwerk oder UNC) oder `~/`, `~\\`. */
export function isPathLike(text: string, platform: Platform = "darwin"): boolean {
  if (/[\r\n]/.test(text)) return false;
  if (platform === "win32") return isAbsolutePath(platform, text) || text.startsWith("~/") || text.startsWith("~\\");
  return text.startsWith("/") || text.startsWith("~/");
}

/** Teile eines vault-relativen Pfads: darwin an `/`, win32 an beiden Trennern. */
const relativeParts = (relative: string, platform: Platform): string[] => relative.split(platform === "win32" ? /[\\/]/ : "/");

/** Vault-relativen Pfad an die Basis hängen (win32 mit Backslash). null bei Ausbruch (`..`) oder leerem Pfad. */
function joinInVault(vaultBase: string, relative: string, platform: Platform): string | null {
  const parts = relativeParts(relative, platform).filter((p) => p !== "" && p !== ".");
  if (parts.length === 0 || parts.includes("..")) return null;
  if (platform === "win32") return `${vaultBase.replace(/[\\/]+$/, "")}\\${parts.join("\\")}`;
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
  platform: Platform = "darwin",
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
    if (!file || relativeParts(file, platform).includes("..")) return null;
    const vault = url.searchParams.get("vault");
    const vaultName = platform === "win32" ? lastSegment(platform, vaultBase) : vaultBase.replace(/\/+$/, "").split("/").pop();
    if (!vaultName) return null; // Ohne Vault-Basis (Host kennt keine) gäbe es einen Pfad ab `/`.
    if (vault && vault !== vaultName) return null;
    const found = resolveName(file);
    return found === null ? null : joinInVault(vaultBase, found, platform);
  }

  if (trimmed.includes("://") || trimmed.startsWith("/") || trimmed.startsWith("~")) return null;
  // win32: auch `\x`, `C:\x`, `C:x` und UNC sind nicht vault-relativ.
  if (platform === "win32" && (trimmed.startsWith("\\") || /^[A-Za-z]:/.test(trimmed))) return null;
  if (!HAS_EXTENSION.test(trimmed)) return null;
  const abs = joinInVault(vaultBase, trimmed, platform);
  return abs !== null && exists(abs) ? abs : null;
}

/** Stufe text/plain: Pfadform gilt als Pfad, sonst Obsidian-Auflösung, sonst nichts. */
export function pathsFromText(
  text: string,
  vaultBase: string,
  exists: (abs: string) => boolean,
  resolveName: NameResolver,
  platform: Platform = "darwin",
): string[] {
  const trimmed = text.trim();
  if (isPathLike(trimmed, platform)) return [trimmed];
  // win32: \x und /x (wurzelrelativ, nicht UNC) hängen am Laufwerk des Vaults, wie Windows sie selbst versteht; C:x bleibt abgelehnt.
  // Nur eine Zeile, nur wenn es die Datei dort gibt (sonst würde „/clear“ zu „C:\\clear“).
  if (platform === "win32" && vaultBase !== "" && isRootRelative(trimmed) && !/[\r\n]/.test(trimmed) && !trimmed.includes("://")) {
    const rooted = resolveAgainst(platform, vaultBase, trimmed);
    if (rooted !== null && exists(rooted)) return [rooted];
  }
  const resolved = resolveObsidianDrop(trimmed, vaultBase, exists, resolveName, platform);
  return resolved ? [resolved] : [];
}
