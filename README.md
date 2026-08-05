# Loco-Night-Cup
<!-- Admin-Panel Redeploy -->

## Loco Power Ranking

Das Power Ranking wertet jede Kalenderwoche von Montag 00:00 Uhr bis zum Abschluss des letzten Sonntags-Cups in der Zeitzone `Europe/Berlin`. Die aktuelle Rangliste wird nach jedem vollständig abgeschlossenen Cup aktualisiert. Historische Wochen und Turnierergebnisse liegen unabhängig von den täglich zurückgesetzten Eventdateien in `data/power-ranking.json`.

### Discord-Konfiguration

Die vorhandenen Kanäle werden nicht erstellt oder gelöscht:

- Ranking: `1534485406488203324`
- Champion der Woche: `1534485575543816305`
- dokumentierte Kategorie: `1534485070428115016`

Die IDs stehen in `config/settings.seed.json` unter `channels.powerRankingChannelId`, `channels.powerRankingChampionChannelId` und `categories.powerRankingCategoryId`. Optional überschreiben `POWER_RANKING_CHANNEL_ID` und `POWER_RANKING_CHAMPION_CHANNEL_ID` die beiden Kanalwerte zur Laufzeit.

### Punkte pro Cup

- Gruppen- oder Ligaphasen-Aus: 1
- Achtelfinal-Aus: 2
- Viertelfinal-Aus: 3
- Halbfinal-Aus oder Platz 4: 5
- Platz 3: 6
- Platz 2: 8
- Turniersieg: 10

Es wird genau ein finaler Wert pro echtem Teilnehmer gespeichert. Freilose werden nicht gewertet. Die persistente Struktur `tournamentResults[tournamentId].results[teamId]` erzwingt die fachliche Eindeutigkeit von Turnier und Team auch nach Neustarts.

### Wochenabschluss und Wiederherstellung

Der Sonntags-Cup finalisiert seine Woche erst nach bestätigt abgeschlossenem Finale und Spiel um Platz 3. Läuft der Cup über Mitternacht, bleibt er durch sein Eventdatum in der Sonntagswoche. Für ausgefallene oder abgesagte Sonntags-Cups prüft der Reconcile-Dienst ab Montag 07:00 Uhr, dass kein Sonntags-Cup mehr läuft, und finalisiert erst dann. Fehlgeschlagene Discord- und Champion-Posts werden beim nächsten Reconcile erneut versucht; gespeicherte Wertungen werden dabei nicht zurückgerollt.

Die Champion-Grafik wird ohne zwingende Hintergrundvorlage dynamisch als PNG mit den vorhandenen Fonts erstellt. Fehlt ein Teamlogo, zeichnet der Renderer einen neutralen Diamant-Platzhalter.

### Manuelle Neuberechnung

Der interne Service `rebuildPowerRankingForTournament(tournamentId, { client, event })` in `src/domain/power-ranking/power-ranking-service.js` ersetzt ausschließlich die Wertung dieses Turniers. Für eine bereits finalisierte Vorwoche wird eine deutliche Admin-Warnung protokolliert und niemals automatisch ein zweiter Champion-Beitrag veröffentlicht.

### Storage-Migration

Beim Start legt `initializeStorage()` fehlende Power-Ranking-Daten und Message-Referenzen an. Das Format wird durch `src/validation/power-ranking.schema.js` validiert. Der tägliche Cup-Reset verändert `data/power-ranking.json` nicht.
