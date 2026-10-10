import type { TimerApi } from "./view-tracker";

export interface Debounced {
  (): void;
  cancel(): void;
}

/** Nachlaufend: viele Aufrufe in kurzer Folge ergeben einen Aufruf, ms nach dem letzten. */
export function createDebounce(fn: () => void, ms: number, timer: TimerApi): Debounced {
  let handle: unknown = null;
  const d = (() => {
    if (handle !== null) timer.clear(handle);
    handle = timer.set(() => {
      handle = null;
      fn();
    }, ms);
  }) as Debounced;
  d.cancel = () => {
    if (handle !== null) timer.clear(handle);
    handle = null;
  };
  return d;
}
