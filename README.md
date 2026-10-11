# Glasscockpit

English | [Deutsch](README.de.md)

![Cockpit view with example data](docs/images/cockpit.png)

Glasscockpit is an Obsidian plugin that runs [Claude Code](https://code.claude.com) sessions as terminal tabs inside your vault. A dashboard shows usage limits, context size, tasks, vault status and GitHub search results, either as cards or as a cockpit picture. The photo above uses example data.

The plugin's settings and labels are in German. There is no English interface yet.

## Requirements

- macOS on Apple Silicon. Intel Macs are untested.
- Obsidian 1.13 or newer (desktop only).
- The Claude Code CLI (`claude`), installed and logged in.
- `jq`, for the status line (optional, see "First steps").

## Installation

**Option A: without the ZIP (BRAT, or the community store once the plugin is listed).**

1. Install the plugin with BRAT (repository `nyko073006/glasscockpit`) or from the community plugins list. Both fetch `main.js`, `manifest.json` and `styles.css` only.
2. Enable Glasscockpit under Settings, Community plugins.
3. Open Settings, Glasscockpit, section "Binärdateien", and press "Binärdateien laden". The plugin downloads the terminal library `node-pty` for your Mac once and checks it (see "Network" below). Then start a session.

**Option B: the complete ZIP.**

1. Download the ZIP from the GitHub release: [https://github.com/nyko073006/glasscockpit/releases/latest](https://github.com/nyko073006/glasscockpit/releases/latest)
2. Unzip it. You get a folder `glasscockpit` with `main.js`, `manifest.json`, `styles.css` and `native/`.
3. Move the folder to `<your vault>/.obsidian/plugins/`.
4. In Obsidian, open Settings, Community plugins, and enable Glasscockpit.

The plugin is not in the community store yet. `native/` holds the terminal library `node-pty` as a compiled binary (Option B ships it, Option A downloads it). On first start the plugin removes the macOS quarantine flag from that folder (`xattr`).

## First steps

Open the command palette and run "Neue Claude-Sitzung" (new Claude session) or "Dashboard öffnen" (open dashboard). Settings are under Settings, Glasscockpit.

Most vault-related settings start empty. Empty means "not set up", never an error. The matching card or field then shows "aus" or "nicht eingerichtet" and the plugin reads nothing for it:

| Setting | Empty means |
|---|---|
| Projektordner | "Neue Sitzung" offers no project subfolders. |
| Briefing-Ordner | No briefing card, no automatic `git pull`. |
| Aufgabenliste | The task card shows "fehlt" with a button to create the file. The default name is `Cockpit Tasks.md`. |
| Inbox-Ordner, Index-Datei, Ordner der Daily Notes | The vault panel shows "aus" for that line. |
| Lint-Befehl | No lint button. |
| Radare | No radar lamps. A radar is a name plus the path to a JSON state file you write yourself. |

Telegram, the research searches and the other switches have their own defaults, listed under "Disclosures".

### Status line

Claude Code can show a status line. This repo ships one that also feeds the usage card, the token counter and the context gauge. It needs `jq`.

```sh
npm run deploy:statusline
```

This copies `statusline/statusline-command.sh` to `~/.claude/statusline-command.sh`. It replaces a file that already exists there. Then point Claude Code at it in `~/.claude/settings.json`:

```json
{ "statusLine": { "type": "command", "command": "~/.claude/statusline-command.sh", "refreshInterval": 30 } }
```

Without the status line the plugin works, but the usage card and the context and token gauges stay empty.

## Handoffs

The plugin can continue a project from the handoff note of an earlier session. It is off until you set two paths.

| Setting | Meaning |
|---|---|
| `hubsDir` | Vault folder with one subfolder per project. Empty = off. |
| `handoffsDir` | Folder name inside each project folder that holds its handoff notes. Empty = off. |
| `hubSuffix` | Ending of the project's hub note. Default `" - PMO HUB.md"`. |
| `handoffPrompt` | First message of a continued session. `{datei}` becomes the handoff path, `{auftrag}` the next task. |

A handoff is a Markdown note with this frontmatter:

```yaml
status: offen            # offen = waiting, aufgenommen = taken up
erstellt: 2026-01-05
naechster_auftrag: Short description of the next task
```

The hub note may name the project's repo folder with `repo: ~/path/to/repo`. `~` is your home folder. Without `repo`, or if the folder does not exist, the session starts in the vault and the entry says so.

Per project the newest open handoff counts. The field "Neue Sitzung" on the dashboard shows "N offen". The new-session menu lists each one as "Weiter" above the normal entries, and Enter without typing picks the top entry. The plugin sets `status: aufgenommen` (and `aufgenommen: <date>`) only once the session is running, so a failed start leaves the handoff open.

## Skip permission prompts

The switch "Rechteabfragen überspringen" is off by default.

**Warning:** when it is on, new sessions start with `--dangerously-skip-permissions`. Claude then runs commands and edits files without asking you. Turn it on only in folders and vaults where you accept that.

The switch applies to sessions started after you change it. Running sessions keep their mode.

## Disclosures

This follows the disclosure rules of the Obsidian developer policies.

**Runs programs.**
- `claude` in a terminal session, and your `$SHELL` for shell sessions. On load the plugin starts your login shell once (`$SHELL -i -l -c`) to read `PATH` and `LANG`.
- `git pull --ff-only` in the briefing folder, only if you set one (every 5 minutes by default, while a dashboard is open).
- `git status` in your project folders, for the repo panel. No fetch.
- `afplay` for the alert sound, `xattr` for the quarantine flag, `ps` to find the parent process for the IDE bridge.

**Reads outside the vault.**
- `~/.claude/projects/`: the Claude transcripts, to count tokens, find the last code block and show the active session.
- `~/.claude/skills/`, `agents/`, `commands/`, `settings.json` and `plugins/installed_plugins.json`: to list skills, agents and commands in the launcher. The same folders under the vault and the project folder are read too.
- `~/.claude/cockpit/`: `usage.json` and `sessions/*.json` (written by the status line script), plus the plugin's own files below.
- Telegram only if enabled: the `.env` file named in settings (default `~/.claude/channels/telegram/.env`) for the bot token, and `access.json` next to it for the chat ID. The token is read for each message and never stored by the plugin.
- Radar state files at the paths you enter.

**Writes outside the vault.**
- `~/.claude/cockpit/tokens-today.json` (today's output tokens for the status line; switch "Tokens für die Statuszeile schreiben", on by default), `thresholds.json` (context thresholds from your settings) and `research.json` (cache of GitHub results).
- `~/.claude/ide/<port>.lock`: lock file of the IDE bridge (switch "IDE-Brücke", on by default). It lets Claude sessions started by the plugin see your selection and open notes. The server listens on `127.0.0.1` only. The lock file is removed on exit.
- `npm run deploy:statusline` writes `~/.claude/statusline-command.sh`. You run that yourself.

**Writes inside the vault.** The plugin's `data.json` (settings, session list), the folder `native/darwin-<arch>/` inside the plugin folder when you press "Binärdateien laden" (plus a temporary folder `.native-download-*` there while it runs, removed afterwards), the task file when you press "Anlegen" or tick a task, and the result of `git pull` in the briefing folder.

**Network.**
- GitHub search (`api.github.com/search/repositories`) for the Research card, without a token. It sends your search lines from the settings and nothing else. Without a token GitHub allows 10 searches per minute.
- Telegram (`api.telegram.org`), only if you enable "Telegram, wenn eine Sitzung fertig ist" or "…eine Frage hat" (both off by default). It sends a short status text.
- Binary download, only when you press "Binärdateien laden" in the settings, never automatically: one ZIP (about 40 KB) with the compiled `node-pty` for your Mac from `github.com/nyko073006/glasscockpit/releases/download/<plugin version>/glasscockpit-native-darwin-<arch>.zip`. The plugin sends no data beyond the request itself. The address is fixed in the code. Before anything is installed, every file of the download is compared against a SHA256 list that is built into the plugin (no extra files, no symbolic links, every checksum must match); on any mismatch nothing is changed. The downloaded files are native code that Obsidian then loads, so the checksums are the safeguard: they come from the plugin itself, not from the download.
- Claude Code itself talks to Anthropic. That is the `claude` program, not this plugin.

**No telemetry.** The plugin sends no usage data, no analytics and no crash reports.

**No affiliation.** Glasscockpit is not connected to Anthropic or Obsidian and not endorsed by either. "Claude" and "Obsidian" are trademarks of their respective owners.

## Limits

- macOS only. `native/` holds binaries for Apple Silicon (arm64) and Intel (x64); the loader picks by architecture. The arm64 build is the tested one, x64 is untested inside Obsidian.
- The interface is German.
- Parts of the IDE bridge use an unofficial protocol of Claude Code and may break with an update. Errors only go to the developer console.
- Some behavior can only be checked inside Obsidian. Tests cover the logic, not the whole plugin.

## License

MIT, see [LICENSE](LICENSE). Third-party licenses are in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

The background image `assets/cockpit-bg.jpg` was generated with Google Flow (Nano Banana Pro).
