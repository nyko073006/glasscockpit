// Kern des Release-Wächters (pre-push im öffentlichen Repo). Typen entfernt Node selbst (ab 22.18).
export const PFLICHT_DATEIEN: readonly string[] = ["main.js", "manifest.json", "styles.css"];

export interface PushZeile {
  localRef: string;
  localSha: string;
  remoteRef: string;
  remoteSha: string;
}
export interface Release {
  tagName: string;
  isDraft: boolean;
  assets: string[];
}
export interface Urteil {
  exitCode: 0 | 1;
  meldungen: string[];
}
export interface PruefeEingabe {
  stdin: string;
  arg1: string;
  liesConfig: (schluessel: string) => string | null;
  manifestAn: (sha: string) => string;
  releases: (repo: string) => string;
}

/** jq-Filter für `gh api repos/<repo>/releases`: Dateien zählen nur mit Asset-Status uploaded (abgebrochene Uploads nicht). */
export const RELEASE_JQ =
  '.[] | {tagName: .tag_name, isDraft: .draft, assets: [.assets[] | select(.state == "uploaded") | .name]}';

const NULLEN = /^0+$/;

/** Zeilen von pre-push-stdin: `<local ref> <local sha> <remote ref> <remote sha>`. */
export function parsePrePush(stdin: string): PushZeile[] {
  return stdin
    .split("\n")
    .map((z) => z.trim())
    .filter((z) => z !== "")
    .map((z) => {
      const [localRef = "", localSha = "", remoteRef = "", remoteSha = ""] = z.split(/\s+/);
      return { localRef, localSha, remoteRef, remoteSha };
    });
}

/** Nur Pushes nach refs/heads/main, die nicht löschen. */
export function relevanteZeilen(zeilen: PushZeile[]): PushZeile[] {
  return zeilen.filter((z) => z.remoteRef === "refs/heads/main" && z.localSha !== "" && !NULLEN.test(z.localSha));
}

/** pushurl vor url (roh, ohne insteadOf); ohne Eintrag ist Argument 1 selbst die URL. */
export function remoteUrl(arg1: string, liesConfig: (schluessel: string) => string | null): string {
  const push = liesConfig(`remote.${arg1}.pushurl`);
  if (push) return push;
  const url = liesConfig(`remote.${arg1}.url`);
  if (url) return url;
  return arg1;
}

/** `owner/repo` aus einer GitHub-URL (https, scp-Form, ssh), sonst null. */
export function githubRepo(url: string): string | null {
  const m =
    /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(url) ??
    /^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(url) ??
    /^ssh:\/\/git@github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(url);
  return m ? `${m[1]}/${m[2]}` : null;
}

/** NDJSON von gh: eine JSON-Zeile je Release. Wirft bei Nicht-JSON oder fehlenden Feldern. */
export function parseReleases(text: string): Release[] {
  const aus: Release[] = [];
  for (const z of text.split("\n")) {
    if (z.trim() === "") continue;
    const o: unknown = JSON.parse(z);
    const r = o as Partial<Release> | null;
    // ASSUMPTION: falsche Feldtypen (statt fehlender Felder allein) werfen, weil eine unlesbare Release-Zeile nie als "kein Release" durchgehen darf (der Aufrufer sperrt bei Wurf).
    if (
      !r ||
      typeof r.tagName !== "string" ||
      typeof r.isDraft !== "boolean" ||
      !Array.isArray(r.assets) ||
      !r.assets.every((a) => typeof a === "string")
    ) {
      throw new Error(`Unerwartete Release-Zeile: ${z.slice(0, 120)}`);
    }
    aus.push({ tagName: r.tagName, isDraft: r.isDraft, assets: r.assets });
  }
  return aus;
}

function fehlende(r: Release): string[] {
  return PFLICHT_DATEIEN.filter((d) => !r.assets.includes(d));
}

function neuestes(releases: Release[]): string {
  let best: number[] | null = null;
  let tag = "keins";
  for (const r of releases) {
    if (r.isDraft || !/^\d+\.\d+\.\d+$/.test(r.tagName)) continue;
    const t = r.tagName.split(".").map(Number);
    if (!best || t[0] > best[0] || (t[0] === best[0] && (t[1] > best[1] || (t[1] === best[1] && t[2] > best[2])))) {
      best = t;
      tag = r.tagName;
    }
  }
  return tag;
}

/** Tag gleich Version (exakt) mit allen Pflichtdateien. Gibt es ein veröffentlichtes Release mit dem Tag, entscheidet nur dieses; Entwürfe zählen nur ohne veröffentlichtes. */
export function entscheide(version: string, releases: Release[]): Urteil {
  const passend = releases.filter((r) => r.tagName === version);
  const veroeffentlicht = passend.filter((r) => !r.isDraft);
  const massgeblich = veroeffentlicht.length > 0 ? veroeffentlicht : passend;
  if (massgeblich.some((r) => fehlende(r).length === 0)) {
    if (veroeffentlicht.length > 0) return { exitCode: 0, meldungen: [`Release ${version} vorhanden`] };
    return {
      exitCode: 0,
      meldungen: [
        `Release ${version} ist ein Entwurf: direkt nach dem Push veröffentlichen (gh release edit ${version} --draft=false --latest)`,
      ],
    };
  }
  if (massgeblich.length > 0) {
    // ASSUMPTION: bei mehreren unvollständigen Treffern wird die Fehlliste des Treffers mit den wenigsten fehlenden Dateien genannt, weil sie dem nächsten Schritt am nächsten kommt.
    const wenigste = massgeblich.map(fehlende).sort((a, b) => a.length - b.length)[0];
    return {
      exitCode: 1,
      meldungen: [`Release ${version} ist unvollständig, es fehlen: ${wenigste.join(", ")}`],
    };
  }
  return {
    exitCode: 1,
    meldungen: [
      `Push gesperrt: manifest.json trägt Version ${version}, aber es gibt kein Release ${version}.`,
      `Neuestes veröffentlichtes Release: ${neuestes(releases)}.`,
      "Weg: erst Release-Entwurf mit den Dateien anlegen, dann pushen, dann veröffentlichen.",
      "Notausgang: git push --no-verify",
    ],
  };
}

// ASSUMPTION: der Notausgang steht auch in Fehlerfällen (Manifest, Remote, gh), weil ein Ausfall des Wächters den Push sonst ohne Ausweg blockiert.
function gesperrt(grund: string): Urteil {
  return { exitCode: 1, meldungen: [`Push gesperrt: ${grund}`, "Notausgang: git push --no-verify"] };
}

function fehlertext(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ASSUMPTION: das Präfix "release-guard: " setzt nur scripts/release-guard.mjs, weil der Kern reine Texte liefert und die Ausgabe Sache der Verkabelung ist.
/** Prüft einen Push; Seiteneffekte (git, gh) kommen als Rückrufe herein, deren Fehler sperren. */
export function pruefePush(eingabe: PruefeEingabe): Urteil {
  const zeilen = relevanteZeilen(parsePrePush(eingabe.stdin));
  if (zeilen.length === 0) return { exitCode: 0, meldungen: [] };

  const versionen: string[] = [];
  for (const z of zeilen) {
    try {
      const manifest: unknown = JSON.parse(eingabe.manifestAn(z.localSha));
      const v = (manifest as { version?: unknown } | null)?.version;
      if (typeof v !== "string" || v === "") return gesperrt(`manifest.json in ${z.localSha.slice(0, 8)} hat keine gültige Version.`);
      versionen.push(v);
    } catch (e) {
      return gesperrt(`manifest.json in ${z.localSha.slice(0, 8)} nicht lesbar (${fehlertext(e)}).`);
    }
  }

  let url: string;
  try {
    url = remoteUrl(eingabe.arg1, eingabe.liesConfig);
  } catch (e) {
    return gesperrt(`Remote-URL nicht lesbar (${fehlertext(e)}).`);
  }
  const repo = githubRepo(url);
  if (!repo) return gesperrt(`Remote ist kein GitHub-Repo (${url}).`);

  let releases: Release[];
  try {
    releases = parseReleases(eingabe.releases(repo));
  } catch (e) {
    return gesperrt(`Releases von ${repo} nicht abrufbar (${fehlertext(e)}).`);
  }

  let exitCode: 0 | 1 = 0;
  const meldungen: string[] = [];
  // ASSUMPTION: gleiche Versionen mehrerer Zeilen werden einmal bewertet, weil das Urteil nur von der Version abhängt und Meldungen sich sonst doppeln.
  for (const v of new Set(versionen)) {
    const u = entscheide(v, releases);
    if (u.exitCode === 1) exitCode = 1;
    meldungen.push(...u.meldungen);
  }
  return { exitCode, meldungen };
}
