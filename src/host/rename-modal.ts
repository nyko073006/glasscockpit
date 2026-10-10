import { type App, Modal } from "obsidian";
import { CSS_PREFIX, SESSION_NAME_MAX } from "../core/constants";
import type { Change } from "../core/session-model";

/** „Sitzung umbenennen“: Textfeld mit dem aktuellen Namen. Ablehnung steht rot unter dem Feld, das Modal bleibt offen. */
export class RenameModal extends Modal {
  private readonly current: string;
  private readonly rename: (name: string) => Change;

  constructor(app: App, current: string, rename: (name: string) => Change) {
    super(app);
    this.current = current;
    this.rename = rename;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.setTitle("Sitzung umbenennen");
    const input = contentEl.createEl("input", {
      type: "text",
      cls: `${CSS_PREFIX}rename-input`,
      attr: { maxlength: String(SESSION_NAME_MAX + 10) },
    });
    input.value = this.current;
    const error = contentEl.createDiv({ cls: `${CSS_PREFIX}rename-error` });

    const submit = (): void => {
      const result = this.rename(input.value);
      if (result.ok) {
        this.close();
        return;
      }
      error.setText(result.reason);
      input.focus();
    };
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.isComposing) {
        event.preventDefault();
        submit();
      }
    });
    const buttons = contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Umbenennen", cls: "mod-cta" }).addEventListener("click", submit);
    buttons.createEl("button", { text: "Abbrechen" }).addEventListener("click", () => this.close());

    input.focus();
    input.select();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
