import { open, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { TRANSCRIPT_SEARCH_MS, TRANSCRIPT_TAIL_BYTES } from "../core/constants";
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

  private readonly sessionId: string;
  private readonly root: string;

  constructor(sessionId: string, root: string = join(homedir(), ".claude", "projects")) {
    this.sessionId = sessionId;
    this.root = root;
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
