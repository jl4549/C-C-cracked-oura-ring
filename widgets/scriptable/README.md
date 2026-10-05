# iPhone home screen widget (Scriptable)

`OuraWidget.js` shows your latest Readiness, Sleep and Activity scores as rings,
plus key stats, a 7-day trend (large size) and how long ago the data was synced.
It supports small, medium and large widgets, and lock screen widgets.

## How it works

1. After every successful sync (scheduled, manual, or ZIP upload) the backend writes
   `oura_summary.json`.
2. The file goes to the **Widget Summary Folder** set under Settings. If that is
   empty, the backend uses the Scriptable folder in iCloud Drive when it finds one:
   - Windows (iCloud for Windows): `%USERPROFILE%\iCloudDrive\iCloud~dk~simonbs~Scriptable`
   - macOS: `~/Library/Mobile Documents/iCloud~dk~simonbs~Scriptable/Documents`

   If it doesn't find one, it falls back to the app data folder (`%APPDATA%\CrackedOura`).
3. iCloud syncs the file to your iPhone, and the widget reads it from there.

To write the file right away without waiting for a sync, call `POST /api/widget/export`.
To see its contents without writing it, call `GET /api/widget/summary`.

## Setup on the iPhone

1. Install [Scriptable](https://apps.apple.com/app/scriptable/id1405459188) and turn on
   iCloud Drive for it.
2. Copy `OuraWidget.js` into iCloud Drive › Scriptable, or paste it into a new script.
3. Long-press the home screen › **+** › Scriptable, then pick a size. Edit the widget
   and set **Script** to `OuraWidget`.
4. Optional: set **Parameter** to a different file name in the Scriptable folder.

If the file is missing or can't be read, the widget shows sample data and a
**SAMPLE** badge. The sync time turns red when the data is more than 8 days old,
so a weekly schedule never shows as stale.

## `oura_summary.json` (schema_version 1)

```json
{
  "schema_version": 1,
  "generated_at": "2026-10-06T11:05:00+02:00",
  "latest_day": "2026-10-05",
  "latest": {
    "sleep_score": 75,
    "readiness_score": 65,
    "activity_score": 85,
    "total_sleep_seconds": 27000,
    "average_hrv": 48,
    "lowest_heart_rate": 52,
    "steps": 5000,
    "temperature_deviation": -0.12
  },
  "trend": [
    { "day": "2026-09-29", "sleep_score": 80, "readiness_score": 74, "activity_score": 90 }
  ]
}
```

- `latest_day` is the most recent day that has a sleep or readiness score. Today's
  partial activity data doesn't count.
- `total_sleep_seconds`, `average_hrv` and `lowest_heart_rate` come from that day's
  main sleep (the `long_sleep` session, otherwise the longest one).
- `trend` always has 7 consecutive days ending at `latest_day`. A day with no data
  has `null` scores.
- Any value can be `null`. The widget shows `–` for it.
