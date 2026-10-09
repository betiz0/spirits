# spirits

[English](README.md) | [日本語](README.ja.md) | [简体中文](README.zh.md) | **Deutsch (Schweiz)**

spirits ist ein Fork von [Pi](https://github.com/earendil-works/pi), der das Ausführungsmodell von Prime Intellects [Prime Agent](https://github.com/PrimeIntellect-ai/prime-agent) in TypeScript/Bun neu umsetzt.

Statt das Modell über eine Schleife einzelner Tool-Aufrufe zu steuern, erhält es bei spirits eine persistente TypeScript-REPL (`tsrepl`) als Hauptschnittstelle: Das Modell schreibt TypeScript-Zellen, behält den Zustand über Zellen hinweg, ruft Host-Funktionen auf und kann Kind-Agenten rekursiv starten. Agenten können zudem ihr eigenes Gedächtnis, ihre Skills und ihren Code-Mode-Prompt über Sitzungen hinweg pflegen (ein "Continual Harness").

> **Status:** Die Meilensteine M1–M4 sind umgesetzt: persistente REPL, Single-Binary-Verteilung, synchrones `rlm` und Continual Harness. M5 (Phase-2-Erweiterungen) wird durch ein dogfooding-basiertes Go/No-Go-Gate entschieden. Releases werden mit `spirits-v*` getaggt; unterstützt wird nur Linux x86_64.

## Funktionen

- **Persistente TypeScript-REPL** — `tsrepl` ist das Hauptwerkzeug. Zellen werden mit `Bun.Transpiler` umgewandelt und in einem `node:vm`-Kontext ausgeführt; Zuweisungen an `globalThis` bleiben über Zellen hinweg erhalten. `return` / `out()` setzen den Wert, die Ausgabe von `print()` wird erfasst, Fehler werden mit der betroffenen Zeile und einem konkreten Hinweis formatiert, `use()` importiert `node:`- / `bun:`-Builtins sowie cwd-relative Module, und `tool()` ruft andere Werkzeuge über die Host-Pipeline auf.
- **Rekursive Kind-Agenten** — `await rlm("prompt")` startet einen Kind-Agenten im selben Prozess und gibt dessen finale Antwort als String zurück. Die Tiefe ist begrenzt (Standard 2), Aufrufe einer REPL werden serialisiert, Abbrüche werden an das Kind weitergegeben, und jeder Aufruf schreibt einen `rlm_usage`-Eintrag für Token- und Kostenabrechnung.
- **Continual Harness** — `note()` schreibt sitzungsübergreifendes Gedächtnis, `goal()` verfolgt das Ziel des aktuellen Branches, Codemode-Werkzeuge verwalten Skills (`spirits_skill_*`), und der Agent kann seinen Code-Mode-Prompt selbst überschreiben (`spirits_prompt_set`).
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

## Bekannte Einschränkungen

- Eine synchrone Schleife, die nach einem `await` startet, lässt sich nicht unterbrechen: Der Timeout greift nicht, und der ganze Prozess reagiert nicht mehr (Neustart nötig).
- Nur Linux x86_64; Themes, Assets, HTML-Export und native Prebuilds sind nicht enthalten.
- Keine automatischen Updates. Zum Aktualisieren den Installer erneut ausführen; `spirits update` zeigt nur den Update-Hinweis von Pi.
- `rlm` ist synchron und serialisiert. Asynchrones Fan-out wird in M5 beurteilt.
- Konfiguration, Sitzungen und Authentifizierung liegen in `~/.spirits/agent/` (oder in `PI_CODING_AGENT_DIR`). Externe Erweiterungen gehören nach `~/.spirits/agent/extensions/`.

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
