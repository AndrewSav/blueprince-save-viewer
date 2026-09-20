// The History page: one day of History Data at a time, chosen from every day in the run.
//
// History Data is written by the game's end-of-day history screen, seventy numbers a day: the
// day's name as three codes, five facts, the floorplan on each of the house's 46 map slots,
// and fifteen counters. The game's own screen shows the name, the facts and the map, but often
// not the full list of counters, so the counters are what this page is for; the rest is here
// as context beside them.

import { splitHistory, historyProblem, estateName, estateParts } from "./save.js";
import { infoBadge, withTip } from "./tip.js";
import { rawSuffix } from "./arrays.js";

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

// The header facts, as the game's history screen labels them.
const FACTS = [
  ["RoomsinHouse", "Total rooms"],
  ["RankReached", "Rank reached"],
  ["StepsTaken", "Steps taken"],
  ["ItemsFound", "Items found"],
  ["New Rooms", "New rooms"],
];

// Each counter in the save's order, with its label here and the word for it in a sentence.
// They are tallied during the day as rooms are added to the house - by the room's type, or by
// the room itself - except Digs, which counts every dig.
const COUNTERS = [
  ["Puzzle Count", "Puzzle rooms", "puzzle rooms"],
  ["Time Count", "Tomorrow rooms", "Tomorrow rooms"],
  ["Cog Count", "Mechanical rooms", "mechanical rooms"],
  ["Classrooms", "Classrooms", "Classrooms"],
  ["Draft Count", "Drafting rooms", "drafting rooms"],
  ["Shop Count", "Shops", "shops"],
  ["Red Count", "Red rooms", "red rooms"],
  ["Bed Count", "Bedrooms", "bedrooms"],
  ["Dead Count", "Dead ends", "dead ends"],
  ["Green Count", "Green rooms", "green rooms"],
  ["Dig Count", "Digs", "digs"],
  ["ClosetCount", "Closets", "Closets"],
  ["WClosetCount", "Walk-in Closets", "Walk-in Closets"],
  ["AtticCount", "Attics", "Attics"],
  ["StoreCount", "Storerooms", "Storerooms"],
];
const NOUN = Object.fromEntries(COUNTERS.map(([key, , noun]) => [key, noun]));

const NAME_NOTE =
  "Point at a word to see why it appears. The numbers are the save's codes for the three " +
  "parts - prefix, house, suffix - each saying what earned that part; 0 means nothing did, " +
  "and that part is named for the house's size instead, or left out if it is the suffix.";

const COUNTER_NOTE =
  "How many rooms of each kind the house held by the end of the day, and how many times you " +
  "dug. The game keeps these to name the house; its own history screen often does not show " +
  "the full list.";

const MAP_NOTE = "The floor plan of the house as the day ended.";

const byIndex = new WeakMap();

/** Floorplan entries by map value, built once per dictionary. */
function floorplanIndex(floorplans) {
  if (!byIndex.has(floorplans)) {
    byIndex.set(floorplans, new Map((floorplans.entries ?? []).map((e) => [e.index, e])));
  }
  return byIndex.get(floorplans);
}

/** The blocks of the day page for one profile. `want` is the day's position from the address
 *  (1 = the first day), or null for the latest; `go(n)` moves to day n. */
export function historyPage(slot, dict, want, go) {
  const items = slot.arrays.get("History Data")?.items ?? [];
  const day = Number(slot.objs.get("DAY")?.value);
  const out = [];

  const problem = historyProblem(items, Number.isInteger(day) ? day : null);
  if (problem) {
    const box = el("p", "warn history-problem");
    box.append(el("strong", null, problem.fatal ? "This History Data cannot be read. " : "History Data and the day disagree. "),
               problem.text);
    out.push(box);
    if (problem.fatal) return out;
  }
  const days = splitHistory(items) ?? [];
  if (!days.length) {
    out.push(el("p", "muted", "No day has been recorded in this profile yet: a day is added when it ends."));
    return out;
  }

  const n = Number.isInteger(want) && want >= 1 && want <= days.length ? want : days.length;
  const rec = days[n - 1];
  const names = dict.field("profile", "History Data")?.view?.estate_names ?? null;

  out.push(picker(days, n, names, go));
  out.push(nameBlock(rec, names, dict.floorplans), factLine(rec), counterBlock(rec),
           mapBlock(rec, dict.floorplans));
  return out;
}

function dayLabel(rec, names) {
  const name = estateName(rec.header, names);
  return `Day ${rec.header.Day}` + (name ? ` · ${name}` : "");
}

function picker(days, n, names, go) {
  const bar = el("div", "toolbar day-picker");
  const prev = el("button", "step", "◀");
  prev.dataset.focusKey = "day-prev";
  prev.type = "button";
  prev.setAttribute("aria-label", "Previous day");
  prev.disabled = n <= 1;
  prev.addEventListener("click", () => go(n - 1));
  const next = el("button", "step", "▶");
  next.dataset.focusKey = "day-next";
  next.type = "button";
  next.setAttribute("aria-label", "Next day");
  next.disabled = n >= days.length;
  next.addEventListener("click", () => go(n + 1));
  const select = el("select", "day-select");
  select.dataset.focusKey = "day-select";
  days.forEach((rec, i) => {
    const o = el("option", null, dayLabel(rec, names));
    o.value = String(i + 1);
    o.selected = i + 1 === n;
    select.append(o);
  });
  select.addEventListener("change", () => go(Number(select.value)));
  bar.append(prev, select, next, el("span", "muted list-note", `${days.length} days`));
  return bar;
}

// The name, one element per part, each with a popup saying what won it that day.
function nameBlock(rec, names, floorplans) {
  const h = rec.header;
  const head = el("div", "day-name");
  const title = el("h2", "estate-name");
  const est = estateParts(h, names);
  if (!est) {
    title.textContent = `Day ${h.Day}`;
  } else if (est.abandoned) {
    title.append(namePart(est.name, "abandoned", abandonedTip(rec, names)));
  } else {
    est.parts.forEach((p, i) => {
      if (i) title.append(" ");
      title.append(namePart(p.word, p.part, partTip(p, est, rec, names, floorplans)));
    });
  }
  head.append(title);
  const codes = el("span", "raw name-codes", `${h.Prefix1} · ${h.House1} · ${h.Suffix1}`);
  head.append(codes, infoBadge(NAME_NOTE, "Prefix1, House1, Suffix1"));
  const box = el("section", "day-head");
  box.append(el("div", "day-number", `Day ${h.Day}`), head);
  if (!est) {
    box.append(el("p", "muted explain",
      "The words for these codes are not in this viewer's data, so the name cannot be spelt out."));
  }
  return box;
}

function namePart(word, part, tip) {
  const s = withTip(el("span", "name-part", word), tip);
  s.dataset.part = part;
  return s;
}

const PART_TITLE = { prefix: "Prefix", house: "House", suffix: "Suffix" };

function partTip(p, est, rec, names, floorplans) {
  const lines = [`${PART_TITLE[p.part]}: ${p.word}`];
  const rooms = rec.header.RoomsinHouse;
  if (!p.won) {
    lines.push(`No check won the ${p.part} this day, so it is named for the house's size: ` +
               `${rooms} rooms.`);
  } else {
    const check = names.checks?.[String(p.code)];
    if (!check) {
      lines.push("What wins this word is not in this viewer's data.");
    } else {
      lines.push(`Won by ${joinAll(conditions(check, rec, names, floorplans))}.`);
      // A check that won one part was in the running for every part it has a word for, and
      // gave the others up: that is how Quaint Castle loses its Royal.
      const also = Object.entries(check.codes)
        .filter(([part]) => part !== p.part)
        .map(([part, code]) => `the ${part} (${names[part][code]?.trim()})`);
      if (also.length) {
        lines.push(`The same check also offered ${andList(also)}, but a check names only one part.`);
      }
      if (check.unless?.length) {
        const rivals = check.unless.map((code) => wordFor(code, names));
        lines.push(`It did not also qualify for ${orList(rivals)}, which would have ruled this out.`);
      }
    }
  }
  if (p.part === "house" && est.dropped) {
    lines.push(`The house also won the suffix "${est.dropped.word}", but ${p.word} takes none, ` +
               `so it is left off.`);
  }
  return lines.join("\n");
}

function abandonedTip(rec, names) {
  const lines = [names.abandoned_name,
    `A house of fewer than ${names.abandoned_below} rooms is always called this, whatever it ` +
    `won; this one had ${rec.header.RoomsinHouse}.`];
  const h = rec.header;
  const won = [["prefix", h.Prefix1], ["house", h.House1], ["suffix", h.Suffix1]]
    .filter(([part, code]) => code > 0 && names[part][code]?.trim())
    .map(([part, code]) => names[part][code].trim());
  if (won.length) lines.push(`It had won ${andList(won)}.`);
  return lines.join("\n");
}

/** What a check needed, each as a phrase, using this day's numbers. */
function conditions(check, rec, names, floorplans) {
  const rooms = rec.header.RoomsinHouse;
  const band = rooms < names.sizes.small_below ? 0 : rooms > names.sizes.large_above ? 2 : 1;
  const need = (at, more = "") => (at.every((x) => x === at[0])
    ? `at least ${at[band]}${more} needed`
    : `${bandPhrase(band, names.sizes)} needs at least ${at[band]}${more}`);
  const out = [];
  for (const { of, at_least } of check.counts ?? []) {
    const values = of.map((c) => rec.counters[c] ?? 0);
    const total = values.reduce((a, b) => a + b, 0);
    out.push(of.length === 1
      ? `${total} ${NOUN[of[0]] ?? of[0]} (${need(at_least)})`
      : `${andList(of.map((c) => NOUN[c] ?? c))}: ${total} between them ` +
        `(${values.join(" + ")}; ${need(at_least)})`);
  }
  if (check.rooms?.length) out.push(`${andList(check.rooms.map(withArticle))} in the house`);
  if (check.outer) out.push(`the ${check.outer} as the outer room`);
  for (const flag of check.flags ?? []) out.push(flag);
  if (check.wing) {
    const [west, east] = edgeCounts(rec, floorplans);
    const [mine, theirs] = check.wing.side === "west" ? [west, east] : [east, west];
    const other = check.wing.side === "west" ? "east" : "west";
    out.push(`${plural(mine, "room")} down the ${check.wing.side} side against ${theirs} down the ` +
             `${other} (${need(check.wing.more_by, " more")})`);
  }
  return out;
}

/** Rooms in the westmost and eastmost columns of the day's map. */
function edgeCounts(rec, floorplans) {
  const slots = floorplans?.grid?.slots ?? [];
  const last = floorplans?.grid?.columns;
  const count = (column) => slots.filter((s) => s.column === column &&
    rec.map[s.slot] !== floorplans.blank_index).length;
  return [count(1), count(last)];
}

function bandPhrase(band, sizes) {
  return [`a house of fewer than ${sizes.small_below} rooms`,
          `a house of ${sizes.small_below} to ${sizes.large_above} rooms`,
          `a house of more than ${sizes.large_above} rooms`][band];
}

/** A check's name for a sentence: its house word if it has one, else its other word. */
function wordFor(code, names) {
  for (const part of ["house", "prefix", "suffix"]) {
    const w = names[part][code]?.trim();
    if (w) return w;
  }
  return `check ${code}`;
}

// The rooms that are unique in a house read better without "a": The Pool, Her Ladyship's
// Chamber.
function withArticle(room) {
  if (/^The /.test(room) || /'s /.test(room)) return room;
  return (/^[AEIOU]/.test(room) ? "an " : "a ") + room;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function andList(items) {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function orList(items) {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} or ${items.at(-1)}`;
}

// Joins whole conditions, which may already contain "and".
function joinAll(items) {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

function factLine(rec) {
  const line = el("div", "fact-line day-facts");
  for (const [key, label] of FACTS) {
    const f = el("span", "fact");
    f.dataset.fact = key;
    f.append(el("span", "fact-key", label), el("span", "fact-value", String(rec.header[key])));
    line.append(f);
  }
  return line;
}

function counterBlock(rec) {
  const sec = el("section", "day-counters");
  const head = el("h3");
  head.append("Counters", infoBadge(COUNTER_NOTE));
  sec.append(head);
  const grid = el("div", "counter-grid");
  for (const [key, label] of COUNTERS) {
    const value = rec.counters[key];
    const c = el("div", "counter" + (value ? "" : " zero"));
    c.dataset.counter = key;
    c.append(el("span", "counter-value", String(value)), el("span", "counter-label", label));
    grid.append(c);
  }
  sec.append(grid);
  return sec;
}

function mapBlock(rec, floorplans) {
  const sec = el("section", "day-map");
  const head = el("h3");
  head.append("The house", infoBadge(MAP_NOTE));
  sec.append(head);
  const layout = floorplans?.grid;
  if (!layout?.slots) {
    sec.append(el("p", "muted", "The map layout is not in this viewer's data."));
    return sec;
  }
  const index = floorplanIndex(floorplans);
  const blank = floorplans.blank_index;
  const at = new Map(layout.slots.filter((s) => s.rank).map((s) => [`${s.rank},${s.column}`, s.slot]));

  const grid = el("div", "house-grid");
  grid.style.gridTemplateColumns = `repeat(${layout.columns}, 1fr)`;
  for (let rank = layout.ranks; rank >= 1; rank--) {
    for (let column = 1; column <= layout.columns; column++) {
      const slot = at.get(`${rank},${column}`);
      grid.append(tile(rec.map[slot], slot, index, blank));
    }
  }
  sec.append(grid);

  // The outer room sits off the grid. The history screen hides it when its slot holds the
  // blank or 0 (`Outer Check`), so either reads as no outer room.
  const outer = layout.slots.find((s) => !s.rank);
  if (outer) {
    const value = rec.map[outer.slot];
    const p = el("p", "outer-room");
    p.dataset.slot = String(outer.slot);
    p.append(el("span", "fact-key", "Outer room"), " ");
    if (value === blank || value === 0) p.append(el("span", "muted", "none"));
    else p.append(roomText(value, index));
    sec.append(p);
  }
  return sec;
}

function tile(value, slot, index, blank) {
  const t = el("div", "tile");
  t.dataset.slot = String(slot);
  if (value === blank) {
    t.classList.add("empty");
    return t;
  }
  t.append(roomText(value, index));
  return t;
}

function roomText(value, index) {
  const e = index.get(value);
  if (!e) {
    const s = el("span", "unknown", "unknown floorplan");
    s.append(rawSuffix(value));
    return s;
  }
  return el("span", "room", e.name ?? e.texture);
}
