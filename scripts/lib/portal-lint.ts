// Portal-Linter (Scorecard im Obsidian-Portal): eslint-plugin-obsidianmd 0.4.2 recommended. Das Portal zeigt sentence-case nicht,
// deshalb zählt es hier nicht als Warnung (Abgleich mit der Portal-Scorecard, 13.10.2026).
export interface EslintMessage { ruleId: string | null; severity: 1 | 2; line: number; message: string }
export interface EslintFileResult { filePath: string; messages: EslintMessage[] }
export interface LintSummary { errors: number; warnings: number; byRule: Record<string, number>; errorLines: string[] }

export const IGNORED_RULES = ["obsidianmd/ui/sentence-case"];
export const LINT_PACKAGES = [
  "typescript@6.0.3", "eslint@9.39.5", "eslint-plugin-obsidianmd@0.4.2",
  "typescript-eslint@8.71.2", "@eslint/js@9.39.5", "@eslint/json@0.14.0",
];
export const ESLINT_CONFIG = `import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  ...obsidianmd.configs.recommended,
  { languageOptions: { parserOptions: { projectService: { allowDefaultProject: ["eslint.config.*"] } } } },
]);
`;

export function summarize(results: EslintFileResult[]): LintSummary {
  const s: LintSummary = { errors: 0, warnings: 0, byRule: {}, errorLines: [] };
  for (const f of results) {
    const rel = f.filePath.slice(f.filePath.lastIndexOf("/src/") + 1);
    for (const m of f.messages) {
      if (m.severity === 2) {
        s.errors++;
        s.errorLines.push(`${rel}:${m.line} ${m.ruleId ?? "(Parser)"} ${m.message}`);
      } else if (m.ruleId !== null && IGNORED_RULES.includes(m.ruleId)) {
        continue;
      } else {
        s.warnings++;
      }
      const rule = m.ruleId ?? "(Parser)";
      s.byRule[rule] = (s.byRule[rule] ?? 0) + 1;
    }
  }
  return s;
}

export function verdict(s: LintSummary): 0 | 1 {
  return s.errors > 0 ? 1 : 0;
}
