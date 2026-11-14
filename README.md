# 🛒 Einkaufsliste

Eine einfache Einkaufslisten-App für **Handy und Computer**, gebaut als
Progressive Web App (PWA). Sie läuft direkt im Browser, lässt sich auf dem
Handy wie eine normale App auf den Startbildschirm legen und funktioniert
auch **offline**.

## Funktionen

- Artikel hinzufügen, mit Menge: `2 Milch`, `500g Mehl`, `Eier x6`
- Antippen zum Abhaken; erledigte Artikel wandern nach unten
- Lange drücken (Handy) oder Rechtsklick (PC) zum Bearbeiten
- Löschen mit „Rückgängig“
- Vorschläge aus früheren Einkäufen
- Hell- und Dunkelmodus (folgt der Systemeinstellung)
- Daten bleiben lokal auf dem Gerät gespeichert

## Auf dem Handy installieren

1. Die veröffentlichte Seite im Browser öffnen (siehe unten).
2. **Android (Chrome):** Menü ⋮ → „App installieren“ bzw. „Zum Startbildschirm hinzufügen“
3. **iPhone (Safari):** Teilen-Symbol → „Zum Home-Bildschirm“

## Veröffentlichen mit GitHub Pages

Repository → **Settings → Pages** → Source: „Deploy from a branch“,
Branch `main`, Ordner `/ (root)` → Speichern. Die App ist danach unter
`https://<benutzername>.github.io/einkaufsliste/` erreichbar.

## Lokal starten

Ein beliebiger statischer Webserver reicht, z.B.:

```bash
python3 -m http.server 8000
```

Dann <http://localhost:8000> öffnen.

## Dateien

| Datei | Zweck |
| --- | --- |
| `index.html` | Grundgerüst der Seite |
| `style.css` | Aussehen |
| `app.js` | Logik der Liste |
| `manifest.webmanifest` | Macht die Seite installierbar |
| `sw.js` | Service Worker für den Offline-Betrieb |
| `icons/` | App-Icons |

> Hinweis: Nach Änderungen an den Dateien in `sw.js` die Cache-Version
> (`einkaufsliste-v1`) erhöhen, damit installierte Apps das Update laden.
