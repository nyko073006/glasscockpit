/** Fenster eines Containers (auch ein Popout-Fenster) samt den Konstruktoren und Obsidian-Helfern, die das Plugin dort braucht.
 *  Ersetzt den Schnitt aus `Window` und dem Typ des globalen Objekts (Portal-Regel no-global-this).
 *  `createFragment` legt Obsidian am Fenster an (die Typen kennen nur die globale Funktion), das Fragment gehört dem Dokument dieses Fensters. */
export type PopoutWindow = Window & {
  ResizeObserver: typeof ResizeObserver;
  createFragment: typeof createFragment;
};
