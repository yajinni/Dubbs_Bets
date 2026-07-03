# AI Benchmark Plan: Odds Locking And Validation

Baseline commit: `b1b2e29 Create AI benchmark baseline`

## Scope

Fix only these two problems:

1. Fix odds locking timing and make odds updates impossible after kickoff.
2. Add strict server-side validation and conditional writes for locked matches.

Do not work on admin authentication, participant authentication, scoring-rule changes, UI redesigns, or unrelated refactors.

Odds locking must happen at **9 AM ET**. Do not move it back to midnight.

## Target Files

Expected files:

- `functions/api/sync.js`
- `functions/api/predictions.js`
- `functions/api/matches.js`
- `sync-worker/index.js`
- `sync-worker/wrangler.toml`
- `README.md`, only for comments/docs if needed

Avoid changing other files unless required. If you change other files, explain why in the PR.

## Global Rules

- Keep existing API behavior unless the plan explicitly changes it.
- Keep changes small and easy to review.
- Do not hide failing checks.
- Stop after a failed phase gate and report the exact failure.
- `npm run build` must pass before the final answer.
- Full lint may have pre-existing failures; run targeted lint on changed files and report output.

## Definitions

Treat a match as started if any of the following is true:

- `status !== 'scheduled'`
- `finished === 1`
- `local_date <= now`
- `local_date` is missing or invalid

Treat “today” as the calendar date in `America/New_York`, not server local time.

At 9 AM ET, every unfinished/unlocked match scheduled for today ET must get `odds_locked = 1`, even when The Odds API does not return the fixture or name matching fails.

Lock-only updates must not alter odds values.

After kickoff, odds values must never change from automated sync, daily lock, lock task, or manual match override.

## Phase 1: Inventory Current Lock And Write Paths

Tasks:

1. Inspect `functions/api/sync.js`.
2. Find all odds update paths:
   - `syncFromTheOddsAPI`
   - `handleMidnightLock`
   - `handleLockMatchTask`
3. Find every place that writes odds fields:
   - `home_win_pct`
   - `away_win_pct`
   - `draw_pct`
   - `over_under_line`
   - `over_odds`
   - `under_odds`
   - `odds_locked`
   - `odds_updated_at`
4. Inspect `functions/api/predictions.js`.
5. Find the current match lock check before saving predictions.
6. Inspect `functions/api/matches.js`.
7. Find manual match override writes and their validation.

Gate checks:

- Confirm all odds write locations are listed in your notes.
- Confirm prediction writes happen only in `functions/api/predictions.js`.
- Confirm manual match override writes happen in `functions/api/matches.js`.
- Do not proceed until exact write locations are known.

## Phase 2: Normalize 9 AM ET Lock Naming And Schedule

Goal: Keep the lock at 9 AM ET and remove misleading “midnight” wording where practical.

Tasks:

1. Open `sync-worker/wrangler.toml`.
2. Keep the cron at `0 13 * * *` if the desired lock time is 9 AM ET during World Cup 2026.
3. Update the comment to say `13:00 UTC = 9:00 AM ET during World Cup 2026`.
4. Open `sync-worker/index.js`.
5. Update comments/log labels from `Midnight Lock` to `Daily Odds Lock` or `9 AM Odds Lock`.
6. Keep the existing request URL compatible unless intentionally renaming endpoint params.
7. Prefer keeping `?midnightLock=true` to avoid breaking Pages route wiring, but comments/logs should no longer claim midnight.
8. If renaming the query param, update both worker and `functions/api/sync.js` in the same phase.

Gate checks:

- `sync-worker/wrangler.toml` cron remains `0 13 * * *`.
- Comments clearly say this is the 9 AM ET lock.
- Worker logs no longer say midnight unless the route param remains named `midnightLock`.
- Existing scheduled worker still calls the existing Pages route successfully.

## Phase 3: Add Shared Date/Lock Helpers In `sync.js`

Goal: Make all odds logic use one definition of “today ET” and “started”.

Tasks:

1. In `functions/api/sync.js`, add a helper near the odds functions:
   ```js
   function getEtDateString(dateInput) { ... }
   ```
2. `getEtDateString` must use `Intl.DateTimeFormat` with:
   - `timeZone: 'America/New_York'`
   - `year: 'numeric'`
   - `month: '2-digit'`
   - `day: '2-digit'`
3. Return format must be `YYYY-MM-DD`.
4. Add:
   ```js
   function getEtDayDiff(matchDateInput, nowInput = new Date()) { ... }
   ```
5. `getEtDayDiff` should compare ET calendar dates, not server-local dates.
6. Add:
   ```js
   function hasMatchStarted(match, nowMs = Date.now()) { ... }
   ```
7. `hasMatchStarted` should return `true` for non-scheduled, finished, already-started, missing-date, or invalid-date matches.

Gate checks:

- Helpers do not depend on server local timezone.
- Invalid or missing `local_date` does not allow odds updates.
- No behavior has changed yet except helper addition.
- `npm run build` passes.

## Phase 4: Prevent Odds Updates After Kickoff

Goal: No odds values can be changed once a match has started.

Tasks:

1. In `syncFromTheOddsAPI`, locate the existing locked-match skip.
2. Expand skip logic to skip locked, finished, non-scheduled, and started matches.
3. Use `hasMatchStarted(dbMatch)` for started/non-scheduled/finished logic.
4. Replace inline date-window logic with `getEtDayDiff`.
5. Keep the existing update window: today through next 2 ET days.
6. In `handleLockMatchTask`, allow locking after kickoff if needed, but do not change odds after kickoff.
7. In the daily lock function, allow today’s match to be locked after kickoff, but do not update odds values after kickoff.
8. Ensure `force=true` cannot bypass these rules.

Gate checks:

- `syncFromTheOddsAPI` skips started matches.
- `syncFromTheOddsAPI` skips live matches.
- `syncFromTheOddsAPI` skips finished matches.
- `syncFromTheOddsAPI` skips locked matches.
- `handleLockMatchTask` cannot change odds after kickoff.
- Daily lock cannot change odds after kickoff.
- `npm run build` passes.

## Phase 5: Fix Odds Update Persistence Bug

Goal: H2H-only odds changes must actually save.

Tasks:

1. In `syncFromTheOddsAPI`, find where H2H changes are logged.
2. Find where O/U changes are logged.
3. Create one boolean:
   ```js
   const oddsChanged =
     dbMatch.home_win_pct !== homePct ||
     dbMatch.away_win_pct !== awayPct ||
     dbMatch.draw_pct !== drawPct ||
     dbMatch.over_under_line !== ouLine ||
     dbMatch.over_odds !== overOdds ||
     dbMatch.under_odds !== underOdds;
   ```
4. Keep H2H logging in its own block.
5. Keep O/U logging in its own block.
6. Move the DB `UPDATE matches` enqueue outside the O/U-only block.
7. Only enqueue the update when `oddsChanged` is true.
8. Increment `matchesUpdated` once per enqueued update.
9. Do not increment `matchesUpdated` for logs only.

Gate checks:

- H2H-only changes enqueue a DB update.
- O/U-only changes enqueue a DB update.
- H2H plus O/U changes enqueue one DB update, not two.
- No-change odds data does not enqueue an update.
- `npm run build` passes.

## Phase 6: Make 9 AM Lock Lock All Today Matches

Goal: At 9 AM ET, every match scheduled for today ET becomes locked, even if odds data is missing or name matching fails.

Tasks:

1. In `handleMidnightLock` or the renamed lock function, load all unfinished and unlocked matches.
2. Compute:
   ```js
   const todayEt = getEtDateString(new Date());
   ```
3. Build:
   ```js
   const todayMatches = matches.filter(m => getEtDateString(m.local_date) === todayEt);
   ```
4. Keep a `Set` named `lockedTodayIds`.
5. Fetch The Odds API data as currently done.
6. For each matched odds fixture:
   - if match is today ET, it must be locked
   - if match has not started, odds values may be updated
   - if match has started, odds values must not be updated
7. For matched today matches, enqueue an update that sets `odds_locked = 1`.
8. If not started and odds changed, update odds values too.
9. If started, only set `odds_locked = 1`; do not change odds values.
10. After the odds loop, run a second pass over `todayMatches`.
11. For any today match not in `lockedTodayIds`, enqueue a lock-only update:
    ```sql
    UPDATE matches
    SET odds_locked = 1
    WHERE id = ?
    ```
12. This second pass must not change odds values.
13. Track counts:
    - `updated`
    - `locked`
    - `lockOnly`
    - `skippedStartedOdds`
    - `unmatchedToday`
14. Log the summary.
15. Clear matches cache and bump match version if any updates occurred.

Gate checks:

- A today ET match returned by The Odds API gets locked.
- A today ET match missing from The Odds API still gets locked.
- A today ET match with failed name matching still gets locked.
- A started today match gets locked but odds values are unchanged.
- A future match can have odds updated but does not get locked unless it is today ET.
- `npm run build` passes.

## Phase 7: Strict Validation For Prediction Writes

Goal: API callers cannot submit invalid predictions, and locked matches cannot be written through race conditions.

Tasks:

1. In `functions/api/predictions.js`, add local validation helpers near the top:
   - `isPositiveIntegerId`
   - `isNonNegativeInteger`
   - `isEnumValue`
2. Validate `participantId` and `matchId` before querying.
3. Require `participantId` and `matchId` to be positive integers.
4. Validate `predictedWinner` as one of `home`, `away`, `draw`.
5. Validate `predictedOverUnder` as one of `over`, `under`.
6. Validate score fields as non-negative integers.
7. Validate `predictedTotalCards` as a non-negative integer.
8. Validate `predictedFirstScorer` as one of `home`, `away`, `none`.
9. Validate `predictedHighestScoringHalf` as one of `first`, `second`, `equal`.
10. Validate `predictedCleanSheet` as one of `yes`, `no`.
11. Validate `predictedPenalties` as one of `yes`, `no`.
12. Return `400` with a clear error message for invalid payloads.
13. Check the participant exists before writing.
14. Return `404` if participant does not exist.
15. Keep existing response shape for successful saves.

Gate checks:

- Invalid participant ID returns `400`.
- Invalid match ID returns `400`.
- Invalid enum value returns `400`.
- Negative score returns `400`.
- Missing required prediction field returns `400`.
- Unknown participant returns `404`.
- Valid prediction still saves before lock.
- `npm run build` passes.

## Phase 8: Conditional Writes For Prediction Locking

Goal: Even if a match locks between read and write, the write must fail.

Tasks:

1. In `functions/api/predictions.js`, keep the existing match fetch for context.
2. Keep the early lock check for user-friendly error messages.
3. Add one `nowIso` before writing:
   ```js
   const nowIso = new Date().toISOString();
   ```
4. Replace separate insert/update logic with lock-safe conditional writes.
5. The write must only succeed if this is true at write time:
   ```sql
   EXISTS (
     SELECT 1 FROM matches
     WHERE id = ?
       AND status = 'scheduled'
       AND finished = 0
       AND datetime(local_date) > datetime(?)
   )
   ```
6. Use an `INSERT ... SELECT ... WHERE EXISTS ... ON CONFLICT DO UPDATE` approach if supported by D1 SQLite.
7. If that syntax is problematic, use conditional `UPDATE` for existing prediction and conditional `INSERT` for new prediction.
8. Inspect `result.meta.changes` after writing.
9. If zero rows changed because the match is now locked, return `403`.
10. Do not call `bumpVersion` unless the conditional write succeeds.
11. Do not log a prediction change unless the conditional write succeeds.
12. Flush logs after successful write.

Gate checks:

- Saving before kickoff succeeds.
- Saving after kickoff returns `403`.
- Saving when `status = 'live'` returns `403`.
- Saving when `finished = 1` returns `403`.
- A race where the match changes to live before the write results in `403`.
- Failed locked writes do not bump prediction version.
- Failed locked writes do not add prediction-change logs.
- `npm run build` passes.

## Phase 9: Strict Validation For Manual Match Writes

Goal: Manual match override cannot save invalid match state or invalid scoring values.

Tasks:

1. In `functions/api/matches.js`, add validation helpers:
   - positive integer ID
   - non-negative integer
   - finite number
   - enum validation
2. Validate `matchId` as positive integer.
3. Validate `homeScore` and `awayScore` as non-negative integers.
4. Validate halftime scores as either null/empty or non-negative integers.
5. Validate `status` as one of `scheduled`, `live`, `finished`.
6. Validate `finished` as boolean-like and normalize it to `0` or `1`.
7. Enforce consistency:
   - if `finished === 1`, status should be `finished`
   - if `status === 'finished'`, finished should be `1`
8. Validate odds percentage fields as finite numbers between `0` and `100`.
9. Validate `overUnderLine`, `overOdds`, `underOdds`, and `cardsLine` as finite non-negative numbers.
10. Validate `actualCards` as null/empty or non-negative integer.
11. Validate `actualFirstScorer` as null or one of `home`, `away`, `none`.
12. Return `400` for invalid payloads.
13. Ensure invalid `NaN` values never reach `.bind()`.

Gate checks:

- Invalid match ID returns `400`.
- Invalid status returns `400`.
- Negative score returns `400`.
- `NaN` odds returns `400`.
- Out-of-range percentage returns `400`.
- Valid manual update still works.
- `npm run build` passes.

## Phase 10: Protect Manual Odds Writes After Kickoff

Goal: Manual match override should not change odds after kickoff.

Tasks:

1. In `functions/api/matches.js`, fetch the existing match before applying updates.
2. Add a tiny local helper equivalent to `hasMatchStarted`.
3. Prefer duplicating this tiny helper over broad shared-module refactoring.
4. If the match has started, reject attempts to change odds fields with `400`.
5. Odds fields are:
   - `home_win_pct`
   - `away_win_pct`
   - `draw_pct`
   - `over_under_line`
   - `over_odds`
   - `under_odds`
   - `cards_line`
6. Still allow score/status/result fields to update after kickoff.
7. Log odds changes only when odds actually changed.
8. Do not let manual override unlock or change locked odds after kickoff.

Gate checks:

- Before kickoff, manual odds update works.
- After kickoff, manual score update works.
- After kickoff, manual odds-change request returns `400`.
- After kickoff, odds values remain unchanged.
- After kickoff, no odds-change log is created for rejected odds input.
- `npm run build` passes.

## Final Verification

Run:

```bash
npm run build
```

Run targeted lint:

```bash
npm run lint -- functions/api/sync.js functions/api/predictions.js functions/api/matches.js sync-worker/index.js
```

If targeted lint fails because of pre-existing repo lint rules, paste the full output and explain whether any failures are from changed code.

Manual/API checks to report:

- 9 AM worker schedule remains `0 13 * * *`.
- Daily lock comments/logs refer to 9 AM ET, not midnight.
- Today ET matches all become `odds_locked = 1`.
- Missing odds fixture still results in lock-only update.
- Odds are not changed for started/live/finished matches.
- `force=true` does not bypass post-kickoff odds protection.
- Invalid prediction payload returns `400`.
- Prediction save after lock returns `403`.
- Race-condition prediction write after status change returns `403`.
- Invalid manual match payload returns `400`.
- Manual score updates after kickoff still work.
- Manual odds updates after kickoff are rejected or blocked, never applied.

## Required Final Report

In your final response, include:

1. Files changed.
2. Phase gates passed.
3. Build result.
4. Targeted lint result.
5. Any pre-existing unrelated lint failures.
6. Confirmation that odds locking is still scheduled for 9 AM ET.
7. Confirmation that odds updates are impossible after kickoff.
8. Confirmation that locked-match prediction writes use conditional server-side writes.
