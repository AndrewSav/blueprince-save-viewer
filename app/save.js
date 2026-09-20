// The save as the viewer wants it: containers, profile slots, and the decoded blobs.
//
// Like es3.js this runs in both a browser and Node, so it can be tested headlessly.

import { decrypt, looksDecrypted, parse } from "./es3.js";

/** Slots whose writers sit behind disconnected Blackbridge menu states, so they can no
 *  longer change. Excluded from the picker rather than shown as stale data. */
export const isBackup = (name) => name.endsWith("Backup");

const FILE_CONTAINERS = new Set(["SaveFileInfo", "CurrentSave"]);

/** The menu's slot number: `BluePrint` is slot 1, `BluePrint2` to `BluePrint4` the others. A
 *  name of another shape sorts after them. */
const slotNumber = (name) => {
  const m = /^BluePrint(\d*)$/.exec(name);
  return m ? Number(m[1] || 1) : Infinity;
};

/** Load a save from bytes. `password` may be null, in which case only a decrypted file opens. */
export async function load(bytes, password) {
  const encrypted = !looksDecrypted(bytes);
  if (encrypted) {
    if (!password) {
      // Marked, so the page can offer to read the key and open this save once it has one.
      throw Object.assign(new Error(
        "This save is encrypted, and there is no save key to open it with yet. The key is in the game's " +
        "own files: give the page resources.assets (see the note under the drop zone), or drop a save " +
        "you have already decrypted."), { code: "no-key" });
    }
    bytes = await decrypt(bytes, password);
    if (!looksDecrypted(bytes)) {
      throw new Error("The file decrypted, but the result does not start with '{', so it is not an ES3 save.");
    }
  }
  const text = new TextDecoder("utf-8").decode(bytes);
  const slots = parse(text);
  return new Save(slots, encrypted);
}

export class Save {
  constructor(slots, wasEncrypted) {
    this.slots = slots;
    this.wasEncrypted = wasEncrypted;
  }

  /** Not every save has a SaveFileInfo block: it was added to the format later, and older
   *  files simply do not carry it. Without it there is no build id to check against. */
  get hasFileInfo() {
    return this.slots.has("SaveFileInfo");
  }

  get fileInfo() {
    const slot = this.slots.get("SaveFileInfo");
    if (!slot) return {};
    return Object.fromEntries([...slot.objs].map(([k, v]) => [k, unquote(v)]));
  }

  /** The game build that wrote this save. What every data file is checked against. */
  get gameVersion() {
    return this.fileInfo.game_version ?? null;
  }

  /** Live profile slots, backups excluded, in the menu's order (slot 1 to 4), not the file's. */
  profileNames() {
    return [...this.slots.keys()].filter((n) => !FILE_CONTAINERS.has(n) && !isBackup(n))
      .sort((a, b) => slotNumber(a) - slotNumber(b));
  }

  backupNames() {
    return [...this.slots.keys()].filter(isBackup);
  }

  /** Which profile the menu had selected, if the save says. */
  currentProfileIndex() {
    const cur = this.slots.get("CurrentSave");
    const v = cur?.objs?.get("current save");
    return v ? Number(v.value) : null;
  }

  slot(name) {
    return this.slots.get(name) ?? null;
  }

  valueCount() {
    let n = 0;
    for (const s of this.slots.values()) {
      n += s.objs.size;
      for (const a of s.arrays.values()) n += a.items.length;
    }
    return n;
  }
}

/** A scalar as something displayable: strings unquoted, Vector3 joined, others verbatim. */
export function display(entry) {
  if (!entry) return "";
  if (entry.type === "Vector3") return entry.value.join(", ");
  if (entry.type === "String") return unquote(entry);
  return entry.value;
}

function unquote(entry) {
  if (entry?.type !== "String") return entry?.value ?? "";
  try {
    return JSON.parse(entry.value);
  } catch {
    return entry.value;
  }
}

/** Is a value where a new profile starts? Used with the dictionary to hide dormant fields.
 *  `start` is the field's starting value as the game ships it, from the dictionary - the game
 *  can start a field at any value (`NETWORK PASSWORD` starts as SWANSONG). Only where the
 *  dictionary does not know it does the type's empty value stand in. */
export function isDefault(entry, start = null) {
  if (!entry) return true;
  if (start != null) {
    // Floats are compared as the 32-bit values the game holds: the dictionary writes 0.07 as
    // 0.07000000029802322, the save as 0.07. A vector's start is written "[35, 0, 75]".
    const same = (a, b) => Math.fround(Number(a)) === Math.fround(Number(b));
    switch (entry.type) {
      case "Boolean": return entry.value === String(start).toLowerCase();
      case "Int32": return Number(entry.value) === Number(start);
      case "Single": return same(entry.value, start);
      case "String": return unquote(entry) === start;
      case "Vector3": {
        const s = JSON.parse(start);
        return entry.value.length === s.length && entry.value.every((v, i) => same(v, s[i]));
      }
    }
  }
  switch (entry.type) {
    case "Boolean": return entry.value === "false";
    case "Int32": return entry.value === "0";
    case "Single": return Number(entry.value) === 0;
    case "String": return unquote(entry) === "";
    case "Vector3": return entry.value.every((v) => Number(v) === 0);
    default: return false;
  }
}

/** Is every element of an array at its type's default? True for an empty array. */
export function isDefaultArray(arr) {
  return arr.items.every((value) => isDefault({ type: arr.type, value }));
}

// ---------------------------------------------------------------- the DATA blob

/** `DATA` is StatsLogger.SaveToIntArray(): raw-deflate JSON packed four bytes per int32,
 *  little-endian. Inflated with DecompressionStream, which Node and browsers both have.
 *
 *  The game packs into a fixed buffer and pads the rest with zeros, and browsers reject a
 *  deflate stream with anything after its end ("Junk found after end of compressed data"),
 *  discarding what they had decoded; Node does not, which is why the tests never saw it. So
 *  the padding is cut off first. The compressed stream can itself end in zero bytes, so they
 *  are given back one at a time until the result is a complete document. */
export async function inflateStats(intStrings) {
  if (!intStrings?.length) return null;
  const bytes = new Uint8Array(intStrings.length * 4);
  const view = new DataView(bytes.buffer);
  intStrings.forEach((s, i) => view.setInt32(i * 4, Number(s), true));
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;
  let failure = null;
  for (let extra = 0; extra <= 64 && end + extra <= bytes.length; extra++) {
    try {
      return JSON.parse(await inflateRaw(bytes.subarray(0, end + extra)));
    } catch (e) {
      failure ??= e;
    }
  }
  throw failure ?? new Error("nothing to unpack");
}

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new TextDecoder("utf-8").decode(await new Response(stream).arrayBuffer());
}

/** A profile's DATA read as its RunStatsData document: {doc}, or {error} saying why it cannot
 *  be. Never throws, so one bad profile cannot stop a save from opening. */
export async function readStats(items) {
  if (!items?.length) return { error: "This profile has no DATA, so there are no statistics to show." };
  try {
    const doc = await inflateStats(items);
    if (doc && typeof doc === "object") return { doc };
    return { error: "This profile's DATA unpacked to something that is not a statistics document." };
  } catch (e) {
    return { error: `This profile's DATA would not unpack: ${e?.message || "it is not a compressed statistics log"}.` };
  }
}

// ---------------------------------------------------------------- History Data

export const HISTORY_PER_DAY = 70;
export const HISTORY_MAP_SLOTS = 46;

export const HISTORY_HEADER = [
  "Day", "Prefix1", "House1", "Suffix1", "RoomsinHouse",
  "RankReached", "StepsTaken", "ItemsFound", "New Rooms",
];
export const HISTORY_COUNTERS = [
  "Puzzle Count", "Time Count", "Cog Count", "Classrooms", "Draft Count",
  "Shop Count", "Red Count", "Bed Count", "Dead Count", "Green Count",
  "Dig Count", "ClosetCount", "WClosetCount", "AtticCount", "StoreCount",
];

/** What is wrong with a profile's History Data, or null if nothing is. The game appends one
 *  70-number block at the end of every day, so a profile on day D holds exactly 70 x D.
 *  `fatal` means it cannot be split into days at all. */
export function historyProblem(items, day) {
  const n = items?.length ?? 0;
  if (n % HISTORY_PER_DAY !== 0) {
    return { fatal: true, text: `History Data holds ${n} numbers, which is not a whole number of ` +
      `${HISTORY_PER_DAY}-number days, so it cannot be split into days reliably.` };
  }
  if (Number.isInteger(day) && n / HISTORY_PER_DAY !== day) {
    return { fatal: false, text: `History Data holds ${n / HISTORY_PER_DAY} days, but this profile ` +
      `is on day ${day}, which should have ${day} x ${HISTORY_PER_DAY} = ${day * HISTORY_PER_DAY} ` +
      `numbers. The days are shown as they split, but may not line up with the days you played.` };
  }
  return null;
}

/** A day's estate name in its parts, from its three codes and room count, using the word tables
 *  in the data, read off the game's history screen:
 *    parts    [{part, code, word, won}] for the prefix, the house and, when there is one, the
 *             suffix. `won` is false for a part named for the house's size because no check
 *             won it (code 0).
 *    dropped  {code, word} for a suffix the house won but House of Games or House of Cogs
 *             leaves off, else null.
 *    abandoned true for a house too small to be named at all: `name` is then the fixed one
 *             and `parts` is empty.
 *  `names` null gives null - the codes cannot be put into words. */
export function estateParts(header, names) {
  if (!names) return null;
  const rooms = header.RoomsinHouse;
  if (rooms < names.abandoned_below) {
    return { name: names.abandoned_name, parts: [], dropped: null, abandoned: true };
  }
  const parts = [];
  for (const [part, code, fallback] of [["prefix", header.Prefix1, "default_prefix"],
                                        ["house", header.House1, "default_house"]]) {
    // As the screen does it: a code in range is looked up, anything else takes the size name.
    parts.push(code > 0 && code < names[part].length
      ? { part, code, word: names[part][code].trim(), won: true }
      : { part, code, word: (names[fallback][rooms] ?? "").trim(), won: false });
  }
  let dropped = null;
  const suffix = header.Suffix1;
  if (suffix > 0 && suffix < names.suffix.length) {
    const word = names.suffix[suffix].trim();
    if (names.no_suffix_houses.includes(header.House1)) dropped = { code: suffix, word };
    else parts.push({ part: "suffix", code: suffix, word, won: true });
  }
  const shown = parts.filter((p) => p.word);
  return { name: shown.map((p) => p.word).join(" "), parts: shown, dropped, abandoned: false };
}

/** The estate name the game's history screen shows for a day; see estateParts. */
export function estateName(header, names) {
  return estateParts(header, names)?.name ?? null;
}

/** Split History Data into one record per day: 9 header fields, 46 map slots, 15 counters. */
export function splitHistory(items) {
  if (!items?.length || items.length % HISTORY_PER_DAY !== 0) return null;
  const days = [];
  for (let d = 0; d < items.length / HISTORY_PER_DAY; d++) {
    const at = d * HISTORY_PER_DAY;
    const nums = items.slice(at, at + HISTORY_PER_DAY).map(Number);
    days.push({
      day: d + 1,
      header: Object.fromEntries(HISTORY_HEADER.map((k, i) => [k, nums[i]])),
      map: nums.slice(HISTORY_HEADER.length, HISTORY_HEADER.length + HISTORY_MAP_SLOTS),
      counters: Object.fromEntries(
        HISTORY_COUNTERS.map((k, i) => [k, nums[HISTORY_HEADER.length + HISTORY_MAP_SLOTS + i]])),
    });
  }
  return days;
}
