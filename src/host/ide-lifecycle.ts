import { ideEnv } from "../core/ide-protocol";

// IDE-Brücke (Abend 16): Start und Stopp des Servers nach der Einstellung ideBridge, ohne Obsidian (darum testbar).
// Aufrufe von sync laufen nacheinander, es lauscht nie mehr als ein Server, und ein Stopp mitten im Start lässt keinen stehen.

export interface IdeServerLike {
  start(): Promise<number | null>;
  stop(): Promise<void>;
  readonly port: number | null;
}

export interface IdeLifecycleDeps<S extends IdeServerLike> {
  /** Einstellung ideBridge, bei jeder Nutzung frisch gelesen. */
  enabled: () => boolean;
  create: () => S;
}

export class IdeLifecycle<S extends IdeServerLike = IdeServerLike> {
  private current: S | null = null;
  private queue: Promise<void> = Promise.resolve();
  private stopped = false;
  private readonly deps: IdeLifecycleDeps<S>;

  constructor(deps: IdeLifecycleDeps<S>) {
    this.deps = deps;
  }

  /** Der laufende Server, sonst null. */
  get server(): S | null {
    return this.current;
  }

  /** Server nach der Einstellung starten oder stoppen. Fehler nur in die Konsole. */
  sync(): Promise<void> {
    this.queue = this.queue.then(() => this.apply()).catch((fehler) => console.warn("Glasscockpit, IDE-Brücke:", fehler));
    return this.queue;
  }

  /** Erst wenn der Start (oder Stopp) nach der Einstellung durch ist: Sitzungen beim Laden sollen die Variablen noch bekommen. */
  ready(): Promise<void> {
    return this.queue;
  }

  /** Variablen für neue Claude-Sitzungen, null solange die Brücke aus ist oder nicht läuft. */
  env(): Record<string, string> | null {
    const port = this.deps.enabled() ? this.current?.port : null;
    return port ? ideEnv(port) : null;
  }

  /** Beim Entladen und beim Ausschalten: Der Server stoppt (sein Lockfile fällt synchron als Erstes). */
  stop(): Promise<void> {
    this.stopped = true;
    return this.shutdown();
  }

  private async apply(): Promise<void> {
    const wanted = this.deps.enabled() && !this.stopped;
    if (wanted && !this.current) {
      const server = this.deps.create();
      if ((await server.start()) === null) return;
      // Beim Entladen mitten im Start: nicht stehen lassen.
      if (this.stopped) await server.stop();
      else this.current = server;
    } else if (!wanted && this.current) {
      await this.shutdown();
    }
  }

  private async shutdown(): Promise<void> {
    const server = this.current;
    this.current = null;
    await server?.stop();
  }
}
