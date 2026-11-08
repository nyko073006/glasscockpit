import { describe, expect, it } from "vitest";
import type { SessionSpec } from "../src/core/session-manager";
import type { LoadResult, NativeLoader, PtyModule } from "../src/host/native-loader";
import { NodePtyFactory } from "../src/host/pty-factory";

// ConPTY-DLL (Abend 40): Unter Windows bekommt node-pty `useConptyDll`, sonst bleiben die Optionen wie bisher.

const SPEC: SessionSpec = {
  id: "s1",
  file: "claude",
  args: ["--resume", "x"],
  cwd: "/work",
  env: { TERM: "xterm-256color", PATH: "/usr/bin" },
  cols: 100,
  rows: 40,
};

/** Loader-Attrappe: das Modul merkt sich die Optionen des letzten spawn. */
function mitModul() {
  const gesehen: { opts: unknown }[] = [];
  const pty = {
    spawn: (_file: string, _args: string[], opts: unknown) => {
      gesehen.push({ opts });
      return {};
    },
  };
  const loader = { load: async (): Promise<LoadResult> => ({ ok: true, pty: pty as unknown as PtyModule }) } as unknown as NativeLoader;
  return { loader, gesehen };
}

describe("NodePtyFactory (Abend 40)", () => {
  it("darwin: genau die bisherigen Optionen", async () => {
    const { loader, gesehen } = mitModul();
    const factory = new NodePtyFactory(loader, "darwin");
    await factory.prepare();

    factory.create(SPEC);

    expect(gesehen[0].opts).toStrictEqual({ name: "xterm-256color", cols: 100, rows: 40, cwd: "/work", env: SPEC.env });
  });

  it("win32: dieselben Optionen plus useConptyDll", async () => {
    const { loader, gesehen } = mitModul();
    const factory = new NodePtyFactory(loader, "win32");
    await factory.prepare();

    factory.create(SPEC);

    expect(gesehen[0].opts).toStrictEqual({
      name: "xterm-256color",
      cols: 100,
      rows: 40,
      cwd: "/work",
      env: SPEC.env,
      useConptyDll: true,
    });
  });

  it("ohne geladenes Modul wirft create", () => {
    const { loader } = mitModul();
    expect(() => new NodePtyFactory(loader, "win32").create(SPEC)).toThrow("node-pty ist noch nicht geladen.");
  });
});
