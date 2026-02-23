# Bwinbet UG Live Football Content System

## Objective
Keep the Bwinbet UG football feed live, varied, and engaging every hour with:
- Trending news with related images
- Video highlights from multiple leagues
- Match results
- Predictions (from bwin source)
- League table updates (big leagues)

## Source Alignment
From `www.bwinbetug.com` / `m.bwinbetug.com`, football data presentation is widget-driven and sportsbook-style.
The mobile build references Sportradar widget infrastructure, so the posting system mirrors that style by:
- Keeping scoreboard/table content concise and odds-adjacent
- Prioritizing fast, high-frequency table/result updates
- Rendering branded table cards in Bwinbet yellow/black visual language

## Live Scheduler
The trend engine runs every hour (`trendIntervalHours = 1`).

### Timezone
- Primary timezone: `Africa/Kampala`
- Config key: `trendTimezone`

### Slot Rules (Hourly)
At each hourly run, the content type is selected by schedule:
- `09:00, 13:00, 17:00, 21:00` -> `prediction`
- `08:00, 16:00, 23:00` -> `table`
- All other hours rotate in sequence:
  - `result`
  - `news`
  - `video`

Rotation cursor is stored in `trendSlotCursor`.

## Content Types

### 1) Prediction Posts
- Source: `trendPredictionsUrl` (default `https://www.bwinbetug.com`), fallback `https://m.bwinbetug.com`
- Extracts fixture-like entries and available odds patterns
- CTA always includes: `www.bwinbetug.info`

### 2) Table Posts
- Source: `api-football-standings.azharimm.dev`
- Fallback source: ESPN standings API (`site.api.espn.com`) when primary source is unavailable
- Rotates league by `trendTableCursor` through:
  - Premier League (`eng.1`)
  - La Liga (`esp.1`)
  - Serie A (`ita.1`)
  - Bundesliga (`ger.1`)
  - Ligue 1 (`fra.1`)
- Output format:
  - Text caption with top teams + points + played
  - Branded live table image card (`/public/table-image/:id.png`) in Bwinbet yellow/black style

### 3) Result Posts
- Source: football trend candidates
- Detects scoreline titles using score patterns (`2-1`, `1:0`, etc.)
- Posts latest valid result with source label

### 4) News Posts
- Source: football trend candidates (trusted feeds)
- Uses generated football news copy
- Uses related source image when available
- If image is missing, generates a football news card image

### 5) Video Posts
- Source: X highlight accounts
- Quote-post mode on X with league account rotation
- Weekly-award preference remains supported when enabled

## League Diversification (Video)
To avoid repeated Champions League-only posting:
- Highlight accounts are rotated via `xHighlightAccountCursor`
- Last highlight tweet/account are stored to reduce repetition
- Rotation applies on each video slot run

## Anti-Repetition Controls
Trend keys are tracked in `trendRecentKeys`:
- Each posted item gets a content key by type
- Recent keys are retained with bounded history
- Duplicate keys are skipped/fallbacked when possible

Additional tracking:
- `trendLastContentType`
- `trendLastContentKey`

## Visual Reliability
For football structured posts:
- If required imagery is missing, the system generates a football card image
- Ensures news/results/tables/predictions remain visually engaging
- For `table` slots, the system first attempts a dedicated live-table image template before generic fallback

## Operational Fields (Autopost Job)
Key fields used by the live system:
- `trendEnabled`
- `trendIntervalHours`
- `trendPlatforms`
- `trendTimezone`
- `trendStructuredScheduleEnabled`
- `trendSlotCursor`
- `trendTableCursor`
- `trendRecentKeys`
- `trendPredictionsUrl`
- `xHighlightAccounts`
- `xHighlightAccountCursor`
- `xLastHighlightTweetId`
- `xLastHighlightUsername`

## Runbook
1. Ensure trend job is enabled for user.
2. Confirm hourly interval (`trendIntervalHours = 1`).
3. Confirm X is in `trendPlatforms`.
4. Confirm `xHighlightAccounts` contains multiple leagues.
5. Confirm `trendTimezone = Africa/Kampala`.
6. Trigger deploy and verify `/version`.
7. Optionally trigger immediate trend run for validation.

## Notes
- Predictions extraction depends on source HTML availability and can fallback to other slot types if unavailable.
- Table API availability can vary; ESPN fallback is used before falling back to non-table slot content.
- Existing auto-replies remain active and can run independently of trend posting.
