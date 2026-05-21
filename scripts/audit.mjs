#!/usr/bin/env node
/**
 * Read-only Firestore audit for the TcfCarolina league.
 *
 * Pulls every chef, player, score event, and config doc; writes raw JSON
 * dumps plus a plain-English report to audit/<timestamp>/.
 *
 * Run with:  node scripts/audit.mjs
 *
 * No writes. Safe to run repeatedly.
 */

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, getDoc } from 'firebase/firestore';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const config = JSON.parse(
  await readFile(path.join(repoRoot, 'firebase-applet-config.json'), 'utf8')
);

const app = initializeApp(config);
const db = getFirestore(app, config.firestoreDatabaseId);

const ts = new Date().toISOString().replace(/[:.]/g, '-').replace(/T/, '_').slice(0, 19);
const outDir = path.join(repoRoot, 'audit', ts);
await mkdir(outDir, { recursive: true });

const dump = async (collName) => {
  const snap = await getDocs(collection(db, collName));
  const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  await writeFile(path.join(outDir, `${collName}.json`), JSON.stringify(docs, null, 2));
  return docs;
};

console.log('Fetching Firestore data...');
const [chefs, players, scoreEvents] = await Promise.all([
  dump('chefs'),
  dump('players'),
  dump('scoreEvents'),
]);

const leagueSnap = await getDoc(doc(db, 'config', 'league'));
const seasonSnap = await getDoc(doc(db, 'config', 'season'));
const configLeague = leagueSnap.exists() ? leagueSnap.data() : null;
const configSeason = seasonSnap.exists() ? seasonSnap.data() : null;
await writeFile(
  path.join(outDir, 'config.json'),
  JSON.stringify({ league: configLeague, season: configSeason }, null, 2)
);

console.log(`  chefs:        ${chefs.length}`);
console.log(`  players:      ${players.length}`);
console.log(`  scoreEvents:  ${scoreEvents.length}`);
console.log(`  config/league: ${configLeague ? 'present' : 'MISSING'}`);
console.log(`  config/season: ${configSeason ? 'present' : 'missing (optional)'}`);

const SCORING_RULES = new Map([
  ['Quickfire Win', 5],
  ['Quickfire Favorite', 2],
  ['Quickfire Least Favorite', -1],
  ['Elimination Win', 7],
  ['Episode Sweep Bonus', 3],
  ['Judges Table Top', 4],
  ['Judges Table Bottom', -2],
  ['Last Chance Kitchen Win', 2],
  ['Making Season Finale', 15],
  ['Winning Top Chef', 30],
  ['Eliminated', -2],
]);

// --- Drift: chef.totalScore vs sum of scoreEvents.points ---
// Respects config.league.scoringStartWeek (events before this week don't count).
const startWeek = configLeague?.scoringStartWeek ?? 1;
const chefSums = new Map();
for (const ev of scoreEvents) {
  if (ev.week >= startWeek) chefSums.set(ev.chefId, (chefSums.get(ev.chefId) || 0) + (ev.points || 0));
}
const chefDrift = [];
for (const chef of chefs) {
  const stored = chef.totalScore ?? 0;
  const summed = chefSums.get(chef.id) ?? 0;
  if (stored !== summed) {
    chefDrift.push({ chefId: chef.id, name: chef.name, stored, summed, delta: stored - summed });
  }
}

// --- Duplicate (chefId, week, type) score events ---
const tripleMap = new Map();
for (const ev of scoreEvents) {
  const key = `${ev.chefId}|${ev.week}|${ev.type}`;
  if (!tripleMap.has(key)) tripleMap.set(key, []);
  tripleMap.get(key).push(ev);
}
const duplicates = [];
for (const [key, evs] of tripleMap) {
  if (evs.length > 1) {
    const [chefId, week, type] = key.split('|');
    const chefName = chefs.find((c) => c.id === chefId)?.name ?? '(unknown)';
    duplicates.push({
      chefId,
      chefName,
      week: Number(week),
      type,
      count: evs.length,
      eventIds: evs.map((e) => e.id),
      points: evs.map((e) => e.points),
    });
  }
}

// --- Unknown event types (not in SCORING_RULES) ---
const unknownTypes = scoreEvents
  .filter((ev) => !SCORING_RULES.has(ev.type))
  .map((ev) => ({
    eventId: ev.id,
    chefId: ev.chefId,
    chefName: chefs.find((c) => c.id === ev.chefId)?.name ?? '(unknown)',
    week: ev.week,
    type: ev.type,
    points: ev.points,
  }));

// --- Points mismatch: event.points != SCORING_RULES[event.type] ---
const pointsMismatch = scoreEvents
  .filter((ev) => SCORING_RULES.has(ev.type) && ev.points !== SCORING_RULES.get(ev.type))
  .map((ev) => ({
    eventId: ev.id,
    chefId: ev.chefId,
    chefName: chefs.find((c) => c.id === ev.chefId)?.name ?? '(unknown)',
    week: ev.week,
    type: ev.type,
    stored: ev.points,
    expected: SCORING_RULES.get(ev.type),
  }));

// --- Player drift (DB-stored player.totalScore vs sum of their chefs' totals) ---
const playerDrift = [];
for (const p of players) {
  const stored = p.totalScore ?? 0;
  const summed = (p.chefIds || []).reduce((sum, cid) => {
    const c = chefs.find((c) => c.id === cid);
    return sum + (c?.totalScore ?? 0);
  }, 0);
  if (stored !== summed) {
    playerDrift.push({ playerId: p.id, name: p.name, stored, summed, delta: stored - summed });
  }
}

// --- Chef status sanity ---
const statusByChef = new Map(chefs.map((c) => [c.id, c.status]));
const statusIssues = [];
for (const ev of scoreEvents) {
  if (ev.type === 'Eliminated' && statusByChef.get(ev.chefId) === 'active') {
    statusIssues.push({
      chefId: ev.chefId,
      chefName: chefs.find((c) => c.id === ev.chefId)?.name,
      week: ev.week,
      issue: 'Has Eliminated event but chef.status is "active"',
    });
  }
}

// --- Week coverage ---
const weeks = [...new Set(scoreEvents.map((e) => e.week))].sort((a, b) => a - b);
const eventsByWeek = {};
for (const w of weeks) {
  const wEvents = scoreEvents.filter((e) => e.week === w);
  eventsByWeek[w] = {
    count: wEvents.length,
    chefsScored: new Set(wEvents.map((e) => e.chefId)).size,
    types: [...new Set(wEvents.map((e) => e.type))].sort(),
  };
}

// --- Build report.md ---
const md = [];
md.push(`# TcfCarolina Firestore audit — ${ts}\n`);
md.push(`Project: \`${config.projectId}\``);
md.push(`Database: \`${config.firestoreDatabaseId}\``);
md.push(`Generated: ${new Date().toISOString()}\n`);

md.push(`## Counts\n`);
md.push(`- Chefs: **${chefs.length}**`);
md.push(`- Players: **${players.length}**`);
md.push(`- Score events: **${scoreEvents.length}**`);
md.push(`- Weeks with events: **${weeks.length}** (${weeks.join(', ') || 'none'})`);
md.push(`- **scoringStartWeek:** \`${startWeek}\` (events before week ${startWeek} don't count toward chef totals)`);
md.push(`- config/league: ${configLeague ? 'present' : '⚠️ MISSING'}`);
md.push(`- config/season: ${configSeason ? 'present' : 'absent (acceptable)'}\n`);

md.push(`## Chef status snapshot\n`);
md.push(`| Chef | Status | Stored total |`);
md.push(`|---|---|---:|`);
for (const c of [...chefs].sort((a, b) => (b.totalScore ?? 0) - (a.totalScore ?? 0))) {
  md.push(`| ${c.name} | ${c.status} | ${c.totalScore ?? 0} |`);
}

md.push(`\n## ❗ Chef totalScore drift (stored vs sum of events)\n`);
if (chefDrift.length === 0) {
  md.push(`✅ All chef totals match the sum of their score events.\n`);
} else {
  md.push(`Found ${chefDrift.length} chef(s) where \`chef.totalScore\` ≠ sum of their score events. This means a write happened somewhere outside the atomic transaction path, or an event was added/removed without the chef total being adjusted.\n`);
  md.push(`| Chef | Stored | Sum of events | Delta |`);
  md.push(`|---|---:|---:|---:|`);
  for (const d of chefDrift) md.push(`| ${d.name} | ${d.stored} | ${d.summed} | ${d.delta > 0 ? '+' + d.delta : d.delta} |`);
}

md.push(`\n## ❗ Duplicate score events (same chef + week + type)\n`);
if (duplicates.length === 0) {
  md.push(`✅ No duplicates found.\n`);
} else {
  md.push(`Found ${duplicates.length} duplicate group(s). Each is the same event applied multiple times — likely from re-running magic sync. **Each duplicate added extra points to the chef and player totals.**\n`);
  md.push(`| Chef | Week | Type | Count | Total extra points | Event IDs |`);
  md.push(`|---|---:|---|---:|---:|---|`);
  for (const d of duplicates) {
    const extra = d.points.reduce((a, b) => a + b, 0) - d.points[0];
    md.push(`| ${d.chefName} | ${d.week} | ${d.type} | ${d.count} | ${extra > 0 ? '+' + extra : extra} | ${d.eventIds.join(', ')} |`);
  }
}

md.push(`\n## ⚠️ Score events with unknown type (not in SCORING_RULES)\n`);
if (unknownTypes.length === 0) {
  md.push(`✅ All event types are recognized.\n`);
} else {
  md.push(`Found ${unknownTypes.length} event(s) with a \`type\` field that doesn't match any rule in SCORING_RULES. These got points stored but won't appear correctly in any tool that uses the canonical rule list (including the duplicate-detection logic the admin "Add Score" form is supposed to use).\n`);
  md.push(`Common cause: magic-sync writes raw labels like "Top" / "Bottom" / "Winner" / "Runner-Up" instead of the canonical "Judges Table Top" / "Judges Table Bottom" / "Winning Top Chef" / "Making Season Finale".\n`);
  md.push(`| Chef | Week | Stored type | Points |`);
  md.push(`|---|---:|---|---:|`);
  for (const u of unknownTypes) md.push(`| ${u.chefName} | ${u.week} | \`${u.type}\` | ${u.points} |`);
}

md.push(`\n## ⚠️ Point value mismatch (event.points ≠ rule's defined points)\n`);
if (pointsMismatch.length === 0) {
  md.push(`✅ All event point values match the SCORING_RULES.\n`);
} else {
  md.push(`Found ${pointsMismatch.length} event(s) where the stored \`points\` value doesn't match what SCORING_RULES says. Could be a rule change after-the-fact, or a bug in the writer.\n`);
  md.push(`| Chef | Week | Type | Stored | Expected |`);
  md.push(`|---|---:|---|---:|---:|`);
  for (const m of pointsMismatch) md.push(`| ${m.chefName} | ${m.week} | ${m.type} | ${m.stored} | ${m.expected} |`);
}

md.push(`\n## ❗ Player totalScore drift\n`);
if (playerDrift.length === 0) {
  md.push(`✅ All player totals match the sum of their drafted chefs.\n`);
} else {
  md.push(`Found ${playerDrift.length} player(s) where the stored \`totalScore\` field disagrees with the sum of their drafted chefs' \`totalScore\`. Note: the live UI **recomputes** player totals from chefs at render time (App.tsx:488), so this drift is invisible on the scoreboard but reveals that DB writes to \`player.totalScore\` are inconsistent.\n`);
  md.push(`| Player | Stored | Sum of drafted chefs | Delta |`);
  md.push(`|---|---:|---:|---:|`);
  for (const d of playerDrift) md.push(`| ${d.name} | ${d.stored} | ${d.summed} | ${d.delta > 0 ? '+' + d.delta : d.delta} |`);
}

md.push(`\n## ⚠️ Chef status sanity\n`);
if (statusIssues.length === 0) {
  md.push(`✅ No obvious status/event mismatches.\n`);
} else {
  md.push(`Found ${statusIssues.length} potential status issue(s).\n`);
  md.push(`| Chef | Week | Issue |`);
  md.push(`|---|---:|---|`);
  for (const s of statusIssues) md.push(`| ${s.chefName} | ${s.week} | ${s.issue} |`);
}

md.push(`\n## Events per week\n`);
md.push(`| Week | # events | # chefs scored | Event types present |`);
md.push(`|---:|---:|---:|---|`);
for (const w of weeks) {
  const e = eventsByWeek[w];
  md.push(`| ${w} | ${e.count} | ${e.chefsScored} | ${e.types.join(', ')} |`);
}

md.push(`\n## Files written\n`);
md.push(`- \`${path.relative(repoRoot, path.join(outDir, 'chefs.json'))}\``);
md.push(`- \`${path.relative(repoRoot, path.join(outDir, 'players.json'))}\``);
md.push(`- \`${path.relative(repoRoot, path.join(outDir, 'scoreEvents.json'))}\``);
md.push(`- \`${path.relative(repoRoot, path.join(outDir, 'config.json'))}\``);

await writeFile(path.join(outDir, 'report.md'), md.join('\n') + '\n');

console.log(`\nAudit complete. Report: ${path.relative(repoRoot, path.join(outDir, 'report.md'))}`);

process.exit(0);
