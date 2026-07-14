# Team of the Tournament

The implementation uses the official EA Clubs base URL and never requires an API key. Only the provider module contains EA URLs. Confirmed group and knockout matches create idempotent persistent lookup jobs in `data/team-of-the-tournament/store.json`.

## EA response contract

The provider implements the supplied real EA structure: `matchId`, `timestamp`, `clubs.{clubId}.details`, and `players.{clubId}` with `playername`, `pos`, `rating`, `secondsPlayed`, `gameTime`, `mom`, goals, assists, saves, tackles and red cards. `aggregate` entries and players without actual playing time are excluded. Unknown structures fail explicitly instead of being guessed.

## Configuration

`PRO_CLUBS_API_PROVIDER=ea-direct`, `PRO_CLUBS_API_BASE_URL=https://proclubs.ea.com/api/fc`, `PRO_CLUBS_PLATFORM=common-gen5`, `PRO_CLUBS_API_TIMEOUT_MS=10000`, `PRO_CLUBS_MATCH_RESULT_COUNT=10`, `TEAM_OF_THE_TOURNAMENT_CHANNEL_ID=1526529020626341958`, `TOTT_MIN_MATCHES=2`, `TOTT_ALLOW_PARTIAL_PUBLISH=true`.
