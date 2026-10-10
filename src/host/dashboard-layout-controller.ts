import type { CockpitFeed, CockpitFeedActions } from "../core/cockpit-feed";
import { type CockpitInputs, type PanelId, panelValues, zoomTargets } from "../core/cockpit-panels";
import type { CockpitCrop, CockpitSettings, DashboardLayout } from "../core/settings";
import { type CockpitLayout, createCockpitLayout } from "./cockpit-layout";

/**
 * Umschalt- und Lebenszyklus-Logik der Dashboard-View (Abend 15) ohne Obsidian-Import, damit sie mit einem
 * DOM getestet werden kann: Liste <-> Cockpit, Karten zwischen Liste, Regal und Zoom, Reload beim Wechsel,
 * Abos der Instrumente, Aufräumen. Die Karten und ihre Lader gehören der View, hier wandern nur Elemente.
 */
export interface LayoutControllerDeps {
  /** Wurzel der View (contentEl); Kopf und Karten stehen dort in Listenreihenfolge. */
  root: HTMLElement;
  doc: Document;
  head: HTMLElement;
  /** Briefing, Usage, Aufgaben, Skills, Research (die Skill-Karte steht in der Liste und im Regal, kein Panel zoomt mehr auf sie). */
  cards: HTMLElement[];
  backgroundUrl: string;
  /** Gewählte Ansicht, bei jeder Nutzung frisch gelesen. */
  layout: () => DashboardLayout;
  /** Gewählter Ausschnitt der Cockpit-Ansicht (zugeschnitten oder voll), bei jeder Nutzung frisch gelesen. */
  crop: () => CockpitCrop;
  /** Meldet jede Änderung der Einstellungen; der Rückgabewert meldet ab. */
  onSettingsChange: (cb: () => void) => () => void;
  /** Quellen der Instrumente: Stände der Karten, Briefing, Pull, Sitzungen und Feed. Jede meldet Änderungen. */
  sources: Array<(cb: () => void) => () => void>;
  inputs: () => CockpitInputs;
  clock: (ms: number) => string;
  isExpanded: () => boolean;
  /** Klappt das Briefing auf oder zu, ohne den Zustand zu speichern (nur der Zoom ruft das). */
  setExpanded: (expanded: boolean) => void;
  /** Feed der neuen Flächen (Abend 18), bei jedem Zeichnen frisch; ohne ihn zeichnet nur der alte Teil. */
  feed?: () => CockpitFeed;
  /** Klicks und Tasten der neuen Flächen (focusSession, openNote, startLint, setEffort, toggleTelegram, openBriefing). */
  actions?: CockpitFeedActions;
  /** Schwellen und Pfade für die neuen Flächen; ohne sie zeichnet nur der alte Teil. */
  settings?: () => CockpitSettings;
  /** Uhr für Alter und „heute“ (Vorgabe Date.now). */
  now?: () => number;
}

export class DashboardLayoutController {
  private readonly deps: LayoutControllerDeps;
  private layout: CockpitLayout | null = null;
  private offs: Array<() => void> = [];
  /** Hat der Zoom das Briefing aufgeklappt, steht hier, dass es beim Schließen wieder zugeklappt wird. */
  private collapseAfterZoom = false;

  constructor(deps: LayoutControllerDeps) {
    this.deps = deps;
  }

  start(): void {
    const d = this.deps;
    this.offs.push(d.onSettingsChange(() => {
      this.apply();
      // Der Ausschnitt wirkt sofort auf die offene Bühne; nichts wird neu gebaut oder geladen. Das Briefing-Instrument zeigt nur das Datum aus
      // dem Stand der Karte, der immer geladen ist: Ein Wechsel der Ansicht braucht kein Neuladen.
      this.layout?.setCrop(d.crop());
      this.refresh();
    }));
    for (const source of d.sources) this.offs.push(source(() => this.refresh()));
    this.apply();
  }

  /** Stellt die Ansicht passend zur Einstellung her; true, wenn sie gewechselt hat. */
  apply(): boolean {
    const d = this.deps;
    const wantCockpit = d.layout() === "cockpit";
    if (wantCockpit === (this.layout !== null)) return false;
    if (this.layout) {
      // destroy schließt einen offenen Zoom (stellt das Briefing zurück) und gibt die Karten ins Regal, das mit
      // der Bühne verschwindet; danach wandern sie in die Liste.
      this.layout.destroy();
      this.layout = null;
    }
    d.root.classList.toggle("cockpit-dashboard-cockpit", wantCockpit);
    if (!wantCockpit) {
      d.root.append(d.head, ...d.cards);
      return true;
    }
    const layout = createCockpitLayout({
      doc: d.doc,
      backgroundUrl: d.backgroundUrl,
      cards: { pull: d.head, briefing: d.cards[0], usage: d.cards[1], tasks: d.cards[2], skills: d.cards[3], research: d.cards[4] },
      crop: d.crop(),
      actions: d.actions,
      onZoom: (panel) => {
        // Das Briefing zeigt im Zoom seinen Text: aufklappen, und danach genau so zurücklassen, wie es war.
        if (zoomTargets(panel).includes("briefing") && !d.isExpanded()) {
          this.collapseAfterZoom = true;
          d.setExpanded(true);
        }
      },
      onZoomClose: () => {
        if (!this.collapseAfterZoom) return;
        this.collapseAfterZoom = false;
        d.setExpanded(false);
      },
    });
    this.layout = layout;
    d.root.append(layout.el);
    this.refresh();
    return true;
  }

  /** Zeichnet die Instrumente aus den Ständen neu; ohne Cockpit-Ansicht nichts zu tun. */
  refresh(): void {
    if (!this.layout) return;
    this.layout.update(panelValues(this.deps.inputs(), this.deps.clock));
    const { feed, settings, now } = this.deps;
    if (feed && settings) this.layout.updateFeed(feed(), settings(), (now ?? Date.now)());
  }

  /** Öffnet den Zoom dieser Fläche; in der Listenansicht gibt es ihn nicht (false, der Aufrufer klappt die Karte auf). */
  zoomPanel(id: PanelId): boolean {
    if (!this.layout) return false;
    this.layout.zoom(id);
    return true;
  }

  /** Meldet alle Abos ab, schließt den Zoom und entfernt die Bühne; die Karten gehen in die Liste zurück. */
  destroy(): void {
    for (const off of this.offs) off();
    this.offs = [];
    if (this.layout) {
      this.layout.destroy();
      this.layout = null;
      this.deps.root.classList.remove("cockpit-dashboard-cockpit");
      this.deps.root.append(this.deps.head, ...this.deps.cards);
    }
  }
}
