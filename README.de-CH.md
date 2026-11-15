# spirits

[English](README.md) | [日本語](README.ja.md) | [简体中文](README.zh.md) | **Deutsch (Schweiz)**

spirits ist eine Erweiterungsbündelung plus ein schlanker Launcher für das offizielle [Pi](https://github.com/earendil-works/pi)-Artefakt, der das Ausführungsmodell von Prime Intellects [Prime Agent](https://github.com/PrimeIntellect-ai/prime-agent) in TypeScript/Bun neu umsetzt. spirits enthält keinen Pi-Quellcode: `~/.spirits/managed-pi` hält das angepinnte offizielle Pi-Release, und die kompilierte `spirits`-Binärdatei prüft dieses Set und startet es mit geladener spirits-Erweiterung.

Statt das Modell über eine Schleife einzelner Tool-Aufrufe zu steuern, erhält es bei spirits eine persistente TypeScript-REPL (`tsrepl`) als Hauptschnittstelle: Das Modell schreibt TypeScript-Zellen, behält den Zustand über Zellen hinweg, ruft Host-Funktionen auf und kann Kind-Agenten rekursiv starten. Agenten können zudem ihr eigenes Gedächtnis, ihre Skills und ihren Code-Mode-Prompt über Sitzungen hinweg pflegen (ein "Continual Harness").

> **Status:** Die Meilensteine M1–M4 sind umgesetzt: persistente REPL, Single-Binary-Verteilung, synchrones `rlm` und Continual Harness. M5 (Phase-2-Erweiterungen) wird durch ein dogfooding-basiertes Go/No-Go-Gate entschieden. Releases werden mit `spirits-v*` getaggt; unterstützt wird nur Linux x86_64.

## Funktionen

- **Persistente TypeScript-REPL** — `tsrepl` ist das Hauptwerkzeug. Zellen werden mit `Bun.Transpiler` umgewandelt und in einem `node:vm`-Kontext ausgeführt; Zuweisungen an `globalThis` bleiben über Zellen hinweg erhalten. `return` / `out()` setzen den Wert, die Ausgabe von `print()` wird erfasst, Fehler werden mit der betroffenen Zeile und einem konkreten Hinweis formatiert, `use()` importiert `node:`- / `bun:`-Builtins sowie cwd-relative Module, und `tool()` ruft andere Werkzeuge über die Host-Pipeline auf.
- **Rekursive Kind-Agenten** — `await rlm("prompt")` startet einen Kind-Agenten im selben Prozess und gibt dessen finale Antwort als String zurück. Die Tiefe ist begrenzt (Standard 2), Aufrufe einer REPL werden serialisiert, Abbrüche werden an das Kind weitergegeben, und jeder Aufruf schreibt einen `rlm_usage`-Eintrag für Token- und Kostenabrechnung.
- **Continual Harness** — `note()` schreibt sitzungsübergreifendes Gedächtnis, `goal()` verfolgt das Ziel des aktuellen Branches, Codemode-Werkzeuge verwalten Skills (`spirits_skill_*`), und der Agent kann seinen Code-Mode-Prompt selbst überschreiben (`spirits_prompt_set`).
- **Session-TODO und nicht destruktives Leeren** — `manage_todos` führt eine an den aktuellen Session-Branch gebundene TODO-Liste, die als Panel zwischen Editor und Footer erscheint; `/spirits-clear` startet einen frischen Konversationszweig, während Modell, Thinking-Level und Extension-State erhalten bleiben.
- **Zwei Modell-Routen** — `/model spirits/auto` bleibt eine einzige Auswahl und jede Anfrage wird als normal oder strong geroutet. Die beiden OpenSpec-Prüf-Skills erhalten das starke Modell (`models.strong` in den Einstellungen), alles andere das Standardmodell.
- **Single Binary** — der Launcher ist mit `bun build --compile` gebaut und enthält keinen Pi-Quellcode. Beim ersten Start lädt er das angepinnte Host-Set, prüft jede Prüfsumme und startet es erst dann; auf der Zielmaschine werden weder Bun noch Node benötigt.

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

Eine installierte Binärdatei aktualisiert `spirits update`:

```sh
spirits update           # ersetzt durch das neueste Stable-Release und installiert dessen Managed-Set
spirits update self      # dieselbe Bedeutung, explizit geschrieben
spirits update --force   # auch bei bereits aktueller Version neu herunterladen
```

`spirits update` prüft die SHA256-Summe, ersetzt `~/.spirits/bin/spirits` per atomarem Rename und installiert danach das Managed-Set des Releases, auf das aktualisiert wurde. Stimmt die installierte Version mit dem neuesten Stable überein (oder ist neuer, etwa ein Pre-Release), erscheint `spirits <version> is already up to date`; die Binärdatei bleibt unverändert, das Set wird trotzdem installiert. `PI_OFFLINE=1` (auch `true` / `yes`) lehnt ohne Netzwerkzugriff ab. Update-Anfragen scheitern nach 10 Sekunden ohne empfangene Daten; `SPIRITS_UPDATE_IDLE_TIMEOUT_SECONDS` (positive Ganzzahl-Sekunden) überschreibt das.

`spirits update` akzeptiert nur diese Formen. `--all`, `--extensions`, `--models`, `-h`, unbekannte Optionen und jedes Positionale außer `self` / `pi` werden mit einer Meldung und nicht-null Exit-Code abgelehnt, denn still durchzureichen würde ein nicht behandeltes Flag wie einen gelungenen Update aussehen lassen. **Wer von 0.7.x kommt, benutzt `spirits update`**: `spirits update --all` ist keine Selbstupdate-Form mehr.

Host und spirits-Erweiterungsbündel folgen dem spirits-Release, `spirits update` aktualisiert also auch sie. Zwei Dinge laufen außerhalb:

```sh
spirits managed-pi update                                # das angepinnte Host-Set ohne die Binärdatei
~/.spirits/managed-pi/current/pi/pi update --extensions  # Pakete und Model-Kataloge des Hosts
```

Der zweite Befehl läuft auf der Host-Binärdatei: Der Launcher lädt das Erweiterungsbündel immer vor den Argumenten des Aufrufers, darum ist `spirits -- update ...` eine Eingabe ans Modell, kein Host-Befehl. Für die übrigen Host-Befehle (`install`, `remove`, `uninstall`, `list`, `config`, `auth`, `mcp`) gilt dasselbe: `spirits <befehl>` lehnt ab und nennt den Pfad der Host-Binärdatei.

`install.sh` erneut ausführen funktioniert weiterhin: Bei der neusten Version wird der Download übersprungen, wenn die installierte Version übereinstimmt, und `spirits <version> is already up to date` ausgegeben. Mit `VERSION=x.y.z` erzwungen man erneuten Download und Ablage. Die 0.1.0-Binärdatei stammt vor dem Selbstupdate; von 0.1.0 braucht man einmal `install.sh`, danach funktioniert `spirits update`.

Themes liefert das Host-Artefakt. Der Launcher legt `~/.spirits/bin/theme/` nicht mehr an; ein Verzeichnis einer älteren Version wird nicht benutzt und kann entfernt werden.

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
- Rolle mit `/spirits-role <normal|strong>` sperren: die Sperre bleibt bei späteren Eingaben bestehen und wechselt, wenn man die andere Rolle sperrt. Ein `/reload` liest `models.role` neu – eine nur für die Sitzung gesetzte Sperre fällt auf die Standardrolle zurück. Solange ein physikalisches Modell gewählt ist, gibt es weder Routing noch Badge (`/spirits-role status` meldet dann `routing: off (a physical model is selected)`); die Sperre wirkt ab den Anfragen, die nach der Rückkehr auf `spirits/auto` gestellt werden.
- Als Standardmodell (`defaultProvider` / `defaultModel`) ein **physisches** Modell belassen. Ein virtuelles Modell ist nie ein normal-Ziel: Wer `spirits/auto` als Standard speichert, lässt dem normal-Zweig nichts aufzulösen übrig, und die erste Anfrage einer neuen Sitzung endet mit einem Fehler.
- Ohne `models.strong` bleibt alles still als normal. Ein konfiguriertes, aber unbenutzbares strong-Ziel (unbekannte ID, Provider ohne Zugangsdaten) fällt auf normal zurück und meldet das genau einmal pro Run.
- Das Badge zeichnet die Erweiterung in ihrer eigenen Statuszeile unter der Modellzeile, nicht in der Fußzeile des Hosts. Das Badge nennt die Rolle der **letzten Anfrage** und hinkt deshalb eine Anfrage hinterher: direkt nach dem Start eines Skills steht noch `[normal]`, direkt nach dessen Ende noch `[strong]`, bis die nächste Anfrage kommt.
- `/spirits-role status` zeigt Routing-Zustand, Sperre, laufenden Schritt, letzte Anfrage und die aufgelösten normal- / strong-Ziele.

## Bekannte Einschränkungen

- Eine synchrone Schleife, die nach einem `await` startet, lässt sich nicht unterbrechen: Der Timeout greift nicht, und der ganze Prozess reagiert nicht mehr (Neustart nötig).
- Nur Linux x86_64.
- Das Role-Badge zeichnet auf der Statuszeile der Erweiterung und liegt damit auf einer eigenen Zeile unter der Modellanzeige des Hosts. Role-Befehle sind `/spirits-role ...`; der `/model`-Befehl des Hosts kennt kein Role-Argument.
- Die eigenen Befehle des Hosts sind über `spirits` nicht erreichbar: `spirits update <weitere argumente>`, `spirits install`, `spirits list` und der Rest werden abgelehnt und nennen den Pfad der Host-Binärdatei. Der Launcher lädt zuerst das Erweiterungsbündel, und der Host dispatcht einen Befehl nur aus seinem ersten Argument.
- Keine automatischen Updates. Aktualisieren mit `spirits update` oder erneutem Installer-Lauf.
- Der erste Start braucht Netzwerk: Er lädt den angepinnten Host-Tarball (58.876.253 Bytes für Pi 1.5.0) und das Erweiterungsbündel nach `~/.spirits/managed-pi`, danach belegt das Set 182 MB. Spätere Starts prüfen das Set lokal; `spirits managed-pi repair` baut es neu. `PI_OFFLINE=1` gilt für `spirits update`, nicht für das Managed-Set.
- `rlm` ist synchron und serialisiert. Asynchrones Fan-out wird in M5 beurteilt.
- Konfiguration, Sitzungen und Authentifizierung liegen in `~/.spirits/agent/` (oder in `SPIRITS_CODING_AGENT_DIR`). Externe Erweiterungen gehören nach `~/.spirits/agent/extensions/`.
- **BREAKING**: Die alte Variable `PI_CODING_AGENT_DIR` wird nicht mehr gelesen. Der Standardpfad `~/.spirits/agent/` bleibt gleich, bestehende Daten funktionieren weiter.
- **BREAKING**: Die kompilierte Binärdatei liest die Dateien `.env`, `.env.local` und `.env.<NODE_ENV>` im Startverzeichnis nicht mehr. API-Schlüssel und andere Variablen im Shell mit `export` setzen oder vor dem Startbefehl angeben.
- Install-Telemetrie und Pi-attribuierte Provider-Header sind standardmässig aus. Sie lassen sich nicht über `settings.json` aktivieren; dafür `PI_TELEMETRY=1` setzen.

## Sicherheit

Vom Modell erzeugter Code läuft mit denselben Betriebssystem-Rechten wie der spirits-Prozess. Der vm-Kontext und `node:vm` sind keine Sicherheitsgrenze. Für nicht vertrauenswürdige Repositories oder Automatisierung sollte spirits in einer isolierten Umgebung betrieben werden, gemäss der Containerization-Empfehlung von Pi. Remote-Importe über `use()` sind standardmässig abgelehnt.

## Entwicklung

Voraussetzungen: Bun >= 1.4.0 (1.4.2 oder neuer empfohlen). Node.js dient nur dem Lockfile-Gate und einigen Skripten.

```sh
git clone https://github.com/betiz0/spirits.git
cd spirits
bun install --frozen-lockfile   # ein Workspace, eine bun.lock
bun run check                   # biome + tsc für scripts + tsc für packages/spirits, ohne Umschreiben
bun run fix                     # die schreibende Variante
cd packages/spirits && bun test
```

Entwicklungsbuild starten:

```sh
# aus dem Repository-Wurzelverzeichnis
bun packages/spirits/bin/spirits.ts
```

Ein Lauf aus dem Quellcode holt nichts selbst, darum braucht er zuerst das Managed-Set:

```sh
bun packages/spirits/bin/spirits.ts managed-pi install
# oder auf einen lokal gebauten Manifest zeigen
SPIRITS_MANAGED_PI_MANIFEST_URL=http://host/manifest.json bun packages/spirits/bin/spirits.ts -- --version
```

Die Host-Typen kommen aus den angepinnten devDependencies `@earendil-works/pi-coding-agent` und `@earendil-works/pi-tui`; `tsc` prüft die Erweiterung gegen dieselben Deklarationen, die der Host mitliefert. Der Launcher-Bau braucht keinen Pi-Quellcode: `bun scripts/build-binaries.ts --version <version>` kompiliert nur `packages/spirits/bin/spirits.ts`.

Mit `SPIRITS_DEV=1` werden Beschreibung, Dauer und Ergebnisart jeder Zelle auf stderr protokolliert.

## Dokumentation

- Gesamtdesign: [`docs/spirits-design.md`](docs/spirits-design.md)
- Startpfade und Managed-Set: [`docs/spirits-default-launch.md`](docs/spirits-default-launch.md), [`docs/spirits-managed-pi.md`](docs/spirits-managed-pi.md)
- Host-Version aktualisieren und zurückrollen: [`docs/spirits-host-upgrade.md`](docs/spirits-host-upgrade.md)
- Phasendesigns: [`docs/spirits-m1-repl.md`](docs/spirits-m1-repl.md), [`docs/spirits-m2-distribution.md`](docs/spirits-m2-distribution.md), [`docs/spirits-m3-rlm.md`](docs/spirits-m3-rlm.md), [`docs/spirits-m4-harness.md`](docs/spirits-m4-harness.md), [`docs/spirits-m5-phase2.md`](docs/spirits-m5-phase2.md)
- Paketdetails: [`packages/spirits/README.md`](packages/spirits/README.md)
- Der Host Pi: [pi.dev](https://pi.dev), [earendil-works/pi](https://github.com/earendil-works/pi)

## Lizenz

MIT. Der Copyright-Hinweis des Upstream-Projekts Pi bleibt in [`LICENSE`](LICENSE) erhalten; die Datei hält auch fest, dass spirits ein eigenständiges Werk ist, das auf Pi läuft, und keine Ableitung seines Quellcodes. Prime Agent dient nur als Architekturreferenz; es wurde kein Code daraus übernommen.

## Danksagung

- [Pi](https://github.com/earendil-works/pi) von Mario Zechner und Mitwirkenden — Upstream-Agent-Harness.
- [Prime Agent](https://github.com/PrimeIntellect-ai/prime-agent) von Prime Intellect — Referenzarchitektur für das RLM-artige Ausführungsmodell.
