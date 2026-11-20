# AutoDev Studio – Phase 1

Eigenständiger Electron-/React-/TypeScript-Desktop-Client für den bestehenden AutoDev Core. Das Quellrepository von LaceFrame wird **nicht** modifiziert.

## Start

Voraussetzungen: Node.js >= 22, npm, Electron-geeignete Desktopumgebung (unter Linux passende Systembibliotheken).

```bash
npm install
npm start
```

In der Anwendung **Projekt hinzufügen** auswählen und den Ordner `~/Projekte/laceframe` öffnen. Der Ordner braucht `src/autodev/cli.ts` und lokal `node_modules/.bin/tsx` (`npm install` im Projekt).

## Bereits enthalten

- Projektregistry in Electron `app.getPath('userData')`, unabhängig vom Git-Repo
- Projektordner-Dialog und Validierung der AutoDev-CLI
- `status` und `run --dry-run` mit Live-stdout/stderr und Exit-Code
- Maximal ein aktiver Prozess, Stop per SIGTERM, Fallback SIGKILL für Prozessgruppe
- Electron security: context isolation, sandbox, no Node integration, minimal preload APIs
- Kein `--execute`, kein Issue-Retry, keine automatischen Git-Befehle oder GitHub-Mutationen

## Phase 2 – vor produktiven Runs

- Core in eigenständiges CLI-/Core-Paket mit explizitem `--project-dir` extrahieren (kein Quellcode-Duplikat)
- Git- und Dateisystemoperationen an Projekt-CWD binden; Prozess-ID/Session dauerhaft speichern
- Persistente Logs und auditierbare Phasen-/Review-Ereignisse, sichere Wiederaufnahme, Passwort-/Token-Redaction
- Kontrollierte Execute-Freigabe mit explizitem Bestätigungsdialog und unabhängiger Review-Gate
- CI-/Platform-Tests und Packaging Linux/Windows/macOS

## Hinweis

`status` ist ein echter CLI-Aufruf und kann lokale Zustandsdateien lesen. `run --dry-run` startet den AutoDev-Dry-Run des ausgewählten Projekts. Alle Befehle laufen mit den Rechten des angemeldeten Users; nur vertrauenswürdige Projektordner auswählen.
