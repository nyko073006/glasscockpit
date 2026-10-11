export type LoadErrorKind = "quarantine" | "spawn-helper" | "abi" | "fehlt" | "unbekannt";

export interface ClassifiedLoadError {
  kind: LoadErrorKind;
  /** Deutsche Meldung mit Originaltext und Hinweis. */
  message: string;
}

interface Klasse {
  kind: LoadErrorKind;
  muster: string[];
  titel: string;
  hinweis: string;
}

// Reihenfolge zählt: Der dlopen-Text bei Quarantäne nennt auch „(no such file)“ für Ausweichpfade.
const KLASSEN: Klasse[] = [
  {
    kind: "quarantine",
    muster: ["library load disallowed by system policy", "code signature"],
    titel: "macOS blockiert pty.node (Quarantäne oder Signatur)",
    hinweis:
      "xattr -dr com.apple.quarantine auf den Ordner native/ im Plugin ausführen und Obsidian neu laden. " +
      "Wurde die Datei verändert, mit codesign -s - neu signieren.",
  },
  {
    kind: "spawn-helper",
    muster: ["posix_spawnp failed"],
    titel: "Der Prozess ließ sich nicht starten (spawn-helper)",
    hinweis:
      "spawn-helper muss neben pty.node liegen und ausführbar sein (chmod 755), dann npm run deploy. " +
      "Prüfe auch, ob die Shell existiert.",
  },
  {
    kind: "abi",
    muster: ["node_module_version", "different node.js version"],
    titel: "pty.node passt nicht zur Node-Version von Obsidian",
    hinweis:
      "node-pty exakt in 1.1.0 installieren (npm install --save-exact node-pty@1.1.0), " +
      "die N-API-Prebuilds brauchen keinen Rebuild. Danach npm run deploy.",
  },
  {
    kind: "fehlt",
    muster: ["cannot find module", "no such file"],
    titel: "node-pty fehlt im Plugin-Ordner",
    hinweis:
      "In den Einstellungen von Glasscockpit auf „Binärdateien laden“ klicken und danach die Sitzung neu starten. " +
      "Wer aus dem Quelltext baut: npm run deploy, dann Obsidian neu laden.",
  },
];

const UNBEKANNT = {
  titel: "node-pty ließ sich nicht laden",
  hinweis: "Unbekannte Ursache. Die Entwicklerkonsole (Cmd+Option+I) zeigt den vollständigen Fehler.",
};

/** Ordnet einen Lade- oder Startfehler von node-pty einer Ursache zu. Reine Funktion. */
export function classifyLoadError(message: string): ClassifiedLoadError {
  const klein = message.toLowerCase();
  const klasse = KLASSEN.find((k) => k.muster.some((m) => klein.includes(m)));
  const { titel, hinweis } = klasse ?? UNBEKANNT;
  return {
    kind: klasse?.kind ?? "unbekannt",
    message: `${titel}.\n${message}\nHinweis: ${hinweis}`,
  };
}
