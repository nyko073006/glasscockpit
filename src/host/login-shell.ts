import { spawn } from "child_process";
import { LANG_MARK_END, LANG_MARK_START, loginShellScript, parseMarked, parseMarkedPath } from "../core/login-path";

export type LoginShellResult = { ok: true; dirs: string[]; lang: string | null } | { ok: false; reason: string };

/**
 * `$SHELL -i -l -c` gibt PATH und LANG zwischen Markern aus. stdin zu, stderr verworfen,
 * nach timeoutMs abgebrochen. Wirft nie, Fehler kommen als ok: false.
 */
export function readLoginShell(shell: string, timeoutMs: number): Promise<LoginShellResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let done = false;
    const finish = (result: LoginShellResult) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(result);
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(shell, ["-i", "-l", "-c", loginShellScript()], { stdio: ["ignore", "pipe", "ignore"] });
    } catch (fehler) {
      resolve({ ok: false, reason: fehler instanceof Error ? fehler.message : String(fehler) });
      return;
    }
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ ok: false, reason: `Timeout nach ${timeoutMs / 1000} s` });
    }, timeoutMs);

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => (stdout += chunk));
    child.on("error", (fehler) => finish({ ok: false, reason: fehler.message }));
    child.on("close", () => {
      const dirs = parseMarkedPath(stdout);
      if (dirs === null) {
        finish({ ok: false, reason: "keine Marker in der Ausgabe" });
        return;
      }
      finish({ ok: true, dirs, lang: parseMarked(stdout, LANG_MARK_START, LANG_MARK_END) || null });
    });
  });
}
