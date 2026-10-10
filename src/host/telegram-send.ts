import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { requestUrl } from "obsidian";
import { TELEGRAM_TIMEOUT_MS } from "../core/constants";
import { type CockpitSettings, expandHome } from "../core/settings";
import { type SendResult, describeResponse, redactToken, resolveCredentials } from "../core/telegram";

/** Text einer Datei oder null, wenn sie fehlt oder nicht lesbar ist. */
async function readOrNull(path: string): Promise<string | null> {
  try { return await readFile(path, "utf8"); } catch { return null; }
}

/**
 * Sendet einen Text per sendMessage. Token und Chat-ID werden bei jedem Aufruf frisch aus den Dateien gelesen,
 * nie zwischengespeichert, nie in Einstellungen oder data.json. Jede Ausgabe läuft durch redactToken.
 */
export async function sendTelegram(text: string, s: CockpitSettings, home: string): Promise<SendResult> {
  const envPath = expandHome(s.telegramEnvFile, home);
  const [envText, accessText] = await Promise.all([readOrNull(envPath), readOrNull(join(dirname(envPath), "access.json"))]);
  const cred = resolveCredentials(envText, accessText, s.telegramChatId);
  if (!cred.ok) return cred;
  try {
    // requestUrl kennt kein Zeitlimit: ein hängender Versand darf nichts blockieren.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const limit = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Zeitüberschreitung")), TELEGRAM_TIMEOUT_MS); });
    const res = await Promise.race([requestUrl({
      url: `https://api.telegram.org/bot${cred.token}/sendMessage`,
      method: "POST",
      contentType: "application/json",
      body: JSON.stringify({ chat_id: cred.chatId, text }),
      throw: false,
    }), limit]).finally(() => clearTimeout(timer));
    return describeResponse(res.status, res.text);
  } catch (fehler) {
    const msg = fehler instanceof Error ? fehler.message : String(fehler);
    return { ok: false, reason: `Netzfehler: ${redactToken(msg, cred.token)}` };
  }
}
