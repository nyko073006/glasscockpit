// Reine Zielpfad-Prüfung für den Deploy. Keine Imports, nur löschbare TS-Syntax
// (kein enum, kein namespace, keine Parameter-Properties): scripts/deploy.mjs importiert
// diese Datei direkt, Node entfernt die Typen ab 22.18 selbst.

const PLUGIN_FOLDER = "glasscockpit";
const FORBIDDEN_NAME = "agentic-os";

export function checkDeployTarget(path: string): { ok: true } | { ok: false; reason: string } {
  if (!path.startsWith("/")) {
    return { ok: false, reason: "Pfad ist nicht absolut" };
  }

  // Abschließende Schrägstriche sind erlaubt und zählen nicht als Segment.
  const segments = path.replace(/\/+$/, "").split("/");

  if (segments.includes("..")) {
    return { ok: false, reason: "Pfad enthält ein ..-Segment" };
  }

  // APFS unterscheidet nicht zwischen Groß- und Kleinschreibung, der Vergleich auch nicht.
  if (path.toLowerCase().includes(FORBIDDEN_NAME)) {
    return { ok: false, reason: `Pfad enthält ${FORBIDDEN_NAME} (Schreibweise egal)` };
  }

  if (segments[segments.length - 1] !== PLUGIN_FOLDER) {
    return {
      ok: false,
      reason: `Pfad endet nicht auf ${PLUGIN_FOLDER} (letztes Segment muss genau so heißen)`,
    };
  }

  return { ok: true };
}

export type DeployTargetResult = { ok: true; target: string; source: "env" | "file" } | { ok: false; reason: string };

// Ziel aus Env (COCKPIT_DEPLOY_TARGET) oder deploy.local.json ({ "target": "<absoluter Pfad>" }).
// Env vor Datei; leere oder nur aus Leerzeichen bestehende Env zählt als nicht gesetzt.
// Ein gesetztes, aber ungültiges Ziel fällt nie auf die andere Quelle zurück.
// Das Ergebnis läuft immer durch checkDeployTarget (Sperre gegen agentic-os inklusive).
export function resolveDeployTarget(
  envValue: string | undefined,
  localFileText: string | null,
): DeployTargetResult {
  const env = envValue?.trim() ?? "";
  let target: string;
  let quelle: string;
  let source: "env" | "file";

  if (env !== "") {
    target = env;
    quelle = "COCKPIT_DEPLOY_TARGET";
    source = "env";
  } else if (localFileText !== null) {
    quelle = "deploy.local.json";
    source = "file";
    let daten: unknown;
    try {
      daten = JSON.parse(localFileText);
    } catch {
      return { ok: false, reason: `${quelle} ist kein gültiges JSON` };
    }
    const wert = (daten as { target?: unknown } | null)?.target;
    if (typeof wert !== "string" || wert.trim() === "") {
      return { ok: false, reason: `${quelle} braucht ein Feld "target" mit einem absoluten Pfad` };
    }
    target = wert.trim();
  } else {
    return {
      ok: false,
      reason:
        "Kein Deploy-Ziel. Entweder die Umgebungsvariable COCKPIT_DEPLOY_TARGET setzen " +
        "oder deploy.local.json in der Repo-Wurzel anlegen (Vorlage: deploy.local.example.json).",
    };
  }

  const pruefung = checkDeployTarget(target);
  if (!pruefung.ok) {
    return { ok: false, reason: `Ziel aus ${quelle} ungültig: ${pruefung.reason}` };
  }
  return { ok: true, target, source };
}
