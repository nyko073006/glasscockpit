import { requestUrl } from "obsidian";
import { RESEARCH_TIMEOUT_MS } from "../core/constants";
import { describeFailure, type FetchOutcome, parseSearchResponse, type ResearchSearch, searchUrl } from "../core/research";

/**
 * Eine GitHub-Suche, ohne Token (öffentliche Suche, wenige Anfragen je Minute). Die einzige Research-Stelle mit
 * requestUrl. Fehler kommen als Ergebnis zurück, nie als Wurf: der Aufrufer ersetzt damit nur den Abschnitt der Suche.
 */
export async function fetchSearch(s: ResearchSearch): Promise<FetchOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // requestUrl kennt kein Zeitlimit: ein hängender Abruf darf den Lauf nicht sperren.
    const limit = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Zeitüberschreitung")), RESEARCH_TIMEOUT_MS);
    });
    const res = await Promise.race([requestUrl({
      url: searchUrl(s),
      method: "GET",
      headers: { Accept: "application/vnd.github+json" },
      throw: false,
    }), limit]);
    if (res.status === 200) {
      const items = parseSearchResponse(res.text);
      return items === null ? { ok: false, error: "Antwort nicht lesbar" } : { ok: true, items };
    }
    return { ok: false, error: describeFailure(res.status, res.headers, res.text, Date.now()) };
  } catch (fehler) {
    const msg = fehler instanceof Error ? fehler.message : String(fehler);
    return { ok: false, error: msg === "Zeitüberschreitung" ? `Zeitüberschreitung nach ${RESEARCH_TIMEOUT_MS / 1000} s` : `Kein Netz: ${msg}` };
  } finally {
    clearTimeout(timer);
  }
}
