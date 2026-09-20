// Exercise the reading pipeline headlessly, against a real save.
//
//   node test/core.mjs <save.es3 or save.es3.json> [password]
//
// The browser modules run unchanged here because Node has crypto.subtle and
// DecompressionStream, so this tests the real code rather than a stand-in.

import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { load, display, isDefault, inflateStats, splitHistory, historyProblem, estateName, readStats } from "../app/save.js";
import { gameRankings, rebuildTotals, totalsMatch } from "../app/rankings.js";
import { decrypt, looksDecrypted } from "../app/es3.js";
import { gameKey } from "./gamekey.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const [file, passwordArg] = process.argv.slice(2);
if (!file) {
  console.error("usage: node test/core.mjs <save.es3 | save.es3.json> [password]");
  process.exit(2);
}

// Fall back to config.js, the same place the page gets it, so an encrypted save can be
// tested without repeating the password on the command line. A bare Windows path is not a
// valid ESM specifier, hence the file:// URL.
let password = passwordArg ?? null;
if (!password) {
  try {
    await import(pathToFileURL(join(here, "..", "config.js")).href);
    password = globalThis.BLUEPRINCE_CONFIG?.es3Password ?? null;
    if (password) console.log("(using the password from config.js)");
  } catch { /* no config.js */ }
}
// Then the game's own resources.assets, where the page can also take it from; without any, only
// a decrypted save opens.
if (!password) {
  password = await gameKey();
  if (password) console.log("(using the save key read from the game's resources.assets)");
}
if (!password && !looksDecrypted(new Uint8Array(await readFile(file)))) {
  console.error("This save is encrypted and there is no key for it: pass it after the file, run make-config.mjs, " +
                "or set BLUEPRINCE_GAME to the Blue Prince install folder.");
  process.exit(2);
}

let failures = 0;
const check = (ok, what, detail = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}${detail ? "   " + detail : ""}`);
  if (!ok) failures++;
};

const bytes = new Uint8Array(await readFile(file));
console.log(`${file}  (${bytes.length.toLocaleString()} bytes)\n`);

// --- load -------------------------------------------------------------------
const t0 = Date.now();
const save = await load(bytes, password);
console.log(`loaded in ${Date.now() - t0} ms, ${save.wasEncrypted ? "decrypted in passing" : "already decrypted"}\n`);

// Count the same things a second way, straight off the text: every slot is one
// PMDataWrapper and every value carries its own "__type", array elements included. Counted
// from the file itself, so the check holds for any save.
const text = new TextDecoder("utf-8").decode(looksDecrypted(bytes) ? bytes : await decrypt(bytes, password));
const wrappers = text.split("ES3PlayMaker.PMDataWrapper").length - 1;
const typed = text.split('"__type"').length - 1 - wrappers;
check(save.slots.size === wrappers, "every top-level slot parsed",
      `${save.slots.size} parsed, ${wrappers} in the text`);
check(save.valueCount() === typed, "every typed value parsed",
      `${save.valueCount().toLocaleString()} parsed, ${typed.toLocaleString()} in the text`);
// An old enough save has no SaveFileInfo, and so no build id; that is a shape to handle,
// not a failure.
if (save.hasFileInfo) check(!!save.gameVersion, "game_version present", save.gameVersion ?? "");
else console.log("  note  no SaveFileInfo block, so no build id - an older save");
// Not every slot is live: a deleted profile leaves its Backup behind, because nothing in
// the game deletes a Backup key. So live <= backups, and live must be a subset of them.
const live = save.profileNames();
const backups = save.backupNames();
check(live.length > 0 && live.length <= 4, "live profiles, backups excluded", live.join(", "));
check(backups.length <= 4, "backups identified", backups.join(", "));
check(live.every((n) => backups.includes(n + "Backup")),
      "every live profile has a matching backup key", `${live.length} live, ${backups.length} backups`);
check(live.every((n) => !n.endsWith("Backup")), "no backup leaks into the picker");

// --- a profile's shape ------------------------------------------------------
const name = save.profileNames().find((n) => n === "BluePrint2") ?? save.profileNames()[0];
const slot = save.slot(name);
check(slot.objs.size > 500, `${name} has the profile block`, `${slot.objs.size} objs, ${slot.arrays.size} arrays`);
const types = {};
for (const v of slot.objs.values()) types[v.type] = (types[v.type] ?? 0) + 1;
check(types.Boolean > 300 && types.Int32 > 150 && types.Vector3 === 1,
      "type mix matches the persistent manager", JSON.stringify(types));

// --- values round-trip as text ---------------------------------------------
const vec = [...slot.objs].find(([, v]) => v.type === "Vector3");
check(!!vec && display(vec[1]).split(",").length === 3, "Vector3 displays as three parts",
      vec ? display(vec[1]) : "");
const str = [...slot.objs].find(([, v]) => v.type === "String" && v.value !== '""');
check(!!str && !display(str[1]).startsWith('"'), "strings display unquoted",
      str ? `${str[0]} = ${JSON.stringify(display(str[1]))}` : "");
const defaults = [...slot.objs.values()].filter((entry) => isDefault(entry)).length;
check(defaults > 0 && defaults < slot.objs.size, "isDefault separates dormant fields",
      `${defaults} of ${slot.objs.size} at default`);

// --- the DATA blob ----------------------------------------------------------
const stats = await inflateStats(slot.arrays.get("DATA")?.items);
check(!!stats?.SaveGUID, "DATA inflates to RunStatsData", stats ? `SaveGUID ${stats.SaveGUID}` : "");
const days = stats?.DaysData?.Days ?? [];
check(days.length > 0, "DaysData.Days present", `${days.length} day records`);
// A DATA that will not unpack is reported, not thrown: one bad profile must not stop a save.
const bad = await readStats(["1", "2", "3"]);
const none = await readStats([]);
check(!!bad.error && !bad.doc && !!none.error, "a DATA that will not unpack, or none at all, comes back as a reason", bad.error);
// The saved run totals are the days added up, which is what the game ranks from.
const matches = await Promise.all(live.map(async (n) => {
  const r = await readStats(save.slot(n).arrays.get("DATA")?.items);
  return r.doc ? totalsMatch(r.doc, rebuildTotals(r.doc)) : null;
}));
check(matches.every((m) => m !== false), "every profile's saved totals equal its days added up", JSON.stringify(matches));
const ranks = gameRankings(stats);
check(ranks.bestDraftRate.shown.length <= 1 && ranks.mostDrafted.shown.length <= 3 &&
      ranks.mostDrafted.shown.every((e, i, a) => !i || a[i - 1].built >= e.built),
      "the rankings come out in the game's order", ranks.mostDrafted.shown.map((e) => e.id).join(", "));

// --- History Data -----------------------------------------------------------
const history = splitHistory(slot.arrays.get("History Data")?.items);
check(!!history, "History Data splits into per-day records", `${history?.length ?? 0} days`);
if (history) {
  check(history.length === days.length, "history days match the stats document",
        `${history.length} vs ${days.length}`);
  check(history[0].header.Day === 1, "first record is day 1");
  check(history[0].map.length === 46, "46 map slots per day");
  const entrance = history.at(-1).map[3];
  check(entrance === 167, "map slot 3 is the entrance hall (167)", `got ${entrance}`);
}
// The game appends one block at the end of every day, so every profile holds 70 x DAY.
const shapes = live.map((n) => {
  const s = save.slot(n);
  return [n, historyProblem(s.arrays.get("History Data")?.items ?? [], Number(s.objs.get("DAY")?.value))];
});
check(shapes.every(([, p]) => !p), "every profile's History Data is exactly 70 x DAY",
      shapes.filter(([, p]) => p).map(([n, p]) => `${n}: ${p.text}`).join("; "));
check(historyProblem(new Array(139).fill("0"), 2)?.fatal === true &&
      historyProblem(new Array(140).fill("0"), 3)?.fatal === false,
      "a length that is not whole days, or not the profile's day, is reported");

// --- the dictionary joins onto real names -----------------------------------
try {
  const dict = JSON.parse(await readFile(join(here, "..", "data", "fields-schema.json"), "utf8"));
  const byName = new Map(dict.fields.filter((f) => f.container === "profile").map((f) => [f.name, f]));
  const missing = [...slot.objs.keys()].filter((k) => !byName.has(k));
  check(missing.length === 0, "every profile field has a dictionary entry",
        missing.length ? `missing ${missing.slice(0, 4).join(", ")}` : `${byName.size} entries`);
  // Every day's three name codes spell out, and a code the game stored lands on words.
  const names = byName.get("History Data")?.view?.estate_names;
  if (names) {
    const all = live.flatMap((n) => splitHistory(save.slot(n).arrays.get("History Data")?.items) ?? []);
    const blank = all.filter((d) => !estateName(d.header, names) ||
      (d.header.Prefix1 > 0 && !names.prefix[d.header.Prefix1]?.trim()) ||
      (d.header.House1 > 0 && !names.house[d.header.House1]?.trim()));
    check(all.length > 0 && blank.length === 0, "every day's estate name spells out from its codes",
          blank.length ? `unspelt: ${blank.slice(0, 3).map((d) => `day ${d.day}`).join(", ")}`
                       : `${all.length} days, e.g. "${estateName(all.at(-1).header, names)}"`);
    // Every code a day carries names the check that won it, so the page can say what that was.
    const codes = new Set(all.flatMap((d) => [d.header.Prefix1, d.header.House1, d.header.Suffix1])
      .filter((c) => c > 0));
    const unchecked = [...codes].filter((c) => !names.checks?.[String(c)]);
    check(codes.size > 0 && unchecked.length === 0, "every code a day in the save carries has a check behind it",
          unchecked.length ? `no check for ${unchecked.join(", ")}` : `${codes.size} distinct codes`);
  } else {
    console.log("  note  no estate-name tables in the dictionary");
  }
  // A save from another build is a real input the viewer has to flag, which render.mjs
  // checks; here it is reported, since the reading pipeline itself is unaffected.
  if (save.gameVersion && dict.game_version === save.gameVersion) {
    check(true, "dictionary matches the save's build", `${dict.game_version}`);
  } else {
    console.log(`  note  dictionary from build ${dict.game_version}, save ` +
                (save.gameVersion ? `from ${save.gameVersion}` : "records none"));
  }
} catch (e) {
  check(false, "dictionary loaded", e.message + " - data/ is committed with the viewer");
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
