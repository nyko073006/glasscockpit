/**
 * Wächter für die Veröffentlichung (rein, ohne fs): prüft Dateien gegen eine Sperrliste.
 * Der Treffertext selbst steckt nie im Ergebnis, auch nicht im Dateipfad: dort ist er maskiert.
 */

export interface Denylist {
  /** Sperrbegriffe, normalisiert (NFKD, ohne Kombinations- und Formatzeichen, klein). */
  terms: string[];
  /** Erlaubte Ausnahmen, normalisiert; gelten nur mit Wortgrenze beiderseits. */
  exceptions: string[];
}

export interface Hit {
  /** Pfad mit maskierten Treffern (`***`). */
  file: string;
  /** 1-basiert; 0 = Treffer im Dateipfad oder in Binärdaten. */
  line: number;
  /** Herkunft des Inhalts, wenn nicht der Arbeitsbaum: "binär", "HEAD", "Index". */
  note?: string;
}

const MASK = "***";
const WORT = /[a-z0-9_]/;

/** Vergleichsform eines Textes: NFKD, ohne \p{M} und \p{Cf}, klein. */
function normalisiere(text: string): string {
  return text.normalize("NFKD").replace(/[\p{M}\p{Cf}]/gu, "").toLowerCase();
}

/** Normalisierter Text samt Abbildung jedes normalisierten Zeichens auf [Start, Ende) im Original. */
function normalisiereMitAbbildung(text: string): { norm: string; von: number[]; bis: number[] } {
  let norm = "";
  const von: number[] = [];
  const bis: number[] = [];
  let pos = 0;
  for (const zeichen of text) {
    const n = normalisiere(zeichen);
    for (let k = 0; k < n.length; k++) {
      von.push(pos);
      bis.push(pos + zeichen.length);
    }
    norm += n;
    pos += zeichen.length;
  }
  return { norm, von, bis };
}

/** Ein Begriff je Zeile, `#` Kommentar, `!` vorn = Ausnahme, Leerzeilen ignoriert. */
export function parseDenylist(text: string): Denylist {
  const terms: string[] = [];
  const exceptions: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const zeile = raw.trim();
    if (zeile === "" || zeile.startsWith("#")) continue;
    if (zeile.startsWith("!")) {
      const ausnahme = normalisiere(zeile.slice(1).trim());
      if (ausnahme !== "") exceptions.push(ausnahme);
    } else {
      const begriff = normalisiere(zeile);
      if (begriff !== "") terms.push(begriff);
    }
  }
  return { terms, exceptions };
}

/** Bereiche [Start, Ende) im Original, an denen ein Sperrbegriff steht (Ausnahmen mit Wortgrenze ausgenommen). */
function trefferBereiche(text: string, liste: Denylist): Array<[number, number]> {
  const { norm, von, bis } = normalisiereMitAbbildung(text);
  if (norm === "") return [];
  const zeichen = norm.split("");
  for (const ausnahme of liste.exceptions) {
    let i = norm.indexOf(ausnahme);
    while (i !== -1) {
      const vor = i > 0 ? norm[i - 1] : "";
      const nach = norm[i + ausnahme.length] ?? "";
      if (!(vor && WORT.test(vor)) && !(nach && WORT.test(nach))) {
        for (let k = i; k < i + ausnahme.length; k++) zeichen[k] = " ";
      }
      i = norm.indexOf(ausnahme, i + 1);
    }
  }
  const frei = zeichen.join("");
  const bereiche: Array<[number, number]> = [];
  for (const begriff of liste.terms) {
    let i = frei.indexOf(begriff);
    while (i !== -1) {
      bereiche.push([von[i], bis[i + begriff.length - 1]]);
      i = frei.indexOf(begriff, i + 1);
    }
  }
  return bereiche;
}

/** Der Pfad, jedes Vorkommen eines Sperrbegriffs durch `***` ersetzt; Ausnahmen bleiben stehen. */
export function maskPath(path: string, liste: Denylist): string {
  const bereiche = trefferBereiche(path, liste).sort((a, b) => a[0] - b[0]);
  let out = "";
  let pos = 0;
  for (const [s, e] of bereiche) {
    if (e <= pos) continue;
    out += path.slice(pos, Math.max(pos, s)) + MASK;
    pos = e;
  }
  return out + path.slice(pos);
}

function mitNotiz(hit: Hit, note?: string): Hit {
  return note ? { ...hit, note } : hit;
}

/** Prüft Pfad (Zeile 0) und, falls `content` ein Text ist, jede Zeile. `null` = nur der Pfad. */
export function checkFile(path: string, content: string | null, liste: Denylist, note?: string): Hit[] {
  const hits: Hit[] = [];
  const maskiert = maskPath(path, liste);
  if (maskiert !== path) hits.push(mitNotiz({ file: maskiert, line: 0 }, note));
  if (content !== null) {
    content.split(/\r?\n/).forEach((zeile, i) => {
      if (trefferBereiche(zeile, liste).length > 0) hits.push(mitNotiz({ file: maskiert, line: i + 1 }, note));
    });
  }
  return hits;
}

function dekodiereUtf16(bytes: Uint8Array, bigEndian: boolean): string {
  const gerade = bytes.length - (bytes.length % 2);
  const kopie = new Uint8Array(gerade);
  for (let i = 0; i < gerade; i += 2) {
    kopie[i] = bigEndian ? bytes[i + 1] : bytes[i];
    kopie[i + 1] = bigEndian ? bytes[i] : bytes[i + 1];
  }
  return new TextDecoder("utf-16le").decode(kopie);
}

/**
 * Prüft Pfad und Rohbytes. UTF-16 mit BOM wird dekodiert und zeilenweise geprüft; sonstige Dateien mit NUL
 * in den ersten 8000 Bytes gelten als binär und werden als latin1 und als utf16le durchsucht (Treffer: Zeile 0,
 * Vermerk "binär"); alles andere ist UTF-8-Text.
 */
export function checkBytes(path: string, bytes: Uint8Array, liste: Denylist, note?: string): Hit[] {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return checkFile(path, dekodiereUtf16(bytes.subarray(2), false), liste, note);
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return checkFile(path, dekodiereUtf16(bytes.subarray(2), true), liste, note);
  }
  const istBinaer = bytes.subarray(0, 8000).includes(0);
  if (!istBinaer) return checkFile(path, new TextDecoder("utf-8").decode(bytes), liste, note);
  const hits = checkFile(path, null, liste, note);
  const kandidaten = [new TextDecoder("latin1").decode(bytes), dekodiereUtf16(bytes, false), dekodiereUtf16(bytes.subarray(1), false)];
  if (kandidaten.some((text) => trefferBereiche(text, liste).length > 0)) {
    hits.push({ file: maskPath(path, liste), line: 0, note: note ? `${note}, binär` : "binär" });
  }
  return hits;
}
