# TcfCarolina — Persistent Project Memory for Claude

> **Future Claude: read this whole file before touching anything in this repo.** It's the durable contract for this project. The deployed website, Firestore database, and Garrett's workflow assumptions all live here.

---

## 1. What this is

A private fantasy-Top-Chef league site for ~7 personal friends. **Not a product.** No scaling, no public users, no growth concerns. The league plays one season per year — one new Top Chef season is added each year, the friends draft chefs, points accrue weekly, a winner is crowned, then it sits dormant until the next show airs.

- **Live URL:** Firebase Hosting on the `tcf-22` project (hostname auto-resolves through Firebase).
- **Repo:** `shomebody/TcfCarolina` on GitHub. This local working tree at `/Users/garrettlmiller/TcfCarolina` is the source of truth.
- **Current season:** Top Chef: Carolinas (S22). Garrett expected this to be the last season covered by the current Firestore project — next season will likely use a fresh project + repo (see Section 11).

## 2. The user — Garrett

- **Not a programmer.** Cannot review code or diffs. Cannot validate whether a function is right by reading it.
- **Has ADHD; prefers concrete, opinionated, direct answers.** Skip hedging. Skip "let me know if you have questions." Just do the work, explain in plain English what you did, and tell him what to click.
- **Email / admin identity:** `garrettlmiller@gmail.com` (the firestore.rules pin admin writes to this email plus a backup UID).
- **What "working" means to him:** the live scoreboard reflects what actually happened on the show. He does not care about code quality, abstractions, or test coverage.

**This means you (Claude) are responsible for verification.** Lint, build, run the audit script, click through the live admin UI, and only then tell Garrett something is done.

## 3. Workflow — single source of truth

**Always:** edit local → commit → `git push origin main` → Firebase Hosting auto-redeploys from GitHub.

**Never:**
- Use Google AI Studio. It was previously the editing path and produced months of divergence between local and GitHub. AI Studio is retired as of 2026-05-21.
- Skip the local commit step. The deploy is GitHub-driven.
- Bypass `firestore.rules`. They protect Garrett from accidentally letting the world write to his DB.
- Run `Clear All Scores` (line ~4768 in `src/App.tsx`). It exists as an emergency nuke; assume nobody ever wants that fired again. Never run it without explicit, repeated confirmation from Garrett.

**Before any session of work, sanity-check:**
```bash
git fetch origin && git status
git log --oneline -5
git log --oneline -5 origin/main
```
If local and `origin/main` have diverged, **stop and reconcile before editing**. There was a major divergence in May 2026 that took an explicit hard-reset to fix; don't recreate that mess.

## 4. Tech stack

- **Frontend:** React 19, Vite 6, TailwindCSS 4, `@dnd-kit` (drag-and-drop for rankings), `motion` (animations), `lucide-react` (icons).
- **Backend proxy:** `server.ts` — an Express server providing `/api/proxy?url=...` to bypass CORS when scraping Wikipedia. Runs locally via `npm run dev`. In production, Vite serves the SPA out of `dist/` after `npm run build`.
- **Database & auth:** Firebase project `tcf-22`. Firestore is a **non-default database** named `ai-studio-06434889-9c52-465f-a4aa-ccd676c98dcd`. Auth is Google Sign-In only.
- **Firebase web config:** `firebase-applet-config.json` — committed to the repo, contains the public API key (this is OK for Firebase web apps; security comes from rules).
- **Deployment:** Firebase Hosting + a Cloud Run frontend container (Gemini's older AI-Studio container, still active as of 2026-05).

### Scripts
- `npm run dev` — local dev server on port 3000 (via `tsx server.ts` + Vite middleware).
- `npm run build` — production Vite build into `dist/`.
- `npm run lint` — `tsc --noEmit` type-check. Must pass before every commit.
- `npm run preview` — preview the production build.
- `node scripts/audit.mjs` — **read-only Firestore audit.** Run after any data-modifying operation. Writes a `report.md` and JSON dumps to `audit/<timestamp>/`.

### Key files (line numbers as of 2026-05-21; may drift)

The entire React app lives in **one file**: `src/App.tsx` (5,651 lines). **Do not refactor it into modules without Garrett's explicit OK.** Churn introduces risk Garrett can't verify. Patch in place.

- `types`: 196–230 — `Chef`, `Player`, `ScoreEvent`, `LeagueConfig`
- `SCORING_RULES`: 242–254 — the canonical point values. Use this as the source of truth.
- `App` (root component): 571–
- `ScraperTool` (magic sync): 3139–4518
- `AdminView`: 4519–5651 (`handleAddScore` at 4579, `clearAllScores` near 4768)

## 5. Firestore schema (authoritative)

| Collection | Document ID | Read | Write | Purpose |
|---|---|---|---|---|
| `chefs` | auto | public | admin | Contestants. Schema: `name: string`, `hometown: string`, `status: 'active' \| 'eliminated' \| 'lck'`, `totalScore: number` (cache), `imageUrl?: string`. |
| `players` | Firebase Auth UID | public | admin OR self | League members. Schema: `name`, `displayName?`, `email`, `photoURL?`, `draftOrder: number`, `chefIds: string[]` (drafted chefs, max 2), `totalScore: number` (cache), `rankings?: string[]` (preseason chef-id rank list). |
| `scoreEvents` | auto | public | admin | **Canonical record of all scoring.** Schema: `chefId: string`, `week: number`, `type: string` (must match a `SCORING_RULES.type`), `points: number`, `description: string`, `timestamp: serverTimestamp`. |
| `playerStatuses` | auto | public | author or admin | "Kitchen Confessional" comments. Schema: `playerId`, `userId`, `userName`, `text` (1–500 chars), `timestamp`. |
| `polls` | auto | public | any authenticated | Engagement polls. Schema: `question`, `options: string[]`, `votes: map<userId, optionIndex>`, `active: boolean`. |
| `config/league` | fixed | public | admin (one exception) | League config. Schema: `draftStarted`, `draftCompleted`, `currentDraftTurn`, `draftOrder: string[]`, `rankingsOpen`, `rankingWeight?`, `inviteCode?`, `bonusScoresDisabled?`, `scoringStartWeek?`. **Exception:** authenticated users may update **only** `draftOrder` while `draftStarted == false`. |
| `config/season` | fixed | public | admin | Per-season knobs. Schema: `maxWeek: number`, `scoringStartWeek?: number`. |

## 6. The scoring contract — non-negotiable

**`scoreEvents` is canonical. `chef.totalScore` and `player.totalScore` are derived caches.**

> For every chef: `chef.totalScore` MUST equal the sum of `event.points` across all `scoreEvents` with `event.chefId === chef.id` **AND `event.week >= config.scoringStartWeek`**. Events before `scoringStartWeek` exist in the database but intentionally don't count toward totals. For S22, `scoringStartWeek = 2` (W1 events are ignored). If totals drift from this sum, the caches are wrong, not the events.

> For every player: `player.totalScore` MUST equal the sum of `chef.totalScore` for each `chefId` in `player.chefIds`. The live UI recomputes this at render time (`src/App.tsx:488` or thereabouts), so a drift in `player.totalScore` won't visibly break the scoreboard but indicates a bug somewhere.

### Scoring rules (constants in `src/App.tsx`)
| `type` value (must match exactly) | Points | When |
|---|---:|---|
| `Quickfire Win` | +5 | Chef won the Quickfire challenge |
| `Quickfire Favorite` | +2 | Chef was a top mention in QF |
| `Quickfire Least Favorite` | −1 | Chef was a bottom mention in QF |
| `Elimination Win` | +7 | Chef won the Elimination challenge ("WIN" in wiki table) |
| `Episode Sweep Bonus` | +3 | Chef won BOTH `Quickfire Win` and `Elimination Win` in same week |
| `Judges Table Top` | +4 | "HIGH" in wiki table |
| `Judges Table Bottom` | −2 | "LOW" in wiki table |
| `Last Chance Kitchen Win` | +2 | Chef won one LCK round (each round scores separately) |
| `Making Season Finale` | +15 | Chef is a finalist (runner-up at finale) |
| `Winning Top Chef` | +30 | Chef wins the season |
| `Eliminated` | −2 | "OUT" in wiki table. Also covers `MED` (medical removal) by Garrett's call. |

### Ranking-accuracy bonus (`calculatePlayerAccuracy` in `App.tsx`)

The bonus rewards pre-draft prediction skill. As of 2026-05-22 the contract is:

1. **Field excluded of owned chefs.** Each player's RMSE is computed over the chefs they did NOT draft. Drafting good chefs already pays out via chef performance; the bonus is for predicting the rest of the field. This prevents the double-dip where a player who drafted a top chef and ranked them #1 got paid twice for the same insight.
2. **Absolute, not normalized.** `rawAccuracy = exp(-RMSE² / (2σ²))` with σ=3. Each player's bonus depends only on their own predictions, not on how well the best predictor in the league did.
3. **Cap at +20.** Bonus = `round(rawAccuracy × 20)`. Smaller than `Winning Top Chef` (30) so it can never dominate the chef-performance signal. Tunable via the `BONUS_MAX` constant if a future league wants more or less weight on predictions.
4. **`config.bonusScoresDisabled`** can turn the whole thing off.

When changing the constants (σ or BONUS_MAX), preview the impact against current data before deploying — `scripts/audit.mjs` doesn't model the bonus, but a small `node -e` script can.

### Status semantics
- `active`: still competing on the main show.
- `lck`: was eliminated, is currently competing in Last Chance Kitchen.
- `eliminated`: out for good (either lost the main show finale, or lost LCK).

**Trick cases that have already burned the scoring code:**
- Re-entry via LCK: if a chef wins enough LCK rounds to return (e.g., Rhoda in S22), the status transitions `active → eliminated → lck (implicit, often not tracked) → active`. Her `Eliminated` event still stands; her `Last Chance Kitchen Win` events log the return path.
- Re-entry due to medical/withdrawal of another chef: in S22, Sieger was reinstated after Jennifer was medically removed and Justin declined her finalist spot. **There is no scoring event for this kind of reinstatement** — just flip `chef.status` back to `active`.
- Medical removal: treated as `Eliminated` (−2) per Garrett's call in S22. Document this each season.

## 7. The "magic sync" feature — what it is, and how to think about it

**Location:** `ScraperTool` component, `src/App.tsx:3139–4518`.

**What it does:** Fetches the raw wikitext for the current Top Chef season's Wikipedia page (via the `/api/proxy` server endpoint to bypass CORS), parses the "Contestant progress" table, infers each chef's per-week result (WIN/HIGH/LOW/OUT/LCK/IN), maps to scoring rules, and writes `scoreEvents` to Firestore in a single transaction.

**Why it has been "playing whack-a-mole":** Wikipedia table markup is *not* a stable schema. Editors change the template, add notes, reorder columns. Every change can silently shift what the parser sees, with no fail-loud signal — events just go missing, get duplicated, or land on the wrong chef. Past failure modes (all observed in S22):
- Wrote `type: "Top"` / `type: "Bottom"` instead of canonical `"Judges Table Top"` / `"Judges Table Bottom"` → 51 events with non-canonical labels.
- Didn't write `Episode Sweep Bonus` events when a chef swept; instead silently added +3 to `chef.totalScore`, causing drift.
- Didn't write `Last Chance Kitchen Win` events at all — LCK is in a separate wiki section the scraper doesn't read.
- Status field updates can re-activate chefs incorrectly when a later week's apply happens before an earlier one.

**Treat magic sync as untrusted assistive input, not the canonical scoring path.** Workflow:
1. Click magic sync to draft events into the DB.
2. Run `node scripts/audit.mjs` to surface inconsistencies.
3. Cross-check the chef-by-chef event listing against the actual show.
4. Fill in gaps manually via the admin **Add Score** form.
5. Click **Recompute Totals** in the admin panel to make cached totals match the sum of events.

Do not invest in rewriting the scraper unless Garrett explicitly asks. It's load-bearing for one click per week and not worth the effort.

## 8. The admin tools you (Claude) have to work with

In `AdminView` (`src/App.tsx:4519+`):
- **Add Score** — manual single-event entry. Updates chef + player totals atomically.
- **Score History** — list/delete existing events with atomic total reversal. *(Added 2026-05-21.)*
- **Audit Live Data** — read-only diagnostic showing drift, duplicates, unknown types. *(Added 2026-05-21.)*
- **Apply Season Repair** — one-time idempotent fix for the specific known gaps in S22 data. *(Added 2026-05-21; will likely be removed or replaced before S23.)*
- **Recompute Totals** — sets `chef.totalScore = sum(events)` and `player.totalScore = sum(owned chef totals)`. Run this any time you suspect drift. **Safe and idempotent.** *(Added 2026-05-21.)*
- **Clear All Scores** — emergency nuke. Two-click confirm. **Never run.**
- Manage Chefs, Bulk Rename, Magic Sync (Scraper), Draft Order editor, etc.

## 9. How to verify a change end-to-end

After any code or data change:
1. `npm run lint` — must exit 0.
2. `npm run build` — must produce a clean `dist/`.
3. `node scripts/audit.mjs` — open the generated `report.md`, confirm no ❗ rows.
4. For UI changes: `npm run dev`, open `http://localhost:3000`, log in as admin, click through the affected admin section. Type-check is not enough — exercise the actual click path.
5. Only after all of the above: commit and push.

## 10. Known hazards (snapshot)

These are sharp edges I (Claude, 2026-05-21 session) am aware of. Update or remove as the codebase evolves.

- `handleAddScore` (`src/App.tsx:4579`) does not check for duplicate `(chefId, week, type)` triples. Adding the same event twice will silently double-count.
- `handleAddScore` resets `chef.status` to `'active'` on any non-`Eliminated` event. So adding a "Top" event for a previously eliminated chef will bring them back to life. Bug. Don't add retroactive events for eliminated chefs unless you also fix status afterward.
- Magic sync (`applyScrapedResults`, around line 3370+) updates `chef.status` based on parsed wiki data without ordering guarantees — re-running for an earlier week after a later week was already applied can flip status incorrectly.
- `clearAllScores` is wired to a button. Two-click confirm exists. Don't touch.
- **`handleMergePlayers`** does not validate that the two players don't already own the same chef. If they somehow do (shouldn't happen via the draft flow, but possible via admin manipulation), the merge will silently keep the duplicate in `chefIds`. Add an overlap check before merging if you ever touch this.
- **`RankingView`** saves the player's `rankings` array without filtering out chef IDs that no longer exist in the `chefs` collection. If a chef is renamed/deleted while a player has the ranking page open, their saved rankings can contain ghost IDs. They render as blank/skip and silently lower the player's accuracy. Filter `rankings.filter(id => chefs.some(c => c.id === id))` on save.
- **Magic sync (`ScraperTool`)** silently writes a malformed chef name if a Wikipedia editor makes a templating typo. Always click Parse & Preview first; eyeball the parsed names; only then Apply.
- **`handleAutoDraft` / `handleFullAutoDraft`** fall back to "first available chef" if a player has no `rankings` set. Nondeterministic feel; not a bug. If you re-seed the league for next season, make sure every player has rankings before running auto-draft.
- **`config.season.maxWeek`** is not validated against `max(scoreEvents.week)`. The "Through Week N" header can drift if you ever set `maxWeek` manually. Reconcile by hand if it looks wrong.
- **Invite code check** in `handleJoinLeague` is case-sensitive. Trivial to live with; trivial to fix (`code.toLowerCase() === config.inviteCode.toLowerCase()`).
- **`ProfileModal`** image upload uses a heuristic (~800KB cap). Possible "image too big" error post-edit instead of pre-edit. Minor UX.
- **`AccuracyItem` and `CompactAccuracyItem`** duplicate the same ~120 lines of breakdown math. Extract a shared helper if you ever change the accuracy logic.
- **`DraftView`** doesn't visually highlight the current picker in the draft-order list, only in the available-chefs section. Players have to count manually.
- **`ProgressTable`** doesn't show Episode Sweep Bonus as its own cell label (the cell still says "WIN" for the elim win). The +3 IS included in the cell's points total and the hover tooltip. Cosmetic only.
- The non-default Firestore database ID (`ai-studio-06434889-9c52-465f-a4aa-ccd676c98dcd`) is **easy to forget**. The web SDK in `src/firebase.ts` reads it from `firebase-applet-config.json`. Any new tooling must do the same — `getFirestore(app, dbId)`, never plain `getFirestore(app)`.
- The Vite build emits a single ~1MB chunk. That's a known warning, not a bug. Don't chase code-splitting unless Garrett asks.

## 11. Rolling forward to a new season

When the next Top Chef season starts (likely S23 in 2027), Garrett will want to play the league again. Likely tasks:

1. Decide whether to **reset the existing `tcf-22` Firestore project** for the new season, **or spin up a fresh Firebase project + repo** (cleaner separation between seasons; recommended).
2. If resetting: use the `Clear All Scores` button (this is the legitimate use case) and re-seed `chefs` with the new contestants.
3. Update `INITIAL_PLAYERS` array if the friend roster changes.
4. Update `TOP_CHEF_SEASONS` in `ScraperTool` with the new season's Wikipedia URLs.
5. Update the Scoring page if rules change between seasons.
6. Verify the show schedule (number of episodes, LCK format) — different seasons handle LCK differently.

## 12. Conventions for Claude in this repo

- **Patch, don't refactor.** No unrequested module extractions, no rewriting `App.tsx` into smaller files, no test scaffolding.
- **Plain-English summaries.** After every meaningful change, tell Garrett in 1–3 sentences what you did and what to verify.
- **No emojis in code or commits** unless explicitly requested.
- **Commits via HEREDOC** for clean formatting; tag with `Co-Authored-By: Claude <noreply@anthropic.com>` when you're the author of the change.
- **Destructive ops require explicit pause-and-confirm**, even when broadly authorized. Specifically: `git reset --hard`, `Clear All Scores`, force-push, dropping Firestore documents.
- **No Firestore writes from the terminal.** Use the admin UI tools. The terminal can read (rules allow public reads) but can't authenticate as admin without setting up gcloud ADC or a service account, neither of which is currently configured. If a future task genuinely needs terminal-side writes, set up `gcloud auth application-default login` and use `firebase-admin`.

---

*Last meaningful update: 2026-05-21 by Claude (session repairing S22 scoring before the finale). If significant architectural changes happen, please update this file in the same commit.*
