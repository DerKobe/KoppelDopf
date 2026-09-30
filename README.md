# 🍺 KoppelDopf – Doppelkopf am Stammtisch

Multiplayer-Doppelkopf im Browser für eine Freundesrunde: ein Tisch in einer 3D-Kneipe (three.js),
einstellbare Sonderregeln, Bots für fehlende Mitspieler und Voice-/Videochat per WebRTC.

## Starten

```bash
npm install
npm start
```

Dann `http://localhost:3000` öffnen, Namen eingeben, hinsetzen. Der erste Spieler am Tisch ist Gastgeber:
er stellt die Sonderregeln ein, füllt freie Plätze mit Bots auf und startet die Partie.
Weitere Freunde öffnen einfach denselben Link.

## Mit Freunden über das Internet spielen

Browser erlauben Kamera und Mikrofon nur über **HTTPS** (oder `localhost`). Am einfachsten ist ein Tunnel,
der automatisch HTTPS mitbringt, z. B.:

```bash
cloudflared tunnel --url http://localhost:3000
```

Alternativ direkt mit eigenem Zertifikat:

```bash
HTTPS_KEY=./key.pem HTTPS_CERT=./cert.pem PORT=443 npm start
```

Voice/Video läuft als Mesh direkt zwischen den Browsern; der Server vermittelt nur die Verbindung.
Standardmäßig werden öffentliche STUN-Server genutzt. Hängt jemand hinter einem strikten NAT
(manche Firmen- oder Mobilfunknetze), braucht es zusätzlich einen TURN-Server:

```bash
ICE_SERVERS='[{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:turn.example.org:3478","username":"u","credential":"p"}]' npm start
```

## Deployment mit Dokku

Das Repo enthält ein `Dockerfile` (Node 22, nur Laufzeit-Abhängigkeiten, Port 3000). Dokku erkennt es
automatisch und baut damit statt mit Herokuish/Buildpacks.

```bash
dokku apps:create koppeldopf
dokku proxy:ports-set koppeldopf http:80:3000
dokku domains:set koppeldopf koppeldopf.example.org
git push dokku master
dokku letsencrypt:enable koppeldopf   # HTTPS – nötig für Kamera/Mikrofon
```

WebSockets laufen über Dokkus nginx ohne weitere Konfiguration.

## Sonderregeln (in der Lobby wählbar)

| Bereich | Regeln |
|---|---|
| Grundregeln | mit/ohne Neunen, Dullen (zweite sticht erste / außer im letzten Stich / erste sticht / ohne Dullen), Ansagen & Absagen, Partielänge |
| Vorbehalte | Hochzeit (Klärung: erster Fremdstich / Fehl / Trumpf), Armut, Schmeißen (5 Neunen oder 5 Könige) |
| Soli | Damen-, Buben-, Farbsoli (Kreuz, Pik, Herz, Karo), Fleischloser, „Solist kommt raus“ |
| Trumpf-Extras | Schweinchen, Superschweinchen |
| Sonderpunkte | Fuchs gefangen, Karlchen, Doppelkopf, Gegen die Alten, Bockrunden |

Voreinstellungen: *Kneipenrunde*, *DDV-Turnier*, *Alles an*, *Einsteiger*.
Die stille Hochzeit wird automatisch erkannt und wie ein Solo abgerechnet.

## Kartenbilder

Vorderseiten: das klassische „English pattern“-Blatt von Dmitry Fomin (Wikimedia Commons, CC0/gemeinfrei),
mit deutschen Eck-Indizes B/D/K statt J/Q/K. Die Rückseite ist ein eigenes,
mit Nano Banana generiertes Motiv. Details: [public/cards/CREDITS.md](public/cards/CREDITS.md).

## Bedienung

- **Karte spielen:** anklicken (Touch: antippen zum Anheben, nochmal antippen zum Spielen). Nicht erlaubte Karten sind abgedunkelt.
- **Ansagen:** erscheinen als Knöpfe über der Hand, solange sie zeitlich noch erlaubt sind.
- **Oben rechts:** Voice/Video, Mikro/Kamera, letzter Stich, Spielstand, Regeln, Chat, Ton, Menü.
- **Verbindung weg?** Einfach neu laden – der Platz bleibt erhalten, bis dahin spielt ein Bot. Zuschauer können
  Bot-Plätze und verwaiste Plätze während der Partie übernehmen.

## Aufbau

```
server/index.js   HTTP(S)-Server, WebSocket, ICE-Konfiguration
server/room.js    der eine Tisch: Plätze, Gastgeber, Bots, Partie, Chat, WebRTC-Signaling
server/round.js   ein Spiel: Vorbehalte, Armut, Hochzeit, Stiche, Ansagen, Abrechnung (autoritativ)
server/bot.js     Bots: Karten, Ansagen und Vorbehalte per Monte-Carlo, Armut regelbasiert
server/ai/        brain.js (Wissen, Verteilungen würfeln, Entscheidungen), policy.js (Spielstrategie für Simulationen)
shared/cards.js   Karten, Trumpfreihenfolgen, Bedienpflicht, Stichgewinner (Server + Client)
shared/rules.js   Regeldefinitionen und Presets
public/js/        three.js-Szene (table.js, pub.js, cardart.js), UI (main.js), WebRTC (rtc.js)
public/cards/     Kartenbilder (SVG-Vorderseiten, Rückseite) + Herkunft/Lizenz
public/audio/     Sprachansagen (4 Stimmen) + manifest.json
test/sim.js       Regeltests + Simulation tausender Bot-Spiele mit Invarianten-Prüfung
test/bench.js     Duplikat-Vergleich neue gegen alte Bots (test/legacy-bot.js)
test/behavior.js  Prüft, wie oft die Bots gängige Faustregeln einhalten
```

`npm test` spielt 3000 zufällige Spiele mit zufälligen Regelkombinationen und prüft u. a., dass immer
240 Augen verteilt werden und die Punkte sich zu null summieren.

Mit `?debug` in der URL steht im Browser `window.KD` zur Fehlersuche bereit.

## Sprachansagen

Ansagen sind am Tisch hörbar – egal ob du, ein Mitspieler oder ein Bot ansagt: Re, Kontra, keine 90/60/30,
schwarz (mit oder ohne vorangestelltes Re/Kontra), Vorbehalt, Hochzeit, Armut, Schmeißen, alle Soli sowie
Schweinchen/Superschweinchen. Es gibt vier Stimmen (zwei männlich, zwei weiblich); Bots klingen passend zu
ihrem Namen, und jeder Mensch kann seine Stimme im Menü unter „Meine Stimme“ wählen – so hören ihn auch die
anderen. Der Lautsprecher-Knopf schaltet auch die Ansagen stumm.

Die Dateien liegen in `public/audio/voice/<stimme>/<zeile>.mp3` (plus `manifest.json`) und wurden mit Googles
Gemini-TTS erzeugt (Skript `text2speech/text2speech.js`, nicht versioniert):

```bash
cd text2speech && npm install && npm run tts -- --list        # Katalog anzeigen
npm run tts                                                   # fehlende Ansagen erzeugen
npm run tts -- --only kontra --voices f1 --force               # einzelne neu erzeugen
npm run tts -- --say "Gut Blatt!" --voice m2 --out gut.mp3     # beliebige kurze Ansage
```

## Wie die Bots spielen

Die Bots entscheiden per „Perfect Information Monte Carlo“, wie gute Skat- und Doppelkopf-Programme:

1. **Nur echtes Tischwissen:** eigene Karten, gespielte Karten, wer welche Farbe nicht mehr bedienen kann,
   bekannte Parteien (Kreuz-Dame, Ansagen, Hochzeit, Armut) und Indizien nach den gängigen Faustregeln
   (wer schmiert, Pik-Dame an Position 2/3, früh gespielte Dulle …). Die Karten der anderen sehen sie nie.
2. **Verteilungen würfeln**, die zu diesem Wissen passen.
3. **Jede erlaubte Karte** in jeder Verteilung bis zum Spielende durchspielen (mit einer schnellen Strategie nach
   den Faustregeln: laufende Asse, Partner-Stich nicht überstechen, schmieren, Füchse schützen …) und die Karte
   mit dem besten erwarteten Spielergebnis wählen. Kleine Zuschläge für die Faustregeln sorgen dafür, dass
   die Bots für einen menschlichen Partner berechenbar bleiben; bei knappen Entscheidungen ist etwas Zufall dabei.
4. **Ansagen** nur, wenn die Simulation hohe Gewinnchancen zeigt (Re/Kontra ~75 %, Absagen ~90 %), in der
   Regel zum letztmöglichen Zeitpunkt. **Soli und Hochzeit** werden ebenfalls durchgespielt und nur gewählt,
   wenn sie sich deutlich lohnen.

Eine Kartenentscheidung dauert typisch 50–150 ms. `npm run bench` vergleicht neue und alte Bots im
Duplikat-Verfahren (gleiche Karten, getauschte Plätze), `npm run behavior` prüft die Faustregeln.
