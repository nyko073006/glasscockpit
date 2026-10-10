#!/usr/bin/env python3
"""Misst die neuen Flächen (Abend 18, ab Abend 19b mit Repos, Radaren und dem Effort-Bildschirm) am Bild assets/cockpit-bg.jpg und schreibt die Zahlen für src/core/cockpit-panels.ts.

Aufruf: python3 scripts/measure-fields.py [Bild]   (braucht numpy und opencv-python)

Verfahren wie bei Abend 15: Eine Fläche ist die Zusammenhangskomponente der dunklen Pixel (Grauwert unter 110, etwa die halbe
Linienhelligkeit) um einen Startpunkt innerhalb der gezeichneten Kontur. Form "gray": Der Bildschirm ist grau gemalt (Grauwert
30 bis 110) und nicht dunkel; sonst gleich. Das Polygon ist die vereinfachte Kontur dieser Fläche (approxPolyDP, kleinste Toleranz,
die in die Punktgrenze passt); die Deckung ist Schnitt durch Vereinigung von Polygon und Fläche. Das Textrechteck ist das größte
achsenparallele Rechteck im um 4 px verkleinerten Polygon. Rundinstrumente: Kreis aus der Fläche (Mitte = Schwerpunkt, Radius aus dem
Flächeninhalt), Polygon aus 48 Punkten.
"""
import json, math, sys
import cv2
import numpy as np

BILD = sys.argv[1] if len(sys.argv) > 1 else "assets/cockpit-bg.jpg"
SCHWELLE = 110
UNTEN = 30  # Form "gray": Grauwerte ab hier gehören zur Fläche (der gemalte Bildschirm hat etwa 51)
RAND = 4  # px Abstand des Textrechtecks zur Kontur

# id, Startpunkt (x, y) im Bild, optionale Kappung (Zeilen unter diesem y sind Sperre), maximale Punktzahl, Form
ZIELE = [
    ("radar", (765, 800), None, 8, "polygon"),
    ("focus", (640, 1100), None, 12, "polygon"),
    ("gaugeLeft", (350, 1321), None, 48, "circle"),
    ("gaugeRight", (1185, 1321), None, 48, "circle"),
    ("vault", (770, 1400), 1488, 8, "polygon"),
    # Konsole unter dem System-Display, rechts neben dem Vault-Display (19b): die breite Tafel links (repos) und der schmale Streifen
    # rechts davon (radars), getrennt durch die dünne Linie bei x 1047 bis 1059; beide unten bei y 1580 gekappt (Unterkante des Ausschnitts: 1585)
    ("repos", (975, 1450), 1580, 8, "polygon"),
    ("radars", (1100, 1450), 1580, 8, "polygon"),
    # Effort (19b): der graue Bildschirm links, der bis dahin den Skills-Schirm trug
    ("effort", (510, 1185), None, 4, "gray"),
    ("telegram", (267, 1530), None, 8, "polygon"),
    ("sound", (337, 1462), None, 8, "polygon"),
    ("loc", (1178, 1170), None, 8, "polygon"),
    ("commits", (1181, 1240), None, 8, "polygon"),
    # Knauf des Schalthebels (a18e): dunkle Innenfläche des Kopfes, unten bei y 1580 gekappt (darunter der schmale Schaft)
    ("newSession", (755, 1540), 1580, 20, "polygon"),
]
MAX_ZEILENHOEHE = {}  # Name -> höchste Textzeilenhöhe in px (nur die untersten Zeilen der Fläche zählen); leer, seit der Fokus die Tafel füllt
FUELLEN = {"focus"}  # Löcher füllen: die in die Tafel gezeichneten Tastenkästen sind eigene Komponenten und werden überdeckt


def maske(g, start, kappe, grau=False):
    dunkel = ((g < SCHWELLE) & ((g >= UNTEN) if grau else True)).astype(np.uint8)
    if kappe:
        dunkel[kappe + 1:] = 0
    _, lab = cv2.connectedComponents(dunkel, connectivity=4)
    return (lab == lab[start[1], start[0]]).astype(np.uint8)


def groesstes_rechteck(m):
    """Größtes achsenparalleles Rechteck aus Einsen (Histogramm-Verfahren), (x, y, b, h)."""
    h, w = m.shape
    hoehen = [0] * w
    beste = (0, 0, 0, 0)
    best_a = 0
    for y in range(h):
        row = m[y]
        for x in range(w):
            hoehen[x] = hoehen[x] + 1 if row[x] else 0
        stack = []
        for x in range(w + 1):
            cur = hoehen[x] if x < w else 0
            start = x
            while stack and stack[-1][1] >= cur:
                s, hh = stack.pop()
                a = hh * (x - s)
                if a > best_a:
                    best_a, beste = a, (s, y - hh + 1, x - s, hh)
                start = s
            stack.append((start, cur))
    return beste


def iou(a, b):
    i = int(np.logical_and(a, b).sum())
    u = int(np.logical_or(a, b).sum())
    return i / u if u else 0.0


SS = 4  # Überabtastung für Deckung und Textrechteck
N = 48  # Ecken des Kreis-Polygons (32 Ecken erreichen selbst bei exakter Passung nur etwa 98 %)


def poly_maske(pts, shape):
    """Pixel, deren Mitte im Polygon liegt (gerade-ungerade-Regel, Bildkoordinaten = Pixelecken); wie der Test in cockpit-panels.test.ts."""
    ys, xs = np.mgrid[0:shape[0], 0:shape[1]]
    px_, py_ = xs + 0.5, ys + 0.5
    inn = np.zeros(shape, bool)
    n = len(pts)
    j = n - 1
    for i in range(n):
        xi, yi = pts[i]
        xj, yj = pts[j]
        if yi != yj:
            kreuz = ((yi > py_) != (yj > py_)) & (px_ < (xj - xi) * (py_ - yi) / (yj - yi) + xi)
            inn ^= kreuz
        j = i
    return inn.astype(np.uint8)


def vereinfachen(kontur, max_punkte):
    """Kontur auf dem SS-fachen Raster (Bildkoordinaten = Rasterwert / SS), kleinste Toleranz mit höchstens max_punkte Ecken."""
    umfang = cv2.arcLength(kontur, True)
    eps = 0.5 * SS
    while eps < umfang:
        ap = cv2.approxPolyDP(kontur, eps, True)
        if len(ap) <= max_punkte:
            return (ap[:, 0, :].astype(float) + 0.5) / SS
        eps += 0.25 * SS
    raise SystemExit("keine Vereinfachung")


def main():
    g = cv2.imread(BILD, cv2.IMREAD_GRAYSCALE)
    if g is None or g.shape != (1942, 1536):
        raise SystemExit(f"Bild {BILD} fehlt oder hat nicht 1536x1942")
    ergebnis = []
    for name, start, kappe, maxp, form in ZIELE:
        ref_m = maske(g, start, kappe, form == "gray")
        if name in FUELLEN:  # Löcher füllen wie bei der hull-Logik: äußere Kontur ausmalen, Kästen darin gehören zur Fläche
            kont0, _ = cv2.findContours(ref_m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
            ref_m = np.zeros_like(ref_m)
            cv2.fillPoly(ref_m, [max(kont0, key=cv2.contourArea)], 1)
        fein = cv2.resize(ref_m, (ref_m.shape[1] * SS, ref_m.shape[0] * SS), interpolation=cv2.INTER_NEAREST)
        kont, _ = cv2.findContours(fein, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        kontur = max(kont, key=cv2.contourArea)
        ys, xs = np.nonzero(ref_m)
        bx, by, bw, bh = int(xs.min()), int(ys.min()), int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1)
        if form == "circle":
            cx = float(xs.mean()) + 0.5
            cy = float(ys.mean()) + 0.5
            # Umkreisradius des 32-Ecks mit gleicher Fläche wie die gemessene Fläche (sonst liegt das Eck innen)
            r = math.sqrt(ref_m.sum() / math.pi) * math.sqrt(2 * math.pi / (N * math.sin(2 * math.pi / N)))
            pts = [(cx + r * math.cos(2 * math.pi * k / N), cy + r * math.sin(2 * math.pi * k / N)) for k in range(N)]
            bx, by, bw, bh = cx - r, cy - r, 2 * r, 2 * r
        else:
            pts = vereinfachen(kontur, maxp)
            bx, by = float(pts[:, 0].min()), float(pts[:, 1].min())
            bw, bh = float(pts[:, 0].max() - bx), float(pts[:, 1].max() - by)
        pm = poly_maske(pts, ref_m.shape)
        deckung = iou(pm, ref_m)
        # Textrechteck im verkleinerten Polygon, Koordinaten relativ zur Umrandung
        # Rechteck-Suche auf dem 1-px-Raster: Pixel, deren ganzes Quadrat samt Rand im Polygon liegt
        innen = cv2.erode(pm, np.ones((2 * RAND + 1, 2 * RAND + 1), np.uint8))
        x0, y0 = int(math.floor(bx)), int(math.floor(by))
        sub = innen[y0:int(math.ceil(by + bh)) + 1, x0:int(math.ceil(bx + bw)) + 1]
        if name in MAX_ZEILENHOEHE:  # nur die unteren Zeilen: breiteste Textzeile statt größter Fläche
            sub = sub.copy()
            sub[: max(0, sub.shape[0] - MAX_ZEILENHOEHE[name])] = 0
        rx, ry, rw, rh = groesstes_rechteck(sub)
        bx_, by_ = bx - x0, by - y0
        rx, ry = rx - bx_, ry - by_
        rel = lambda v, o, n: round((v - o) / n * 100, 2)
        poly_rel = [[round((x - bx) / bw * 100, 2), round((y - by) / bh * 100, 2)] for x, y in pts]
        ergebnis.append({
            "id": name,
            "px": [round(bx, 1), round(by, 1), round(bw, 1), round(bh, 1)],
            "polygon": poly_rel,
            "content": [round(rx / bw * 100, 2), round(ry / bh * 100, 2), round(rw / bw * 100, 2), round(rh / bh * 100, 2)],
            "content_px": [round(bx + rx, 1), round(by + ry, 1), rw, rh],
            "deckung": round(deckung, 4),
            "flaeche_px": int(ref_m.sum()),
            **({"kreis_mitte": [round(cx, 1), round(cy, 1)], "radius": round(r, 1)} if form == "circle" else {}),
        })
    print(json.dumps(ergebnis, indent=1))


main()
