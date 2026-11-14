# 🛒 Einkaufsliste

Einkaufslisten-App für **Handy und Computer**, gebaut als Progressive Web App
(PWA). Sie läuft im Browser, lässt sich auf dem Handy wie eine normale App auf
den Startbildschirm legen und funktioniert auch **offline**.

👉 **App öffnen:** <https://yugito-11.github.io/einkaufsliste/>
(sobald GitHub Pages eingeschaltet ist, siehe unten)

## Funktionen

- **Artikel mit Anzahl und Geschäft** gleich beim Eintragen
  (`3 Joghurt` oder `Eier x6` setzt die Anzahl automatisch)
- **Nach Geschäft sortiert** (Hofer, Billa, Spar …), mit Filter oben, damit
  du im Geschäft nur siehst, was du dort brauchst
- **Preise pro Geschäft** beim Artikel eintragen (✎). Die App zeigt den
  günstigsten Preis an, rechnet die ungefähre Summe aus und gibt einen
  Hinweis 💡, wenn es woanders billiger ist
- **Mehrere Listen**, z.B. „Grillfeier“ oder „Weihnachten“ (Tippen auf den
  Listennamen oben)
- **Notiz** pro Artikel (Bio, 500 g, Marke …)
- Geschäfte selbst verwalten und sortieren (⚙︎)
- Vorschläge aus früheren Einkäufen; das zuletzt gewählte Geschäft wird
  automatisch vorgeschlagen
- Löschen mit „Rückgängig“, Hell- und Dunkelmodus
- **Geräte verbinden**: Handy, Computer und Familie sehen dieselben Listen

## Auf dem Handy installieren

1. Die App-Adresse oben im Browser öffnen.
2. **Android (Chrome):** Menü ⋮ → „App installieren“
3. **iPhone (Safari):** Teilen-Symbol → „Zum Home-Bildschirm“

## GitHub Pages einschalten (einmalig)

Repository → **Settings → Pages** → Source: „Deploy from a branch“,
Branch `main`, Ordner `/ (root)` → **Save**. Nach 1–2 Minuten ist die App
unter <https://yugito-11.github.io/einkaufsliste/> erreichbar.

## Geräte verbinden (einmalig einrichten)

Damit Handy und Computer dieselben Listen sehen, braucht die App einen
kleinen Online-Speicher. Dafür wird **Firebase** von Google verwendet, das für
diesen Zweck kostenlos ist.

1. Auf <https://console.firebase.google.com> mit einem Google-Konto anmelden
   → **Projekt erstellen** (Name z.B. `einkaufsliste`, Google Analytics kann
   aus bleiben).
2. **Build → Authentication → Jetzt starten → Anmeldemethode „Anonym“**
   aktivieren.
3. **Build → Firestore Database → Datenbank erstellen**: Standort
   `europe-west3 (Frankfurt)`, im **Produktionsmodus** starten.
4. Im Firestore-Tab **Regeln** diesen Text einfügen und **Veröffentlichen**:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /haushalte/{code} {
         allow read, write: if request.auth != null && code.size() >= 16;
       }
     }
   }
   ```

5. **Projekteinstellungen (Zahnrad) → Allgemein → Meine Apps → Web-App
   hinzufügen (`</>`)**. Den angezeigten `firebaseConfig`-Block in
   [`firebase-config.js`](firebase-config.js) eintragen. Diese Werte sind
   nicht geheim und dürfen öffentlich im Repository stehen.
6. **Authentication → Einstellungen → Autorisierte Domains →**
   `yugito-11.github.io` hinzufügen.

Danach in der App: **⚙︎ → Neue Verbindung erstellen → Link teilen**, und den
Link auf dem anderen Gerät öffnen. Wer den Link hat, kann die Listen sehen und
bearbeiten, also nur an Personen weitergeben, die mitschreiben sollen.

## Lokal starten

```bash
python3 -m http.server 8000
```

Dann <http://localhost:8000> öffnen.

## Dateien

| Datei | Zweck |
| --- | --- |
| `index.html` | Grundgerüst der Seite |
| `style.css` | Aussehen |
| `app.js` | Listen, Artikel, Preise, Geschäfte |
| `sync.js` | Abgleich zwischen Geräten (Firebase) |
| `firebase-config.js` | Zugangsdaten für den Abgleich |
| `manifest.webmanifest` | Macht die Seite installierbar |
| `sw.js` | Service Worker für den Offline-Betrieb |
| `icons/` | App-Icons |

> Hinweis: Nach Änderungen an den Dateien in `sw.js` die Cache-Version
> (`einkaufsliste-v2`) erhöhen, damit installierte Apps das Update laden.
