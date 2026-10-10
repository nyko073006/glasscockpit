// IDE-Brücke (Abend 16): Welche Verbindung gehört zu welcher Terminal-Sitzung? Claude Code nennt in `ide_connected` die
// eigene pid; die Sitzung kennt die pid der PTY. Der Launcher startet claude ohne Shell, dann sind beide gleich; liegt ein
// Zwischenprozess dazwischen, ist claude ein Nachfahre der PTY-pid. Beides wird abgedeckt.

/** pid aus den Parametern von `ide_connected`; alles Ungültige ergibt null. */
export function parseIdeConnected(params: unknown): number | null {
  if (typeof params !== "object" || params === null || Array.isArray(params)) return null;
  const pid = (params as { pid?: unknown }).pid;
  return typeof pid === "number" && Number.isInteger(pid) && pid > 0 ? pid : null;
}

const MAX_DEPTH = 16;

/** Ist pid gleich ancestor oder ein Nachfahre davon? parentOf liefert die Eltern-pid, null wenn unbekannt. Endet nach MAX_DEPTH Schritten. */
export function descendsFrom(pid: number, ancestor: number, parentOf: (pid: number) => number | null): boolean {
  let current: number | null = pid;
  for (let i = 0; i <= MAX_DEPTH && current !== null && current > 0; i++) {
    if (current === ancestor) return true;
    current = parentOf(current);
  }
  return false;
}

export interface IdeClientInfo {
  id: number;
  pid: number | null;
}

/** Verbindung zur Sitzung mit dieser PTY-pid: gleiche pid zuerst, sonst der zuletzt verbundene Nachfahre, sonst null. */
export function clientForSession(
  clients: readonly IdeClientInfo[],
  ptyPid: number | undefined,
  parentOf: (pid: number) => number | null,
): IdeClientInfo | null {
  if (ptyPid === undefined) return null;
  const known = clients.filter((c): c is { id: number; pid: number } => c.pid !== null);
  const same = known.filter((c) => c.pid === ptyPid);
  if (same.length > 0) return same[same.length - 1];
  const below = known.filter((c) => descendsFrom(c.pid, ptyPid, parentOf));
  return below.length > 0 ? below[below.length - 1] : null;
}

/** Umgekehrt (Diff-Ansicht, Abend 17): zu welcher Sitzung gehört die Verbindung? Gleiche pid zuerst, sonst die Sitzung, deren PTY-pid ein Vorfahre ist. */
export function sessionForClient(
  client: IdeClientInfo,
  sessions: ReadonlyArray<{ id: string; pid: number | undefined }>,
  parentOf: (pid: number) => number | null,
): string | null {
  if (client.pid === null) return null;
  const pid = client.pid;
  const known = sessions.filter((s): s is { id: string; pid: number } => s.pid !== undefined);
  const same = known.find((s) => s.pid === pid);
  if (same) return same.id;
  return known.find((s) => descendsFrom(pid, s.pid, parentOf))?.id ?? null;
}
