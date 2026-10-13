// Node-Tests: window = globalThis, damit window.setTimeout & Co. auf die (auch gefälschten) globalen Timer zeigen.
// happy-dom-Tests bringen ihr eigenes window mit; das bleibt stehen.
const g = globalThis as { window?: unknown };
g.window ??= globalThis;
