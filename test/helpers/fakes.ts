import type { Disposable, PtyLike, SessionSpec } from "../../src/core/session-manager";
import type { TimerApi } from "../../src/core/view-tracker";

/** PTY ohne Prozess: Tests schieben Daten und Exit von Hand hinein. */
export class FakePty implements PtyLike {
  readonly spec: SessionSpec;
  readonly written: string[] = [];
  readonly resizes: Array<[number, number]> = [];
  killed = 0;
  readonly signals: string[] = [];
  pid: number | undefined = undefined;
  private dataListeners: Array<(data: string) => void> = [];
  private exitListeners: Array<(event: { exitCode: number }) => void> = [];

  constructor(spec: SessionSpec) {
    this.spec = spec;
  }

  onData(listener: (data: string) => void): Disposable {
    this.dataListeners.push(listener);
    return { dispose: () => (this.dataListeners = this.dataListeners.filter((l) => l !== listener)) };
  }

  onExit(listener: (event: { exitCode: number }) => void): Disposable {
    this.exitListeners.push(listener);
    return { dispose: () => (this.exitListeners = this.exitListeners.filter((l) => l !== listener)) };
  }

  write(data: string): void {
    this.written.push(data);
  }

  resize(cols: number, rows: number): void {
    this.resizes.push([cols, rows]);
  }

  kill(signal?: string): void {
    this.killed++;
    this.signals.push(signal ?? "");
  }

  emit(data: string): void {
    for (const listener of [...this.dataListeners]) listener(data);
  }

  exit(exitCode: number): void {
    for (const listener of [...this.exitListeners]) listener({ exitCode });
  }

  get listenerCount(): number {
    return this.dataListeners.length + this.exitListeners.length;
  }
}

/** Factory, die jede erzeugte FakePty festhält. */
export function fakeFactory(): { create: (spec: SessionSpec) => FakePty; created: FakePty[] } {
  const created: FakePty[] = [];
  return {
    created,
    create: (spec) => {
      const pty = new FakePty(spec);
      created.push(pty);
      return pty;
    },
  };
}

export function spec(id: string, extra: Partial<SessionSpec> = {}): SessionSpec {
  return { id, file: "/bin/zsh", args: ["-l"], cwd: "/Users/test", env: { TERM: "xterm-256color" }, cols: 80, rows: 24, ...extra };
}

/** Timer mit Uhr von Hand. */
export class FakeTimers implements TimerApi {
  now = 0;
  private next = 1;
  private pending = new Map<number, { at: number; callback: () => void }>();

  set(callback: () => void, ms: number): unknown {
    const handle = this.next++;
    this.pending.set(handle, { at: this.now + ms, callback });
    return handle;
  }

  clear(handle: unknown): void {
    this.pending.delete(handle as number);
  }

  advance(ms: number): void {
    this.now += ms;
    for (const [handle, timer] of [...this.pending]) {
      if (timer.at <= this.now) {
        this.pending.delete(handle);
        timer.callback();
      }
    }
  }

  get pendingCount(): number {
    return this.pending.size;
  }
}
