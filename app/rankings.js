// The rankings the game builds from a profile's DATA, worked out the way the game does it.
//
// They are not saved: StatsLogger.GenerateRankings rebuilds them each time the Mt Holly
// Scrapbook is opened. (The Morning Paper carries a copy of the Scrapbook's FSM that calls it
// too, but every display action in that copy has no target, so the paper shows none of it.)
// Read from GameAssembly.dll:
//
//   RunStatsData.GenerateRoomStats / GenerateItemStats rebuild the run totals by adding up the
//   days in order, a room or item joining the list the first time it appears.
//   RoomStats.GenerateRankings then fills five lists from rooms with an id above 0:
//     most drafted      built >= 1, not the Secret Garden (70) or Room 8 (8); CompareBuilt:
//                       more drafts first, then drafts minus discards, higher first
//     best draft rate   built + discarded > 2, same two rooms left out; CompareDraftRate:
//                       built / (built + discarded) as a float, higher first, then as above
//     most gems         gems >= 1, same two rooms left out; CompareGems, more first
//     most time         time > 0, every room; CompareTime, more first
//   StatsLogger.GenerateRoomRankings copies the first three of each into what the documents
//   read, except worst draft rate: HelperRoomData.FillLast takes the last three of the *best*
//   draft rate list, lowest first. ItemStats.GenerateRankings keeps items with an id >= 0 and
//   coat > 0, CompareCoatChecks, more first; the first three are the coat-check ranking.
//
// What the counts mean: `built` goes up once per Record_DraftedRoom (DayData.PushEvent,
// event 2000). An outer draft calls it twice - PLAN MANAGEMENT's Standalone 1/2/3 and again in
// Is New Room?, which every draft passes - so each outer room shows 2 per draft (both saved
// profiles: exactly double RoomRecords for all eight outer rooms). `coat` goes up in EndDay for
// the day's DayStats.CoatCheckItem, which DAY sets every evening from whatever is at the Coat
// Check, so it counts days an item ended there, not times it was left.
//
// Each list is filled in one pass over the rebuilt totals, in their order, and then sorted with
// List.Sort (RoomStats.GenerateRankings). That sort does not keep equal entries in the
// order they came in, but it is deterministic, so listsort.js runs the same algorithm on the same
// input and equal entries come out in the order the game prints them.

import { listSort } from "./listsort.js";

const EXCLUDED = new Set([70, 8]);   // Secret Garden, Room 8
const f32 = Math.fround;

/** built / (built + discarded), in single precision as the game computes it. */
export function draftRate(e) {
  const offered = e.built + e.discarded;
  return e.built && offered ? f32(f32(e.built) / f32(offered)) : 0;
}

const diff = (e) => e.built - e.discarded;
const byBuilt = (a, b) => (b.built - a.built) || (diff(b) - diff(a));
const byRate = (a, b) => {
  const x = draftRate(a), y = draftRate(b);
  return y > x ? 1 : y < x ? -1 : Math.sign(diff(b) - diff(a));
};
const byGems = (a, b) => b.gems - a.gems;
const byTime = (a, b) => b.time - a.time;
const byCoat = (a, b) => b.coat - a.coat;

/** The run totals as the game rebuilds them from the days. */
export function rebuildTotals(doc) {
  const rooms = [], roomAt = new Map(), items = [], itemAt = new Map();
  for (const day of doc?.DaysData?.Days ?? []) {
    for (const r of day.RoomData?.Rooms ?? []) {
      let e = roomAt.get(r.id);
      if (!e) roomAt.set(r.id, e = { id: r.id, built: 0, discarded: 0, gems: 0, time: 0 }), rooms.push(e);
      e.built += r.built; e.discarded += r.discarded; e.gems += r.gems; e.time += r.time;
    }
    for (const it of day.ItemData?.Items ?? []) {
      let e = itemAt.get(it.id);
      if (!e) itemAt.set(it.id, e = { id: it.id, coat: 0 }), items.push(e);
      e.coat += it.coat;
    }
  }
  return { rooms, items };
}

/** Do the saved run totals equal the ones rebuilt from the days? */
export function totalsMatch(doc, rebuilt) {
  const key = (list, fields) => JSON.stringify((list ?? []).map((e) => fields.map((k) => e[k])));
  return key(doc?.GlobalRoomStats?.Rooms, ["id", "built", "discarded", "gems", "time"]) ===
           key(rebuilt.rooms, ["id", "built", "discarded", "gems", "time"]) &&
         key(doc?.GlobalItemStats?.Items, ["id", "coat"]) === key(rebuilt.items, ["id", "coat"]);
}

// The first `n` of a sorted list, and whatever ties with the last of them just past the cut.
function first(sorted, n, cmp) {
  const shown = sorted.slice(0, n);
  const edge = shown.at(-1);
  const tied = edge && sorted.length > n ? sorted.slice(n).filter((e) => cmp(edge, e) === 0) : [];
  return { shown, tied, pool: sorted.length, level: levels(shown, cmp) };
}

// Entries equal to the one before them share its place number, though the game lists them in
// the order shown.
function levels(shown, cmp) {
  return shown.map((e, i) => i > 0 && cmp(shown[i - 1], e) === 0);
}

function last(sorted, n, cmp) {
  const shown = sorted.slice(-n).reverse();
  const edge = shown.at(-1);
  const rest = sorted.slice(0, Math.max(0, sorted.length - n));
  const tied = edge ? rest.filter((e) => cmp(edge, e) === 0) : [];
  return { shown, tied, pool: sorted.length, level: levels(shown, cmp) };
}

/** Every ranking the documents read, in the game's terms. */
export function gameRankings(doc) {
  const { rooms, items } = rebuildTotals(doc);
  const listed = rooms.filter((e) => e.id > 0 && !EXCLUDED.has(e.id));
  const rated = listSort(listed.filter((e) => e.built + e.discarded > 2), byRate);
  return {
    mostDrafted: first(listSort(listed.filter((e) => e.built >= 1), byBuilt), 3, byBuilt),
    bestDraftRate: first(rated, 1, byRate),
    worstDraftRate: last(rated, 3, byRate),
    mostGems: first(listSort(listed.filter((e) => e.gems >= 1), byGems), 3, byGems),
    mostTime: first(listSort(rooms.filter((e) => e.id > 0 && e.time > 0), byTime), 3, byTime),
    coatChecks: first(listSort(items.filter((e) => e.id >= 0 && e.coat > 0), byCoat), 3, byCoat),
  };
}
