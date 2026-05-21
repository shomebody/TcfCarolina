================================================================================
                     TOP CHEF FANTASY CAROLINAS LEAGUE
                          COMPLETE APPLICATION README
================================================================================

This README provides a comprehensive, fine-grained, line-by-line architecture and 
feature overview of the Top Chef Fantasy Carolinas application. Every custom 
component, heuristic, mathematical scoring calculation, backend proxy service, 
scraper technique, database schema, and security rule has been meticulously reviewed
and documented below.

--------------------------------------------------------------------------------
TABLE OF CONTENTS
--------------------------------------------------------------------------------
 1. System Architecture Overview
 2. Environment & Config Variables
 3. Database Architecture (Firestore Collections & Schema)
 4. Firebase Security Rules (`firestore.rules`)
 5. Backend Proxy Server (`server.ts`)
 6. Front-End Core & Authentication
 7. Navigation & Responsive Layout
 8. Scoreboard & Standing Views
 9. Draft Ranking Accuracy Engine (Bell Curve RMSE Model)
10. The Snake Draft & Consensus Grading System
11. Drag-and-Drop Player Rankings (DnD-Kit Implementation)
12. Statistics & Scoring Rules
13. Wikipedia Scraper & Multi-Week Magic Sync Engine
14. Admin Control Panel Features
15. Verification & Quality Assurance

--------------------------------------------------------------------------------
1. SYSTEM ARCHITECTURE OVERVIEW
--------------------------------------------------------------------------------
The application is structured as a full-stack, real-time fantasy sports platform
specifically designed for "Top Chef: Carolinas". It consists of:
- A high-perf, real-time frontend powered by React 19, TypeScript, and TailwindCSS.
- A secure Express.js server on Node.js acting as a custom CORS-bypassing proxy for
  fetching Wikipedia and Fandom tournament datas.
- A persistent database and authentication backend managed via Google Firebase 
  (Firestore and Firebase Authentication).

--------------------------------------------------------------------------------
2. ENVIRONMENT & CONFIG VARIABLES
--------------------------------------------------------------------------------
The workspace uses standard configurations to guarantee deployment safety:
* `package.json`: Configures scripts:
  - `"dev"`: Runs TSX server (`tsx server.ts`).
  - `"build"`: Standard Vite compiler (`vite build`).
  - `"preview"`: Previewing compiled assets.
* `.env.example`: Documents requirements. No secrets are stored in version control.
* `firebase-applet-config.json`: Contains the target credentials details:
  - `apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`.
  - `firestoreDatabaseId`: Points to the specific database instance.

--------------------------------------------------------------------------------
3. DATABASE ARCHITECTURE (FIRESTORE COLLECTIONS & SCHEMA)
--------------------------------------------------------------------------------
The Firestore database uses 6 core collections, representing a complete relational
fantasy design laid over a NoSQL document database:

1. `chefs` [Collection] - Track individual Top Chef contestants.
   - `id` (string): Matches normalized name slug.
   - `name` (string): Chef's full name.
   - `hometown` (string): Chef's hometown or current city.
   - `status` ('active' | 'eliminated' | 'lck'): Status on the active show.
   - `totalScore` (number): Sum of all scores earned this season.
   - `imageUrl` (string/optional): Custom photo.

2. `players` [Collection] - Live players in the fantasy bracket league.
   - `id` (string): User's Firebase UID.
   - `name` (string): Human name loaded from login.
   - `displayName` (string/optional): Custom nickname set in user profile.
   - `draftOrder` (number): Order index in the Snake draft.
   - `chefIds` (array of strings): IDs of drafted chefs. Max of 2 chefs per player.
   - `totalScore` (number): Sum of their drafted chefs' points.
   - `email` (string): Authenticated email.
   - `photoURL` (string/optional): Avatar path.
   - `rankings` (array of strings): Ordered list of chef IDs representing pre-draft 
     preference list (used for draft queueing and accuracy score calculation).

3. `scoreEvents` [Collection] - Incremental points scored throughout the season.
   - `id` (string): Auto-generated unique event ID.
   - `chefId` (string): Target chef ID.
   - `week` (number): Episode/week number.
   - `type` (string): Action type (e.g. 'Elimination Win', 'Quickfire Win').
   - `points` (number): Score added or subtracted.
   - `description` (string): Clean human log of the performance.
   - `timestamp` (serverTimestamp): Verification point.

4. `playerStatuses` [Collection] - Real-time "Kitchen Confessional" comments.
   - `id` (string): Auto ID.
   - `playerId` (string): Player whose profile the confessional bubble is pinned to.
   - `userId` (string): Author's UID.
   - `userName` (string): Author's display name.
   - `text` (string): Comment content.
   - `timestamp` (serverTimestamp): Creation moment.

5. `polls` [Collection] - Engagement metrics.
   - `id` (string): Auto ID.
   - `question` (string): Poll topic.
   - `options` (array of strings): Selectable choices.
   - `votes` (map of userId -> optionIndex): Real-time collection of votes.
   - `active` (boolean): Whether the poll is currently accepting votes.
   - `createdAt` (string/ISO): Date stamp metadata.

6. `config` [Collection] - Config logs containing league system settings:
   - `config/league` [Document]:
     * `draftStarted` (boolean): Controls draft status toggle.
     * `draftCompleted` (boolean): Finalizes draft view.
     * `currentDraftTurn` (number): Pointer to the current pick of the Snake draft.
     * `draftOrder` (array of strings): Player IDs in draft order sequence.
     * `rankingsOpen` (boolean): Controls whether custom lists can be edited.
     * `rankingWeight` (number): Precision slider modifier for accuracy metrics.
     * `bonusScoresDisabled` (boolean): Toggle for accuracy bonus scores.
     * `inviteCode` (string): League security token.
   - `config/season` [Document]:
     * `maxWeek` (number): The modern week up to which the show's scores are parsed.
     * `scoringStartWeek` (number): Optional week filter to ignore early episodes.

--------------------------------------------------------------------------------
4. FIREBASE SECURITY RULES (`firestore.rules`)
--------------------------------------------------------------------------------
The database enforces strict client-side validation using role-based access levels:
* `isAuthenticated()` helper: Ensures requests present valid Auth tokens.
* `isAdmin()` helper: Constrains write operations to Garrett (`garrettlmiller@gmail.com`),
  or the backup hardcoded firebase UID `ewHQJbPdJkVxa5Onn40JYcKoaj22`.

Access Matrix Constraints:
* `chefs` collection:
  - Readable globally by any client.
  - Writable exclusively by Admins.
* `players` collection:
  - Readable globally.
  - Writable by admins or the player owning the matching record (`request.auth.uid == playerId`).
* `scoreEvents` collection:
  - Readable globally.
  - Writable exclusively by Admins.
* `config/league` & `config/season`:
  - Readable globally.
  - Config league writes require Admin credentials, with an exception allowing standard 
    authenticated clients to modify ONLY their draft sequence list when a draft is not in progress.
* `playerStatuses` (Kitchen Confessional list):
  - Readable globally.
  - Creates/updates require authentication. Enforces text body length limits between 
    1 and 500 characters and requires `userId` mapping directly to the authenticated UID.
  - Deletion is locked down to admins or the text's original author.
* `polls` collection:
  - Readable globally.
  - Creates, updates, and votes open to any authenticated user.

--------------------------------------------------------------------------------
5. BACKEND PROXY SERVER (`server.ts`)
--------------------------------------------------------------------------------
To overcome the CORS (Cross-Origin Resource Sharing) restrictions that browsers 
enforce on third-party APIs like Wikipedia, a dedicated Express endpoint is built:
* `/api/proxy` Endpoint:
  - Accepts a `url` query parameter.
  - Performs server-to-server fetches using a highly customized `User-Agent` string:
    `TopChefFantasyLeagueBot/1.1 (https://ais-pre-2ujt7kexusvm2mwfd33joa-256349775206.us-east1.run.app; contact: GarrettLMiller@gmail.com) node-fetch/1.0`
  - Leverages the strict User-Agent convention required by the Wikimedia Foundation API.
  - Proxies headers, handles encoding gracefully, and routes raw content directly to the scraper.

--------------------------------------------------------------------------------
6. FRONT-END CORE & AUTHENTICATION
--------------------------------------------------------------------------------
The front-end client leverages optimized modern libraries to coordinate complex features:
* Web Firebase Driver (`src/firebase.ts`):
  - Sets up standard SDK initialized connections.
  - Employs `experimentalForceLongPolling: true` during initialization! This 
    force-option avoids WebSocket disconnection loops and proxy dropouts commonly 
    experienced in container environments.
* Error Boundaries:
  - Encapsulates the entire view in an `<ErrorBoundary>` fall-through component.
  - Logs unhandled exceptions, exposes error details, and presents clean, 
    low-stress refresh flows.
* Multi-State Auth listeners:
  - Coordinates Auth using `GoogleAuthProvider` with standard `signInWithPopup`.
  - Seamlessly logs out using `signOut`.

--------------------------------------------------------------------------------
7. NAVIGATION & RESPONSIVE LAYOUT
--------------------------------------------------------------------------------
The application is styled with TailwindCSS utility rules employing highly optimized 
negative margins, typography weight structures, and dark backgrounds:
* Navigation Bar Structure:
  - Responsive layout serving desktop sideboards or compact mobile bottom-nav drawers.
  - Provides direct tabs: `Scoreboard (Trophy)`, `Rankings (List)`, `Draft (Users)`, 
    `Stats (Chart)`, `Scoring Rules (Info)`, and a specialized `Sync/Admin (Zap)` tab.
* Quick-Sync Fixed Button:
  - If a user is registered as an Admin, a prominent, high-contrast `<motion.button>`
    is anchored in the layout with a floating "Sync Season" hover card.
  - Enables one-click data updates instantly at any stage of show monitoring.

--------------------------------------------------------------------------------
8. SCOREBOARD & STANDING VIEWS
--------------------------------------------------------------------------------
The scoreboard tab contains multiple subsections to maximize fantasy league engagement:
1. "Leaderboard" Sub-Tab:
   - Rank-staggered player roster showing total points (including accurate pre-season 
     accumulations), historical progress indicators, and claimed Profiles.
   - If a player has a profile in the draft list but hasn't logged in yet, they can 
    "Claim Profile" upon logging in with Google.
2. "Chef Ranks" Sub-Tab:
   - Renders a responsive grid of competitors and their score lines.
   - Highlights their status (Active, Eliminated, or competing inside LCK / Last Chance Kitchen).
3. "Ranking Accuracy" Sub-Tab:
   - Evaluates a player's initial ranking predictions. Displays the Root Mean 
     Squared Error (RMSE) value of their board and details points awarded.
4. "Episodes" Sub-Tab:
   - Timeline log detailing every week's custom scored occurrences, showing which 
     cook performed which action, and tracking descriptive outputs.

--------------------------------------------------------------------------------
9. DRAFT RANKING ACCURACY ENGINE (BELL CURVE RMSE MODEL)
--------------------------------------------------------------------------------
A unique competitive feature is the auto-accuracy prediction metric. It awards 
bonus fantasy points to players based on how closely their pre-draft rankings 
match the actual cumulative end-of-season performance of every chef.

Mathematical Logic:
* Baseline actual list matching:
  - The actual list of chefs is sorted by `totalScore` (descending), whether they 
    are active (`'active'` > inactive as tiebreaker), and alphabetically by name.
* Handling missing/unsubmitted chefs:
  - If a player leaves chefs out of their ranking board, the missing chefs are added
    to the bottom and sorted strictly alphabetically. This prevents users from 
    getting accidental accuracy matches for skipped/unranked contestants.
* Root Mean Squared Error (RMSE) Calculation:
  - For each chef in a player's list, let $P_{\text{index}}$ be the rank assigned by 
    the player, and $A_{\text{index}}$ be the actual final rank.
  - The squared distance is consolidated as:
    $D^2 = \sum (P_{\text{index}} - A_{\text{index}})^2$
  - The Root Mean Squared Error is computed as:
    $\text{RMSE} = \sqrt{\frac{D^2}{N}}$  (where $N$ is the number of chefs)
* Gaussian / Bell Curve Function Scorer:
  - To award points smoothly instead of harshly penalizing single-position swaps, the 
    formula applies a Gaussian kernel density estimator with a standard deviation ($\sigma$) 
    set to $4$:
    $\text{Raw Accuracy} = e^{-\frac{\text{RMSE}^2}{2\sigma^2}}$
* Normalization and Bonus payout:
  - The raw accuracy is normalized against the very best predictor in the league:
    $\text{Normalized Accuracy} = \frac{\text{Raw Accuracy}}{\text{Top Raw Accuracy}}$
  - The player's bonus is computed dynamically:
    $\text{Ranking Bonus} = \text{Math.round}(\text{Max Chef Score} \times \text{Normalized Accuracy})$
  - Display score updates seamlessly to present $Score_{\text{total}} + RankingBonus$.

--------------------------------------------------------------------------------
10. THE SNAKE DRAFT & CONSENSUS GRADING SYSTEM
--------------------------------------------------------------------------------
The Draft center controls automatic, semi-automatic, and manual live selection:
* Standard Snake Layout Pattern:
  - Automatically reverses selecting order upon round transitions.
  - Turn calculation:
    `round = Math.floor(turn / players.length)`
    `indexInRound = turn % players.length`
    `playerIndex = (round % 2 === 0) ? indexInRound : (players.length - 1 - indexInRound)`
* Live Selector Board:
  - Disables unavailable chefs and isolates active players.
  - Features real-time visual "Draft Turn" markers so viewers know who is drafting.
* Automated Draft Tools:
  - Admin "Auto Draft Active Turn": Uses the current picker's custom pre-draft 
    ranking board to draft their highest-ranked available contestant.
  - Admin "Full Auto Draft": Runs the entire snake draft algorithm instantly 
    using each league player's customized pre-draft ranking list in real-time.
* Consensus Draft Value & Grading Model:
  - After the draft completes, the software reviews drafts and prints Grades (A+ down to D).
  - Average consensus rating for each chef is calculated across all player submittals.
  - Expected draft turn is linked to average rank ($Y$), and actual pick turn ($X$).
  - Draft Pick Value is computed as: $\text{Value} = X_{\text{actual}} - Y_{\text{expected}}$
  - Total Draft Score value represents: $Value_{\text{Pick 1}} + Value_{\text{Pick 2}}$
  - Custom Grade Scale:
    - $> 5.0$  : A+  (Outstanding value drafted later than consensus expected)
    - $> 3.0$  : A
    - $> 1.0$  : B+
    - $> -1.0$ : B
    - $> -3.0$ : C+
    - $> -5.0$ : C
    - $\le -5.0$: D   (Drafted reach relative to consensus averages)

--------------------------------------------------------------------------------
11. DRAG-AND-DROP PLAYER RANKINGS (DND-KIT IMPLEMENTATION)
--------------------------------------------------------------------------------
The layout uses `@dnd-kit` to allow users to build and test their pre-draft preference:
* Collision & Sensor Configuration:
  - Uses `PointerSensor` configured with an initialization threshold `distance: 8` 
    to separate clicks from drag starts.
  - Employs a dedicated `TouchSensor` with a custom `delay: 250` milliseconds and 
    `tolerance: 5` pixels to guarantee silky-smooth dragging on mobile.
  - Combines `KeyboardSensor` mapped to `sortableKeyboardCoordinates` for keyboard access.
* Drag Locks:
  - Locks out and disables rankings edits automatically once the admin switches 
    off `rankingsOpen` in the database configuration.

--------------------------------------------------------------------------------
12. STATISTICS & SCORING RULES
--------------------------------------------------------------------------------
* Consensus Rankings Screen:
  - Summarizes the overall league sentiment. Displays consensus ranking averages in 
    a highly legible typography card.
* Detailed Points Rubric:
  - Informs players of positive and negative point thresholds details.
  - Displays points visually using color-coded chips (green vs red).

--------------------------------------------------------------------------------
13. WIKIPEDIA SCRAPER & MULTI-WEEK MAGIC SYNC ENGINE
================================================================================
The sync engine uses advanced processing to parse Wikipedia wikitext dynamically 
on the client, matching complex table markup without structured database APIs.

Wikipedia Scraper Details & Cleaning Heuristics:
1. Strips custom bracket links: `[[File:...]]` or `[[Link|Text]]` -> `Text`.
2. Resolves template tags: `{{sortname|First|Last|...}}` -> `First Last`.
3. Strips markup: `{{color|...|text}}` -> `text` and `{{nowrap|text}}` -> `text`.
4. Sanitizes custom cell templates: `{{Table cell|STATUS|...}}` or any nested cell styles.
5. Cleans leftover markup/HTML tags (like `<br />`, `&nbsp;`, references `<ref>`).

Competition Association heuristics:
* Iterates through row blocks split by table lines (`|-` or `{{Top Chef progress table row`).
* Resolves chef name matching:
  - Implements an indexer that runs an exact matches check first.
  - If no exact database match is found, it falls back to partial name checks 
    (e.g., "Savannah" is mapped successfully to "Savannah Miller").
  - Identifies double names/middle names and handles lowercase conversion.
* Extracts Episode columns:
  - Automatically isolates "Quickfire (QF)" and "Elimination (EL)" markers (such as 
    `WIN`, `HIGH`, `LOW`, `OUT`, `LCK`, `IN`).
  - Maps status parameters to point values dynamically as defined by SCORING_RULES.

The Magic Sync Pipeline:
* Check Missing Weeks: Pulls existing `scoreEvents` from Firestore and filters the 
  parsed episodes to identify missing weeks.
* Transaction Operations: For each missing episode/week, it runs a transaction block:
  - Increments active Chef total scores.
  - Updates Chef status (`active`, `eliminated`, `lck`) based on current week status.
  - Writes individual custom `scoreEvents` documents.
  - Re-calculates and increments Player total scores if the current episode's week 
    is $\ge$ `config.scoringStartWeek`.
* Update State: Registers `maxWeek` in Firestore configuration to update the 
  leaderboard headers.

--------------------------------------------------------------------------------
14. ADMIN CONTROL PANEL FEATURES
--------------------------------------------------------------------------------
The administrative panel allows managers to:
* Set League Configurations: Toggle `draftStarted`, toggle `rankingsOpen`, enable/disable 
  accuracy bonus scores, edit rankings weights, and alter league Invite Code.
* Force Draft Control: Manually select/force a draft pick for any player at any time.
* Add Manual Scores: Create custom events or overrides directly.
* Reset/DANGER Controls:
  - Force Full Re-Sync: Clears ALL scoreEvents from the database, resets all chef + player 
    scores to zero, and executes a clean Wikipedia Scraper import for the entire season.
  - Reset League Draft: Fully wipes all drafted chefs and clears database draft markers 
    to allow drafting from scratch.

--------------------------------------------------------------------------------
15. VERIFICATION & QUALITY ASSURANCE
--------------------------------------------------------------------------------
* Linter Checked: Verified through strict TypeScript compiler rules.
* Vite Bundler Compliant: Fully verified inside Vite bundle configurations.
================================================================================
