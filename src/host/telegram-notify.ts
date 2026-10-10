import type { AttentionSignal } from "../core/attention";
import type { SessionRecord } from "../core/session-model";
import type { CockpitSettings } from "../core/settings";
import { redactToken, shouldSend, telegramText } from "../core/telegram";
import { readIdleSeconds } from "./idle-time";
import { sendTelegram } from "./telegram-send";

export interface TelegramNotifierDeps {
  settings: () => CockpitSettings;
  record: (id: string) => SessionRecord | null;
  home: string;
  now?: () => number;
}

/** Vierter Kanal: unabhängig von Tab-Sichtbarkeit, nur Art an, Mac im Leerlauf und Abstand je Sitzung. */
export class TelegramNotifier {
  private readonly lastAt = new Map<string, number>();
  private readonly deps: TelegramNotifierDeps;

  constructor(deps: TelegramNotifierDeps) { this.deps = deps; }

  async notify(sessionId: string, signal: AttentionSignal): Promise<void> {
    const s = this.deps.settings();
    const enabled = signal === "done" ? s.telegramOnDone : s.telegramOnQuestion;
    if (!enabled) return;
    const now = this.deps.now ?? Date.now;
    // Messen nur, wenn es etwas entscheidet; die Entscheidung samt Sperre danach in einem Zug (kein await dazwischen).
    const idleSec = s.telegramIdleMin > 0 ? await readIdleSeconds() : null;
    const t = now();
    if (!shouldSend({ enabled, idleMin: s.telegramIdleMin, idleSec, lastAt: this.lastAt.get(sessionId) ?? null, now: t, gapMs: s.alertGapMs })) return;
    this.lastAt.set(sessionId, t);
    const record = this.deps.record(sessionId);
    const text = telegramText(signal, record?.name ?? "Claude", record?.cwd ?? "", this.deps.home);
    const result = await sendTelegram(text, s, this.deps.home);
    if (!result.ok) console.warn("Glasscockpit: Telegram nicht gesendet:", redactToken(result.reason, null));
  }
}
