// Kopiert das gebaute Plugin und node-pty in den Vault. Kopie, kein Symlink: Obsidian bekommt echte Dateien.
// Ziel aus COCKPIT_DEPLOY_TARGET oder deploy.local.json (Repo-Wurzel), Auflösung und Prüfung rein in
// src/core/deploy-target.ts. Node ab 22.18 entfernt die Typen selbst.
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { copyNodePty } from "./lib/native-copy.ts";
import { checkDeployTarget, resolveDeployTarget } from "../src/core/deploy-target.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOKALE_DATEI = join(ROOT, "deploy.local.json");

// Quelle (relativ zur Repo-Wurzel) und Dateiname im Ziel.
const DATEIEN = [
  ["build/main.js", "main.js"],
  ["manifest.json", "manifest.json"],
  ["build/styles.css", "styles.css"],
];

// node-pty aus dem offiziellen npm-Paket, macOS arm64 und x64 (scripts/lib/native-copy.ts, auch vom Release genutzt).
const PTY_QUELLE = join(ROOT, "node_modules", "node-pty");

function pruefe(ergebnis, was) {
  if (!ergebnis.ok) {
    throw new Error(`${was}: ${ergebnis.reason}`);
  }
}

function istSichtbar(name) {
  return !name.startsWith(".");
}

// Echter Pfad, auch wenn das Ziel noch fehlt: realpath des nächsten vorhandenen Vorfahren,
// die fehlenden Segmente angehängt. So greift die Prüfung, bevor mkdir etwas anlegt.
function echterPfad(pfad) {
  const fehlend = [];
  let vorhanden = pfad;
  while (!existsSync(vorhanden)) {
    fehlend.unshift(basename(vorhanden));
    vorhanden = dirname(vorhanden);
  }
  return join(realpathSync(vorhanden), ...fehlend);
}

// Ziel auflösen (Env vor Datei) und prüfen, vor jedem Schreibzugriff. Fehler: Meldung, Exit-Code 1.
function loeseZielAuf() {
  const dateiText = existsSync(LOKALE_DATEI) ? readFileSync(LOKALE_DATEI, "utf8") : null;
  const ergebnis = resolveDeployTarget(process.env.COCKPIT_DEPLOY_TARGET, dateiText);
  if (!ergebnis.ok) {
    console.error(`Deploy abgebrochen: ${ergebnis.reason}`);
    process.exit(1);
  }
  return { ziel: ergebnis.target, quelle: ergebnis.source === "env" ? "env" : "deploy.local.json" };
}

function deploy(zielRoh) {
  // 1. Prüfung (Auflösung) ist schon gelaufen; hier noch einmal, damit deploy() allein sicher ist.
  pruefe(checkDeployTarget(zielRoh), "Zielpfad ungültig");

  // Ohne abschließenden Schrägstrich, denn lstat folgt mit ihm einem Symlink am Ziel.
  const ziel = zielRoh.replace(/\/+$/, "");

  // 2. Ein Symlink am Ziel bricht ab: Deploy schreibt nie durch einen Symlink.
  const info = lstatSync(ziel, { throwIfNoEntry: false });
  if (info?.isSymbolicLink()) {
    throw new Error(`Ziel ist ein Symlink, Deploy kopiert nur in echte Ordner: ${ziel}`);
  }
  if (info && !info.isDirectory()) {
    throw new Error(`Ziel existiert, ist aber kein Ordner: ${ziel}`);
  }

  // 3. Quellen prüfen, bevor etwas angelegt wird.
  for (const [quelle] of DATEIEN) {
    if (!existsSync(join(ROOT, quelle))) {
      throw new Error(`${quelle} fehlt, erst npm run build ausführen`);
    }
  }

  // 4. Dieselbe Prüfung auf den echten Pfad (Symlinks in Vorfahren), bevor etwas angelegt wird.
  //    Nach dem Anlegen noch einmal, falls sich der Pfad dazwischen geändert hat.
  pruefe(checkDeployTarget(echterPfad(ziel)), "Echter Zielpfad ungültig");
  mkdirSync(ziel, { recursive: true });
  pruefe(checkDeployTarget(realpathSync(ziel)), "Echter Zielpfad ungültig");

  // 5. Kopieren.
  let anzahl = 0;
  for (const [quelle, name] of DATEIEN) {
    copyFileSync(join(ROOT, quelle), join(ziel, name));
    anzahl += 1;
  }

  // native/ nur, wenn es nicht versteckte Einträge hat. Punktdateien (.gitkeep) nie kopieren.
  const nativeQuelle = join(ROOT, "native");
  if (existsSync(nativeQuelle) && readdirSync(nativeQuelle).some(istSichtbar)) {
    cpSync(nativeQuelle, join(ziel, "native"), {
      recursive: true,
      dereference: true,
      filter: (quelle) => {
        if (!istSichtbar(basename(quelle))) {
          return false;
        }
        if (statSync(quelle).isFile()) {
          anzahl += 1;
        }
        return true;
      },
    });
  }

  anzahl += deployNodePty(join(ziel, "native"));
  return anzahl;
}

function deployNodePty(nativeZiel) {
  const anzahl = copyNodePty(PTY_QUELLE, nativeZiel);
  execFileSync("xattr", ["-cr", nativeZiel]);
  return anzahl;
}

try {
  const { ziel, quelle } = loeseZielAuf();
  const anzahl = deploy(ziel);
  console.log(`Deploy ok: ${anzahl} Dateien -> ${ziel} (Quelle: ${quelle})`);
} catch (fehler) {
  console.error(`Deploy abgebrochen: ${fehler instanceof Error ? fehler.message : fehler}`);
  process.exit(1);
}
