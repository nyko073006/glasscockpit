/**
 * Läuft die Suite unter Windows? Tests, die eine POSIX-Shell, jq, python3, POSIX-Dateimodi, Symlinks oder macOS-Werkzeuge
 * (ditto, unzip, zip, xattr, cp -Rp) brauchen, werden damit an der kleinsten Einheit übersprungen (Abend 40, Task 5).
 * Auf dem Mac ist der Wert falsch, dort läuft alles wie vorher.
 */
export const ON_WINDOWS = process.platform === "win32";
