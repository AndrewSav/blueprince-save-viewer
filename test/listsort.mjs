// app/listsort.js against .NET's own List<T>.Sort. Needs no save.
//
//   node test/listsort.mjs
//
// test/listsort-cases.json is written by test/listsort-oracle.cs (dotnet run, see its header): for
// each list, the order .NET's sort leaves it in, how many comparisons it made and a hash of every
// pair it compared. The port has to match all three, so it takes the same path through the
// algorithm, not only reaching the same result.

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { listSort } from "../app/listsort.js";
import { gameRankings } from "../app/rankings.js";

const here = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(await readFile(join(here, "listsort-cases.json"), "utf8"));

let failures = 0;
const check = (ok, what, detail = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}${detail ? "   " + detail : ""}`);
  if (!ok) failures++;
};

// The comparison the oracle sorted with: higher key first, as the game's rankings are, and after
// `quarterAfter` calls (when given) by key / 4, which puts ties in front of heapsort.
function run(c) {
  let comparisons = 0, trace = 2166136261;
  const mix = (v) => { trace = Math.imul((trace ^ v) >>> 0, 16777619) >>> 0; };
  const quarter = (k) => Math.trunc(k / 4);
  const out = listSort(c.keys.map((key, index) => ({ index, key })), (a, b) => {
    comparisons++;
    mix(a.index);
    mix(b.index);
    return c.quarterAfter != null && comparisons > c.quarterAfter ? quarter(b.key) - quarter(a.key) : b.key - a.key;
  });
  return { order: out.map((e) => e.index), comparisons, trace };
}

const stable = (keys) => keys.map((key, index) => ({ index, key })).sort((a, b) => b.key - a.key).map((e) => e.index);
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

const results = data.cases.map((c) => ({ c, got: run(c) }));
const wrong = results.filter(({ c, got }) =>
  !same(got.order, c.order) || got.comparisons !== c.comparisons || got.trace !== c.trace);
check(!wrong.length, "every list sorts as .NET's List.Sort sorts it: same order, same comparisons, in the same sequence",
      wrong.length ? wrong.slice(0, 3).map(({ c }) => `${c.kind} n=${c.keys.length}`).join("; ")
                   : `${results.length} lists, ${data.runtime}`);

const tieHeavy = results.filter(({ c }) => c.kind === "random" && new Set(c.keys).size < c.keys.length);
// Up to 16, only a list of exactly 3 goes through the three compare-and-swaps rather than
// insertion sort (2 is a single swap when out of order), and only those can reorder ties.
const small = tieHeavy.filter(({ c }) => c.keys.length <= 16 && c.keys.length !== 3);
check(small.length > 0 && small.every(({ c }) => same(c.order, stable(c.keys))),
      "a list of 2 or of 4 to 16 keeps equal entries in the order they came in", `${small.length} lists`);
const three = run({ keys: [4, 4, 5] }).order;
check(same(three, [2, 1, 0]), "a list of 3 can swap equal entries: [4, 4, 5] comes out 5, the second 4, the first 4",
      three.join(", "));
const reordered = tieHeavy.filter(({ c }) => c.keys.length > 16 && !same(c.order, stable(c.keys)));
check(reordered.length > 0, "longer lists with ties come out differently from a stable sort, so the cases can tell the two apart",
      `${reordered.length} of ${tieHeavy.filter(({ c }) => c.keys.length > 16).length}`);
const heap = results.filter(({ c }) => c.kind.startsWith("adversary") && c.kind !== "adversary, halved");
check(heap.length === 4 && heap.some(({ c }) => c.quarterAfter != null),
      "the cases built to exhaust the depth limit, with and without ties in heapsort, are there", `${heap.length}`);

// The rankings use it: three rooms with 4, 4 and 5 gems, recorded in that order, are a list of
// three, so the game shows the 5 first and then the two 4s the other way round.
const day = { RoomData: { Rooms: [1, 2, 3].map((id) => ({ id, built: 1, discarded: 0, gems: id === 3 ? 5 : 4, time: 1 })) } };
const gems = gameRankings({ DaysData: { Days: [day] } }).mostGems.shown.map((e) => e.id);
check(same(gems, [3, 2, 1]), "the rankings are sorted the game's way: most gems 4, 4, 5 shows the 5, then the second 4, then the first",
      gems.join(", "));

console.log(failures ? `${failures} check(s) failed` : "all checks passed");
process.exitCode = failures ? 1 : 0;
