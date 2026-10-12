import { open, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { BackgroundTasks, scanBackgroundTasks } from "../core/background-tasks";
import { MAX_LINK_BASES, MAX_TOOL_PATHS, TRANSCRIPT_SEARCH_MS, TRANSCRIPT_TAIL_BYTES } from "../core/constants";
import { linkBases as baseFolders, mergeRecent, toolPaths } from "../core/file-links";
import { type CodeBlock, extractCodeBlocks, lastAnswerText, lastHandoffBlock } from "../core/transcript-code";
import { type FileStamp, mayRescan, statChanged, tailStart } from "../core/transcript-poll";

// Gibt es ~/.claude/projects/<ordner>/<id>.jsonl? Dann muss claude mit --resume starten.
export async function transcriptExists(
  sessionId: string,
  root: string = join(homedir(), ".claude", "projects"),
): Promise<boolean> {
  let dirs: string[];
  try {
    dirs = await readdir(root);
  } catch {
    return false;
  }
  for (const dir of dirs) {
    try {
      await stat(join(root, dir, `${sessionId}.jsonl`));
      return true;
    } catch {
      // nicht in diesem Ordner
    }
  }
  return false;
}

export interface TranscriptResult {
  /** false: Datei unverändert (oder noch nicht da), die Leiste bleibt wie sie ist. */
  changed: boolean;
  /** Codeblöcke der letzten Antwort; leer, wenn es keine gibt oder die Datei fehlt. */
  blocks: CodeBlock[];
  /**
   * Letzter Handoff-Block im gelesenen Text (lastHandoffBlock mit dem Präfix des Aufrufs); null, wenn es keinen gibt,
   * das Präfix leer ist oder nichts gelesen wurde. null heißt für den Aufrufer: den alten Wert behalten.
   */
  handoff: string | null;
}

/**
 * Liest das Claude-Transkript einer Sitzung: ~/.claude/projects/<kodiertes cwd>/<sessionId>.jsonl.
 * Das cwd wird nicht kodiert, die Datei wird über alle Unterordner gesucht und der Pfad gemerkt.
 */
export class TranscriptReader {
  private path: string | null = null;
  private stamp: FileStamp | null = null;
  private lastSearchAt: number | null = null;
  /** Pfade aus Claudes Werkzeugaufrufen (Abend 27b), chronologisch; sie bleiben, auch wenn der Aufruf aus dem gelesenen Ende fällt. */
  private paths: string[] = [];
  /** linkBases(), bis sich paths ändert. */
  private basesCache: string[] | null = null;
  /** Hintergrundaufgaben (Abend 28): Starts und Enden aus jedem gelesenen Ende der Datei, über Lesevorgänge hinweg gemerkt. */
  private readonly tasks = new BackgroundTasks();

  private readonly sessionId: string;
  private readonly root: string;
  private readonly home: string;

  constructor(sessionId: string, root: string = join(homedir(), ".claude", "projects"), home: string = homedir()) {
    this.sessionId = sessionId;
    this.root = root;
    this.home = home;
  }

  /**
   * Basisordner für relative Pfade in dieser Sitzung (Ordner aus cd, Lesen, Schreiben, Suchen), neueste zuerst. Jeder Leser
   * gehört zu einer Claude-ID, nach /clear beginnt der neue Leser leer.
   */
  linkBases(): string[] {
    return (this.basesCache ??= baseFolders(this.paths, this.home, MAX_LINK_BASES));
  }

  /**
   * Hintergrundaufgaben (Agents, Workflows, Bash, MCP), die laut Transkript noch laufen: Start ohne Ende, höchstens maxAgeMs alt
   * (Abend 28). Der Zustand bleibt über Lesevorgänge erhalten, denn read() sieht nur das Ende der Datei; ein neuer Leser
   * (neue Claude-ID nach /clear) beginnt leer.
   */
  openTasks(nowMs: number, maxAgeMs: number): number {
    return this.tasks.open(nowMs, maxAgeMs);
  }

  /**
   * force: auch bei unverändertem Stand neu lesen (Command). handoffPrefix: Einstellung handoffPrefix, vom Aufrufer
   * pro Aufruf frisch gelesen; gerechnet wird auf dem ohnehin gelesenen Text, die Datei wird dafür nicht noch einmal geöffnet.
   */
  async read(force = false, handoffPrefix = ""): Promise<TranscriptResult> {
    const path = await this.locate(force);
    if (!path) return { changed: false, blocks: [], handoff: null };
    let next: FileStamp;
    try {
      const st = await stat(path);
      next = { size: st.size, mtimeMs: st.mtimeMs };
    } catch {
      // Datei verschwunden: beim nächsten Poll neu suchen.
      const war = this.stamp !== null;
      this.path = null;
      this.stamp = null;
      return { changed: war, blocks: [], handoff: null };
    }
    if (!force && !statChanged(this.stamp, next)) return { changed: false, blocks: [], handoff: null };
    this.stamp = next;
    const text = await this.readTail(path, next.size);
    // Auf dem ohnehin gelesenen Text, ohne zweites Lesen: neue Funde ans Ende, ältere bleiben (bis MAX_TOOL_PATHS).
    this.paths = mergeRecent(this.paths, toolPaths(text, this.home), MAX_TOOL_PATHS);
    this.basesCache = null;
    this.tasks.merge(scanBackgroundTasks(text));
    const answer = lastAnswerText(text);
    return { changed: true, blocks: answer ? extractCodeBlocks(answer) : [], handoff: lastHandoffBlock(text, handoffPrefix) };
  }

  /** force (Command) übergeht die Drosselung der Ordnersuche. */
  private async locate(force: boolean): Promise<string | null> {
    if (this.path) return this.path;
    const now = Date.now();
    if (!force && !mayRescan(this.lastSearchAt, now, TRANSCRIPT_SEARCH_MS)) return null;
    this.lastSearchAt = now;
    let dirs: string[];
    try {
      dirs = await readdir(this.root);
    } catch {
      return null;
    }
    for (const dir of dirs) {
      const candidate = join(this.root, dir, `${this.sessionId}.jsonl`);
      try {
        await stat(candidate);
        this.path = candidate;
        return candidate;
      } catch {
        // nicht in diesem Ordner
      }
    }
    return null;
  }

  private async readTail(path: string, size: number): Promise<string> {
    const start = tailStart(size, TRANSCRIPT_TAIL_BYTES);
    const length = size - start;
    if (length <= 0) return "";
    const fh = await open(path, "r");
    try {
      const buf = Buffer.alloc(length);
      const { bytesRead } = await fh.read(buf, 0, length, start);
      return buf.toString("utf8", 0, bytesRead);
    } finally {
      await fh.close();
    }
  }
}
