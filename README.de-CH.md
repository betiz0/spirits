# spirits

[English](README.md) | [日本語](README.ja.md) | [简体中文](README.zh.md) | **Deutsch (Schweiz)**

spirits ist ein Fork von [Pi](https://github.com/earendil-works/pi), der das Ausführungsmodell von Prime Intellects [Prime Agent](https://github.com/PrimeIntellect-ai/prime-agent) in TypeScript/Bun neu umsetzt.

Statt das Modell über eine Schleife einzelner Tool-Aufrufe zu steuern, erhält es bei spirits eine persistente TypeScript-REPL (`tsrepl`) als Hauptschnittstelle: Das Modell schreibt TypeScript-Zellen, behält den Zustand über Zellen hinweg, ruft Host-Funktionen auf und kann Kind-Agenten rekursiv starten. Agenten können zudem ihr eigenes Gedächtnis, ihre Skills und ihren Code-Mode-Prompt über Sitzungen hinweg pflegen (ein "Continual Harness").

> **Status:** Die Meilensteine M1–M4 sind umgesetzt: persistente REPL, Single-Binary-Verteilung, synchrones `rlm` und Continual Harness. M5 (Phase-2-Erweiterungen) wird durch ein dogfooding-basiertes Go/No-Go-Gate entschieden. Releases werden mit `spirits-v*` getaggt; unterstützt wird nur Linux x86_64.

## Funktionen

- **Persistente TypeScript-REPL** — `tsrepl` ist das Hauptwerkzeug. Zellen werden mit `Bun.Transpiler` umgewandelt und in einem `node:vm`-Kontext ausgeführt; Zuweisungen an `globalThis` bleiben über Zellen hinweg erhalten. `return` / `out()` setzen den Wert, die Ausgabe von `print()` wird erfasst, Fehler werden mit der betroffenen Zeile und einem konkreten Hinweis formatiert, `use()` importiert `node:`- / `bun:`-Builtins sowie cwd-relative Module, und `tool()` ruft andere Werkzeuge über die Host-Pipeline auf.
- **Rekursive Kind-Agenten** — `await rlm("prompt")` startet einen Kind-Agenten im selben Prozess und gibt dessen finale Antwort als String zurück. Die Tiefe ist begrenzt (Standard 2), Aufrufe einer REPL werden serialisiert, Abbrüche werden an das Kind weitergegeben, und jeder Aufruf schreibt einen `rlm_usage`-Eintrag für Token- und Kostenabrechnung.
- **Continual Harness** — `note()` schreibt sitzungsübergreifendes Gedächtnis, `goal()` verfolgt das Ziel des aktuellen Branches, Codemode-Werkzeuge verwalten Skills (`spirits_skill_*`), und der Agent kann seinen Code-Mode-Prompt selbst überschreiben (`spirits_prompt_set`).
- **Session-TODO und nicht destruktives Leeren** — `manage_todos` führt eine an den aktuellen Session-Branch gebundene TODO-Liste, die als Panel zwischen Editor und Footer erscheint; `/clear` startet einen frischen Konversationszweig, während Modell, Thinking-Level und Extension-State erhalten bleiben.
- **Zwei Modell-Routen** — `/model spirits/auto` bleibt eine einzige Auswahl und jede Anfrage wird als normal oder strong geroutet. Die beiden OpenSpec-Prüf-Skills erhalten das starke Modell (`models.strong` in den Einstellungen), alles andere das Standardmodell.
- **Single Binary** — kompiliert mit `bun build --compile`. Auf der Zielmaschine werden weder Bun noch Node benötigt.

## Installation

Nur Linux x86_64 (glibc). Der Installer prüft die SHA256-Summe, bevor er etwas ablegt.

```sh
curl -fsSL https://raw.githubusercontent.com/betiz0/spirits/main/scripts/install.sh | sh
```

Die Binärdatei landet unter `~/.spirits/bin/spirits`. Bei Bedarf in den PATH aufnehmen:

```sh
export PATH="$HOME/.spirits/bin:$PATH"
```

Mit `VERSION=0.1.0 sh ...` lässt sich eine Version festlegen; `spirits --version` zeigt die spirits-Version und die eingebettete Bun-Version; deinstalliert wird mit `... | sh -s -- --uninstall` (der Installer gibt nur die `rm`-Befehle aus, er löscht nichts automatisch).

Der Installer löst das neueste `spirits-v*`-Release auf. Ist noch kein Release vorhanden, aus dem Quellcode bauen (siehe "Entwicklung").

## Schnellstart

```sh
spirits
```

Ein Auftrag an das Modell wird über `tsrepl`-Zellen abgearbeitet:

```ts
// Zustand über Zellen hinweg liegt in globalThis
globalThis.rows = await (await use("./load.ts")).load();

// Delegieren: das Kind läuft in einer eigenen REPL-Sitzung
return await rlm("Fasse die Zeilen zusammen und gib JSON zurück.");
```

Details, Grenzen und Einschränkungen stehen in [`packages/spirits/README.md`](packages/spirits/README.md).

## Mitgelieferte Skills

spirits enthält Skills, die direkt nach der Installation verfügbar sind. Sie werden beim Start nach `<agentDir>/bundled-skills/<spirits-Version>/` geschrieben und an die Skill-Suche von pi übergeben; sie landen nie in `<agentDir>/skills/`.

- Mitgelieferte Skills werden explizit gestartet, zum Beispiel mit `/skill:sprt-architecture-guards`. Die meisten tragen `disable-model-invocation: true`, daher wählt das Modell sie nicht automatisch aus; `sprt-opsx-review-change` ist eine Ausnahme und kann vom Modell ausgewählt werden.
- Existiert in `<agentDir>/skills/<Name>/` ein gleichnamiger Benutzer-Skill, gewinnt immer die Benutzerversion. pi übernimmt die Benutzerversion und zeigt eine Kollisionswarnung an; die mitgelieferte Kopie wird übersprungen.
- Mit `SPIRITS_BUNDLED_SKILLS=0` werden alle mitgelieferten Skills deaktiviert (nicht gesetzt oder jeder andere Wert lässt sie aktiv). Deaktiviert wird weder geschrieben noch ein Skill-Pfad geliefert.
- Nach einem Update spirits neu starten, um die neuen Inhalte zu erhalten: Die Inhalte sind in die laufende Binärdatei eingebettet, daher schreibt `/reload` nur den Baum der bereits laufenden Version neu. Ein Verzeichnis einer alten Version wird beim Schreiben erst entfernt, wenn es 7 Tage lang nicht benutzt wurde.
- `bundled-skills/` wird von spirits verwaltet. Die Dateien dort nicht bearbeiten; eigene Skills gehören nach `<agentDir>/skills/`.

## Modell-Routing

Im OpenSpec-Workflow verlangen nur zwei Schritte ein stärkeres Modell: die Vorprüfung der Änderung `sprt-opsx-review-change` und die Tiefenverifikation `sprt-opsx-verify-deep`. Statt das Modell von Hand zu wechseln und das Zurücksetzen zu vergessen, wählt man ein Modell und lässt spirits jede Anfrage routen.

- Das Routing-Modell mit `/model spirits/auto` auswählen. Sonst ändert sich nichts: Standardmodell-Einstellungen, `--model` und das Verhalten von `/model` bleiben, wie sie sind; eine Sitzung mit direkt gewähltem physikalischem Modell wird nie geroutet.
- Das strong-Ziel steht in `settings.json` (`~/.spirits/agent/settings.json`, oder `.pi/settings.json` im Projekt):

  ```json
  { "models": { "strong": "anthropic/claude-opus-4-7" } }
  ```

  Nur die Modell-ID (`"claude-opus-4-7"`) wird über den jeweils aktuellen Standard-Provider aufgelöst. `models` ist ein spirits-Schlüssel; pi behält ihn, wenn es andere Einstellungen speichert.
- propose, apply, verify und archive laufen als **normal** auf Standard-Provider und Standardmodell. Lässt sich das Standardmodell nicht auflösen, übernimmt das Modell der letzten erfolgreichen Antwort mit einem Hinweis. Anfragen während `sprt-opsx-review-change` oder `sprt-opsx-verify-deep` laufen als **strong**, und die Rolle zurück nach der **gesperrten Rolle**, sobald der Run settled – auch nach Escape-Abbruch oder Fehler.
- Rolle mit `/model <model> [level] normal|strong` sperren: Enter gilt nur für die aktuelle Sitzung, CTRL+s speichert sie zusätzlich als Standardrolle (`models.role` in den Einstellungen). Die Sperre bleibt bei späteren Eingaben bestehen und löst sich mit `/model <model> normal`. Ein `/reload` liest `models.role` neu – eine nur mit Enter gesetzte Sperre fällt auf die Standardrolle zurück. Ein direkt gewähltes physikalisches Modell wird nie geroutet, dort erscheint die Sperre nur im Badge.
- Als Standardmodell (`defaultProvider` / `defaultModel`) ein **physisches** Modell belassen. Ein virtuelles Modell ist nie ein normal-Ziel: Wer `spirits/auto` als Standard speichert, lässt dem normal-Zweig nichts aufzulösen übrig, und die erste Anfrage einer neuen Sitzung endet mit einem Fehler.
- Ohne `models.strong` bleibt alles still als normal. Ein konfiguriertes, aber unbenutzbares strong-Ziel (unbekannte ID, Provider ohne Zugangsdaten) fällt auf normal zurück und meldet das genau einmal pro Run.
- Die Fußzeile zeigt `[normal]` oder `[strong]` vor dem Modellnamen. Das Badge nennt die Rolle der **letzten Anfrage** und hinkt deshalb eine Anfrage hinterher: direkt nach dem Start eines Skills steht noch `[normal]`, direkt nach dessen Ende noch `[strong]`, bis die nächste Anfrage kommt.

## Bekannte Einschränkungen

- Eine synchrone Schleife, die nach einem `await` startet, lässt sich nicht unterbrechen: Der Timeout greift nicht, und der ganze Prozess reagiert nicht mehr (Neustart nötig).
- Nur Linux x86_64; Themes, Assets, HTML-Export und native Prebuilds sind nicht enthalten.
- Keine automatischen Updates. Zum Aktualisieren den Installer erneut ausführen; `spirits update` verweist auf den Installer statt auf Pi's Release-URL.
- `rlm` ist synchron und serialisiert. Asynchrones Fan-out wird in M5 beurteilt.
- Konfiguration, Sitzungen und Authentifizierung liegen in `~/.spirits/agent/` (oder in `SPIRITS_CODING_AGENT_DIR`). Externe Erweiterungen gehören nach `~/.spirits/agent/extensions/`.
- **BREAKING**: Die alte Variable `PI_CODING_AGENT_DIR` wird nicht mehr gelesen. Der Standardpfad `~/.spirits/agent/` bleibt gleich, bestehende Daten funktionieren weiter.
- **BREAKING**: Die kompilierte Binärdatei liest die Dateien `.env`, `.env.local` und `.env.<NODE_ENV>` im Startverzeichnis nicht mehr. API-Schlüssel und andere Variablen im Shell mit `export` setzen oder vor dem Startbefehl angeben.
- Install-Telemetrie und Pi-attribuierte Provider-Header sind standardmässig aus. Sie lassen sich nicht über `settings.json` aktivieren; dafür `PI_TELEMETRY=1` setzen.

## Sicherheit

Vom Modell erzeugter Code läuft mit denselben Betriebssystem-Rechten wie der spirits-Prozess. Der vm-Kontext und `node:vm` sind keine Sicherheitsgrenze. Für nicht vertrauenswürdige Repositories oder Automatisierung sollte spirits in einer isolierten Umgebung betrieben werden, gemäss der Containerization-Empfehlung von Pi. Remote-Importe über `use()` sind standardmässig abgelehnt.

## Entwicklung

Voraussetzungen: Bun >= 1.4.0 (1.4.2 oder neuer empfohlen). Node.js wird nicht unterstützt.

```sh
git clone https://github.com/betiz0/spirits.git
cd spirits
npm ci --ignore-scripts   # nur nötig, um Pi aus dem Quellcode zu starten
cd packages/spirits
bun install --frozen-lockfile
bun test
bun run check
```

Entwicklungsbuild starten:

```sh
# aus dem Repository-Wurzelverzeichnis
bun packages/spirits/bin/spirits.ts

# oder die Erweiterung in Pi aus dem Quellcode laden
bun packages/coding-agent/src/cli.ts -e packages/spirits/src/index.ts
```

Mit `SPIRITS_DEV=1` werden Beschreibung, Dauer und Ergebnisart jeder Zelle auf stderr protokolliert.

## Dokumentation

- Gesamtdesign: [`docs/spirits-design.md`](docs/spirits-design.md)
- Phasendesigns: [`docs/spirits-m1-repl.md`](docs/spirits-m1-repl.md), [`docs/spirits-m2-distribution.md`](docs/spirits-m2-distribution.md), [`docs/spirits-m3-rlm.md`](docs/spirits-m3-rlm.md), [`docs/spirits-m4-harness.md`](docs/spirits-m4-harness.md), [`docs/spirits-m5-phase2.md`](docs/spirits-m5-phase2.md)
- Paketdetails: [`packages/spirits/README.md`](packages/spirits/README.md)
- Upstream Pi: [pi.dev](https://pi.dev), [earendil-works/pi](https://github.com/earendil-works/pi)

## Lizenz

MIT. Der Copyright-Hinweis des Upstream-Projekts Pi bleibt in [`LICENSE`](LICENSE) erhalten. Prime Agent dient nur als Architekturreferenz; es wurde kein Code daraus übernommen.

## Danksagung

- [Pi](https://github.com/earendil-works/pi) von Mario Zechner und Mitwirkenden — Upstream-Agent-Harness.
- [Prime Agent](https://github.com/PrimeIntellect-ai/prime-agent) von Prime Intellect — Referenzarchitektur für das RLM-artige Ausführungsmodell.
