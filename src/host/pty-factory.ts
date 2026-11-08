import type { Platform } from "../core/platform-path";
import type { PtyLike, SessionSpec } from "../core/session-manager";
import { ptyPlatformOptions } from "../core/shell";
import type { LoadResult, NativeLoader, PtyModule } from "./native-loader";

/**
 * Verpackt node-pty für den SessionManager. Das Modul kommt erst nach loader.load(),
 * deshalb zuerst prepare(), dann create() (wirft ohne geladenes Modul).
 */
export class NodePtyFactory {
  private readonly loader: NativeLoader;
  private readonly platform: Platform | null;
  private pty: PtyModule | null = null;

  constructor(loader: NativeLoader, platform: Platform | null) {
    this.loader = loader;
    this.platform = platform;
  }

  async prepare(): Promise<LoadResult> {
    const result = await this.loader.load();
    if (result.ok) this.pty = result.pty;
    return result;
  }

  create(spec: SessionSpec): PtyLike {
    if (!this.pty) throw new Error("node-pty ist noch nicht geladen.");
    return this.pty.spawn(spec.file, spec.args, {
      name: spec.env.TERM,
      cols: spec.cols,
      rows: spec.rows,
      cwd: spec.cwd,
      env: spec.env,
      ...ptyPlatformOptions(this.platform),
    });
  }
}
