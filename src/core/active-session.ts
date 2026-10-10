/** Zuletzt aktive Terminal-Sitzungen, jüngste zuerst. Das aktive Leaf wechselt auch beim Klick ins Dashboard, die Liste nicht. */
export class RecentSessions {
  private ids: string[] = [];

  touch(id: string): void {
    this.forget(id);
    this.ids.unshift(id);
  }

  /** Nach dem Start (Abend 19g): unbekannte Sitzungen hinten anhängen, in der gegebenen Reihenfolge; bekannte bleiben, wo sie sind. */
  seed(ids: readonly string[]): void {
    for (const id of ids) if (!this.ids.includes(id)) this.ids.push(id);
  }

  forget(id: string): void {
    this.ids = this.ids.filter((i) => i !== id);
  }

  /** Die jüngste Sitzung, die noch offen ist. */
  current(isOpen: (id: string) => boolean): string | null {
    return this.ids.find(isOpen) ?? null;
  }

  /** Alle noch offenen Sitzungen, jüngste zuerst. */
  open(isOpen: (id: string) => boolean): string[] {
    return this.ids.filter(isOpen);
  }
}
