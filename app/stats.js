// The Stats and Daily Stats pages: what a profile's DATA holds. Stats shows the run - the
// rankings the game builds, then the totals for all days together; Daily Stats shows one day's
// own record at a time.
//
// DATA is the game's statistics log (StatsLogger). The run totals and a record per day are
// saved in it; the rankings are not, so they are worked out here the way the game does it
// (rankings.js). Room and item ids are named by the lists the game itself names them from,
// as the StatsLogger's two mappers do, and every time is
// converted by the unit runstats-schema.json records for its field.

import { gameRankings, rebuildTotals, totalsMatch, draftRate } from "./rankings.js";
import { infoBadge, withTip } from "./tip.js";
import { rawSuffix, compareCells } from "./arrays.js";

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

const INTRO =
  "What the game keeps about this profile's run in its statistics log: the totals below, and " +
  "the rankings it builds from them. The rankings are not saved - the game works them out " +
  "each time the Mt Holly Scrapbook is opened.";

const DAILY_INTRO = "What the game's statistics log recorded about one day.";

const READING_NOTICE =
  "The game appears to have several bugs in how it records these times, so they are often wrong.";

// The rarity a Rarity Shift sets, as in the Rarity Shifts table.
const RARITY = { 1: "Commonplace", 2: "Standard", 3: "Unusual", 4: "Rare" };

const RANKINGS = [
  { key: "mostDrafted", title: "Most drafted", value: (e) => plural(e.built, "draft"),
    note: "Rooms by how often you have drafted them. The Secret Garden and Room 8 are not " +
          "counted, and the game counts every outer room you draft twice. Of two rooms drafted " +
          "equally often, the one discarded less comes first." },
  { key: "bestDraftRate", title: "Best draft rate", value: rateText,
    note: "Of the rooms drafted or discarded at least three times in all, the one you drafted " +
          "the largest share of the time. The Secret Garden and Room 8 are not counted, an " +
          "outer room's drafts count twice here too, and the game names only the first." },
  { key: "worstDraftRate", title: "Worst draft rate", value: rateText,
    note: "The three rooms with the smallest share, from the same rooms as the best draft " +
          "rate; lowest first." },
  { key: "mostGems", title: "Most gems spent", value: (e) => plural(e.gems, "gem"),
    note: "Gems spent drafting each room. The Secret Garden and Room 8 are not counted." },
  { key: "mostTime", title: "Most time spent", value: (e) => duration(e.time),
    note: "Time spent in each room; every room is counted here." },
  { key: "coatChecks", title: "Most coat-checked", value: (e) => plural(e.coat, "day"), item: true,
    note: "The items that have spent the most days at the Coat Check: an item counts once for " +
          "every day that ends with it there, however long ago you left it." },
];

const problem = (stats) => {
  const box = el("p", "warn stats-problem");
  box.append(el("strong", null, "No statistics. "), stats.error);
  return [box];
};

/** The blocks of the Stats page. `stats` is {doc} or {error}; `runstats` the schema. */
export function statsPage(stats, runstats) {
  if (stats?.error) return problem(stats);
  const doc = stats.doc;
  const names = nameLookup(runstats);
  const out = [el("p", "muted explain stats-intro", INTRO)];

  if (!totalsMatch(doc, rebuildTotals(doc))) {
    out.push(el("p", "warn compact",
      "The saved totals do not add up to the days recorded. The game builds its rankings from " +
      "the days, so the rankings below do too, and the tables show what is saved."));
  }
  out.push(rankingBlock(gameRankings(doc), names), ...totalsBody(doc, names, runstats));
  if (doc.SaveGUID) out.push(el("p", "muted stats-guid", `Statistics log id ${doc.SaveGUID}`));
  return out;
}

/** The blocks of the Daily Stats page: `want` is the day number to show, the latest when it
 *  names no recorded day; `go(n)` moves to day n. */
export function dailyPage(stats, runstats, want = null, go = () => {}) {
  if (stats?.error) return problem(stats);
  const days = stats.doc.DaysData?.Days ?? [];
  const out = [el("p", "muted explain stats-intro", DAILY_INTRO)];
  if (!days.length) {
    out.push(el("p", "muted stats-no-days",
      "No day has been recorded in this statistics log yet: a day's record is added when it starts."));
    return out;
  }
  const day = days.find((d) => d.Num === want) ?? days[days.length - 1];
  out.push(dayPicker(days, day, runstats, go), ...dayBody(day, nameLookup(runstats), runstats));
  return out;
}

function totalsBody(doc, names, runstats) {
  const out = [];
  out.push(section("Rooms", "Summary of all rooms drafted in the entire run. The game counts " +
    "every outer room you draft twice.",
    roomsTable(doc.GlobalRoomStats?.Rooms ?? [], names, runstats), "stats-rooms"));
  out.push(section("Coat Check", "How many days each item has spent at the Coat Check: every day " +
    "that ended with it there counts, not only the day you left it.",
    itemsTable(doc.GlobalItemStats?.Items ?? [], names), "stats-items"));
  out.push(section("Reading time", "Time spent with each document open. " + unitNote(runstats, "TimerEntry.Time"),
    timersTable(doc.GlobalTimerStats?.Timers ?? [], runstats), "stats-timers", READING_NOTICE));
  out.push(section("Books", "The days on which each book was looked at.",
    booksTable(doc.GlobalBookStats?.Books ?? [], runstats), "stats-books"));
  return out;
}

// ---------------------------------------------------------------- one day

function dayPicker(days, day, runstats, go) {
  const order = days.map((d) => d.Num);
  const at = order.indexOf(day.Num);
  const bar = el("div", "toolbar day-picker stats-day-picker");
  const step = (text, label, to, key) => {
    const b = el("button", "step", text);
    b.type = "button";
    b.dataset.focusKey = key;
    b.setAttribute("aria-label", label);
    b.disabled = to < 0 || to >= order.length;
    b.addEventListener("click", () => go(order[to]));
    return b;
  };
  const select = el("select", "day-select stats-day-select");
  select.dataset.focusKey = "stats-day-select";
  days.forEach((d, i) => {
    const o = el("option", null, dayLabel(d, runstats));
    o.value = String(d.Num);
    o.selected = i === at;
    select.append(o);
  });
  select.addEventListener("change", () => go(Number(select.value)));
  bar.append(step("◀", "Previous day", at - 1, "stats-day-prev"), select,
             step("▶", "Next day", at + 1, "stats-day-next"),
             el("span", "muted list-note", `${days.length} days recorded`));
  return bar;
}

function dayLabel(d, runstats) {
  const status = enumName(runstats, "DayStatus", d.Status);
  const len = duration(seconds(runstats, "DayTimelineData.Duration", d.Timeline?.Duration ?? 0));
  return `Day ${d.Num} · ${len}` + (status && status !== "Completed" ? ` · ${status.toLowerCase()}` : "");
}

function dayBody(d, names, runstats) {
  const status = enumName(runstats, "DayStatus", d.Status) ?? `status ${d.Status}`;
  const events = d.Timeline?._rawEvents ?? [];
  const line = el("p", "day-summary");
  line.append(el("strong", null, `Day ${d.Num}`),
    ` · ${status} · ${duration(seconds(runstats, "DayTimelineData.Duration", d.Timeline?.Duration ?? 0))} long` +
    ` · ${plural(events.length, "event")}`);
  // The day's own figures come straight under the summary line, with no heading of their own.
  const stats = el("section", "stats-section stats-daystats");
  stats.append(dayStatsList(d.DayStats ?? {}, names, runstats));
  return [
    line,
    stats,
    section("Rooms", "Each room recorded on this day: how often you drafted it and discarded it, " +
      "the gems you spent drafting it and the time you spent in it. An outer room you drafted " +
      "shows as drafted twice.",
      roomsTable(d.RoomData?.Rooms ?? [], names, runstats), "stats-rooms"),
    section("Coat Check", "The item at the Coat Check when this day ended, whether you left it " +
      "this day or earlier.",
      itemsTable(d.ItemData?.Items ?? [], names), "stats-items"),
    section("Reading time", "Time spent with each document open on this day. The timeline below " +
      "shows each time a document was opened.", timersTable(d.Timers?.Timers ?? [], runstats),
      "stats-timers", READING_NOTICE),
    section("Timeline", "Everything the game logged during the day, in order, with the time " +
      "into the day.", timelineTable(events, names, runstats), "stats-timeline"),
  ];
}

// DayStatsData's fields, in the game's order, from the schema. A field whose type is a room or
// one of the game's enums is shown by name; CoatCheckItem holds an item id, -1 for none. A room
// field is -1 on a day it was never set (OuterRoom on a day with no outer room) and 0, the
// placeholder slot, when the game's name lookup missed (OuterRoom on a Shelter day), so
// both read as none.
const noneValue = (f, v) =>
  (f.name === "CoatCheckItem" && v < 0) || (f.type === "RoomID" && v <= 0);
// The day stats in cards of related figures, arranged in four stacks of about the same height:
// the last card of each stack stretches, so the columns end on one line. On a narrower page the
// stacks pair up - 1 with 2, 3 with 4 - which is why the pairs are balanced too. Every card in
// the stacks has a fixed number of one-line rows, so the balance holds on any day. The Lab card
// does not - its cause and effect sentences vary in length, and are empty on a day without an
// experiment - so it sits below the stacks at full width, where a sentence fits on one line. A
// card may have parts, each with a small caption. A stat a later build adds, and no card lists,
// goes to an Other card on the last stack, so nothing is dropped.
const DAY_STAT_STACKS = [
  [
    ["Progress", [[null, ["RoomsNumber", "RankReached", "StepsUsed", "IvDicesUsed", "RedrawsCount",
                          "ItemsFound", "NewRoomsDrafted"]]]],
    ["Puzzles", [[null, ["ParlorsPuzzlesCorrect", "ParlorsPuzzlesIncorrect", "DartsSolved",
                         "DartsPuzzleTried"]]]],
  ],
  [
    ["Resources", [["Carried over", ["Stars", "Allowance"]],
                   ["Left at the end of the day", ["StepsLeft", "KeysLeft", "GemsLeft", "GoldLeft",
                                                   "IvDicesLeft"]]]],
    ["Casino", [[null, ["CasinoBalance", "CasinoSlotBalance"]]]],
  ],
  [
    ["Purchases & Trades", [[null, ["PurchasesKitchen", "PurchasesCommissary", "PurchasesLocksmith",
                                    "Trades", "SpecialOrder"]]]],
    ["Miscellaneous", [[null, ["CoatCheckItem", "MechaDoorsOpen", "CloisterSuccess", "SecretPassColor"]]]],
    ["Blessings", [[null, ["Blessing", "BlessingCoins"]]]],
  ],
  [
    ["Exams", [[null, ["ClassNums", "ExamScore", "ExamColors", "ExamScience", "ExamArt", "ExamAlgebra",
                       "ExamMath", "ExamGeography", "ExamHistory", "ExamErajan"]]]],
    ["Rooms", [[null, ["LastRoom", "OuterRoom"]]]],
  ],
];
const DAY_STAT_FULL = [
  ["Lab", [[null, ["LabTriggers", "LabLetters", "LabExperimentCause", "LabExperimentEffect"]]]],
];

function dayStatsList(stats, names, runstats) {
  const fields = runstats?.types?.find((t) => t.name === "DayStatsData")?.fields
    ?.filter((f) => f.serialized) ?? Object.keys(stats).map((name) => ({ name, type: typeof stats[name] }));
  const byName = new Map(fields.filter((f) => stats[f.name] !== undefined).map((f) => [f.name, f]));
  const listed = new Set([...DAY_STAT_STACKS.flat(), ...DAY_STAT_FULL]
    .flatMap(([, parts]) => parts.flatMap(([, m]) => m)));
  const other = [...byName.keys()].filter((n) => !listed.has(n));
  const stacks = DAY_STAT_STACKS.map((s, i) =>
    i === DAY_STAT_STACKS.length - 1 && other.length ? [...s, ["Other", [[null, other]]]] : s);

  const row = (n) => {
    const f = byName.get(n), v = stats[n];
    const dd = el("dd", null);
    dd.append(statValue(f, v, names, runstats));
    // A text value (the Laboratory's cause and effect sentences) gets a line of its own.
    const r = el("div", f.type === "string" || typeof v === "string" ? "day-stat wide" : "day-stat");
    r.append(statLabel(n), dd);
    return r;
  };
  const cardFor = ([title, parts], cls) => {
    const shown = parts.map(([caption, m]) => [caption, m.filter((n) => byName.has(n))])
      .filter(([, m]) => m.length);
    if (!shown.length) return null;
    const card = el("div", cls);
    card.dataset.group = title;
    card.append(el("h4", null, title));
    for (const [caption, members] of shown) {
      if (caption) card.append(el("p", "day-stat-part", caption));
      const dl = el("dl");
      dl.append(...members.map(row));
      card.append(dl);
    }
    return card;
  };
  const box = el("div", "day-stat-groups");
  for (const stack of stacks) {
    const column = el("div", "day-stat-stack");
    column.append(...stack.map((c) => cardFor(c, "day-stat-group")).filter(Boolean));
    box.append(column);
  }
  box.append(...DAY_STAT_FULL.map((c) => cardFor(c, "day-stat-group full")).filter(Boolean));
  return box;
}

function statValue(f, v, names, runstats) {
  if (noneValue(f, v)) return "none";
  if (f.name === "CoatCheckItem") return named(v, names.item(v), "item");
  if (f.type === "RoomID") return named(v, names.room(v), "room");
  if (f.type === "bool" || typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "string") return v || "-";
  if (runstats?.types?.some((t) => t.name === f.type && t.constants)) return enumCell(runstats, f.type, v);
  return String(v);
}

// RoomsNumber -> Rooms Number; IvDicesLeft -> Iv Dices Left. A name whose words say too little
// gets a label of its own: MechaDoorsOpen is copied at day end from the Mechanarium's door count.
const STAT_LABELS = {
  MechaDoorsOpen: "Mechanarium Doors Open", IvDicesUsed: "Ivory Dices Used", IvDicesLeft: "Ivory Dices Left",
};
const words = (name) => STAT_LABELS[name] ?? name.replace(/([a-z])([A-Z])/g, "$1 $2");

// Day stats that are running totals for the whole profile: the day's end copies them from the
// profile itself rather than from a count kept for the day, and nothing in the game ever lowers
// them. Stars and Allowance are copied from the profile too but are balances - the Inkwell costs
// a star, the Spiral of Stars two, and the Laundry's Star Treatment swaps the two - so they are
// not marked.
const RUNNING = new Set(["DartsSolved", "ParlorsPuzzlesCorrect", "ParlorsPuzzlesIncorrect", "LabLetters"]);
const RUNNING_TIP = "This value accumulates as days pass.";

// What a day stat means, where its name does not say. Each was traced to what writes it: the
// day-end copy of a counter, a room's own state, or the Casino's and Trading Post's code.
const STAT_NOTES = {
  ClassNums: "How many Classrooms you drafted this day.",
  ExamScore: "How many of the final exam's 46 questions you answered correctly, on a day you sat " +
             "it. The Exam lines below give each subject as a percentage.",
  LabLetters: "The letters your Laboratory experiments have delivered to the Mail Room.",
  LastRoom: "The room you were in when the day ended. None when the day ended somewhere that is " +
            "not one of the estate's rooms - out on the grounds or underground, for example.",
  // Standalone Door Code looks the room up in Room ID by its ROOM NAME, "Bomb Shelter"; the
  // table files it as "Shelter", so its day records 0.
  OuterRoom: "The outer room you drafted this day. None on a day you drafted " +
             "the Shelter: the game looks it up under the wrong name, though the Rooms table " +
             "below still counts the draft.",
  CasinoBalance: "Gold won minus gold lost at the Casino this day, at roulette and the slot " +
                 "machines together. Below zero means you lost.",
  CasinoSlotBalance: "The slot machines' part of the Casino Balance: gold paid out minus the gold " +
                     "a pull or a reroll costs.",
  BlessingCoins: "The gold you offered at the Shrine for this day's blessing.",
  CloisterSuccess: "How many bonuses the upgraded Cloister gave you this day.",
  SpecialOrder: "The item you ordered this day at a computer terminal. It is delivered the next " +
                "morning and goes on sale the next time you draft the Commissary.",
  // The Freezer's amounts are never cleared, and the day-end record reads them without asking
  // whether anything is still frozen.
  GemsLeft: "The gems you had when the day ended - but not from the day the Freezer first " +
            "freezes some of your gems or gold. The game never forgets how much the Freezer " +
            "froze, and from then on, every day, it records that here instead: the gold it " +
            "froze if there was any, otherwise the gems.",
  GoldLeft: "The gold you had when the day ended - but 0 from the day the Freezer first freezes " +
            "some of your gold, and every day after. The game never forgets how much the Freezer " +
            "froze, and while that includes gold it does not record this figure at all.",
};

// A stat shown under a label of its own keeps its field name in the (i), as on the Fields page.
function statLabel(name) {
  const dt = el("dt", null, words(name));
  if (RUNNING.has(name)) {
    const mark = el("span", "running-total");
    mark.setAttribute("role", "img");
    mark.setAttribute("aria-label", "running total");
    dt.append(withTip(mark, RUNNING_TIP));
  }
  const renamed = name in STAT_LABELS;
  if (STAT_NOTES[name] || renamed) dt.append(infoBadge(STAT_NOTES[name] ?? "", renamed ? name : null));
  return dt;
}

function timelineTable(events, names, runstats) {
  if (!events.length) return el("p", "muted empty", "Nothing logged on this day.");
  const table = el("table", "array-table stats-table timeline-table");
  const head = el("tr");
  for (const t of ["Time", "Event", "Detail"]) head.append(el("th", null, t));
  const thead = el("thead");
  thead.append(head);
  const tbody = el("tbody");
  for (const raw of events) {
    let e;
    try { e = JSON.parse(raw); } catch { e = null; }
    const tr = el("tr", "timeline-row");
    if (!e) {
      tr.append(el("td"), el("td", "unknown", "unreadable event"), el("td", null, String(raw)));
      tbody.append(tr);
      continue;
    }
    const name = enumName(runstats, "EventID", e.E);
    const ev = el("td");
    ev.append(name ? readable(name) : named(e.E, null, "event"));
    const detail = el("td");
    detail.append(...eventDetail(e, names, runstats));
    tr.append(el("td", "num", clock(seconds(runstats, "DayEventData.T", e.T ?? 0))), ev, detail);
    tbody.append(tr);
  }
  table.append(thead, tbody);
  return table;
}

// The extra fields of an event's subclass (runstats-schema.json `raw_events`), in words.
function eventDetail(e, names, runstats) {
  if ("Timer" in e) {
    const doc = enumCell(runstats, "TimerID", e.Timer);
    const d = seconds(runstats, "TimerStartEvent.Duration", e.Duration ?? 0);
    return [doc, d > 0 ? ` · open ${duration(d)}, closed by clicking beside it`
                       : " · not closed by clicking beside it, so its timer ran to the end of the day"];
  }
  if ("Rarity" in e) return [named(e.RoomID, names.room(e.RoomID), "room"), ` → ${RARITY[e.Rarity] ?? `rarity ${e.Rarity}`}`];
  if ("ItemID" in e) return [named(e.ItemID, names.item(e.ItemID), "item")];
  if ("RoomID" in e) return [named(e.RoomID, names.room(e.RoomID), "room"), e.Gems ? ` · ${plural(e.Gems, "gem")}` : ""];
  return [];
}

// ---------------------------------------------------------------- names

function nameLookup(runstats) {
  const space = (key) => runstats?.id_names?.[key]?.labels ?? [];
  const rooms = space("RoomID"), items = space("ItemID");
  return {
    room: (id) => (id > 0 && rooms[id]) || null,
    item: (id) => (id >= 0 && items[id]) || null,
  };
}

/** A room or item by name, or - for an id the lists do not cover - its number, flagged. */
function named(id, name, what) {
  if (name) return el("span", null, name);
  const s = el("span", "unknown", `unknown ${what}`);
  s.append(rawSuffix(id));
  return s;
}

const enumName = (runstats, type, value) =>
  runstats?.types?.find((t) => t.name === type)?.constants?.find((c) => c.value === value)?.name ?? null;

// Read_OrindaHistory -> Orinda History; Swim_bird -> Swim bird.
function readable(name) {
  return name.replace(/^Read_/, "").replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
}

function unitNote(runstats, field) {
  const u = runstats?.units?.[field];
  if (!u) return "";
  return u.verified ? "" : `The game records it in ${u.unit}; that unit is assumed from the ` +
    `game's day timeline, not checked independently.`;
}

// ---------------------------------------------------------------- the rankings

function rankingBlock(ranks, names) {
  const sec = el("section", "stats-rankings");
  const head = el("h3");
  head.append("Rankings", infoBadge("Worked out as the game does it, from the days in the " +
    "statistics log, down to the order of rooms that tie: the game's own sort is run on the " +
    "same list, so each card shows what the Mt Holly Scrapbook shows, in its order. Rooms tied " +
    "with the last one shown that the game leaves out are named under the card."));
  sec.append(head);
  const grid = el("div", "ranking-grid");
  for (const r of RANKINGS) grid.append(rankingCard(r, ranks[r.key], names));
  sec.append(grid);
  return sec;
}

function rankingCard(spec, rank, names) {
  const card = el("div", "ranking");
  card.dataset.ranking = spec.key;
  const h = el("h4");
  h.append(spec.title, infoBadge(spec.note));
  card.append(h);
  if (!rank.shown.length) {
    card.append(el("p", "muted", "Nothing to rank yet."));
    return card;
  }
  const ol = el("ol", "ranking-list");
  let place = 0;
  rank.shown.forEach((e, i) => {
    if (!rank.level[i]) place = i + 1;
    const li = el("li");
    li.dataset.id = String(e.id);
    li.append(el("span", "place", `${place}`),
              named(e.id, spec.item ? names.item(e.id) : names.room(e.id), spec.item ? "item" : "room"),
              el("span", "ranking-value", spec.value(e)));
    ol.append(li);
  });
  card.append(ol);
  if (rank.tied.length) {
    const who = rank.tied.map((e) => (spec.item ? names.item(e.id) : names.room(e.id)) ?? `#${e.id}`);
    card.append(el("p", "muted tie-note",
      `Tied with the last one shown, but left out by the game: ${who.join(", ")}.`));
  }
  return card;
}

// ---------------------------------------------------------------- the tables

function section(title, explanation, body, cls, notice) {
  const sec = el("section", `stats-section ${cls}`);
  sec.append(el("h3", null, title), el("p", "muted explain", explanation));
  if (notice) sec.append(el("p", "warn compact", notice));
  sec.append(body);
  return sec;
}

/** A table that sorts by any column; the first column is the game's own order. */
function sortableTable(columns, rows) {
  if (!rows.length) return el("p", "muted empty", "Nothing recorded yet.");
  const trs = rows.map((r, i) => {
    const tr = el("tr", "stats-row");
    tr.append(el("td", "index", String(i + 1)));
    for (const c of columns) {
      const td = el("td", c.num ? "num" : null);
      td.append(c.show(r));
      tr.append(td);
    }
    return tr;
  });
  const all = [{ title: "#", sort: (r, i) => i }, ...columns];
  const head = el("tr");
  const tbody = el("tbody");
  let sortCol = 0, dir = 1;
  const buttons = all.map((c, k) => {
    const th = el("th", c.num ? "num" : null);
    const b = el("button", "sort", c.title);
    b.type = "button";
    b.addEventListener("click", () => {
      dir = k === sortCol ? -dir : 1;
      sortCol = k;
      const order = rows.map((r, i) => ({ r, i }))
        .sort((x, y) => dir * compareCells(all[k].sort(x.r, x.i), all[k].sort(y.r, y.i)) || x.i - y.i);
      tbody.replaceChildren(...order.map(({ i }) => trs[i]));
      buttons.forEach(({ th: t, b: bb, title }, j) => {
        bb.textContent = j === k ? `${title} ${dir > 0 ? "▲" : "▼"}` : title;
        t.setAttribute("aria-sort", j === k ? (dir > 0 ? "ascending" : "descending") : "none");
      });
    });
    th.append(b);
    head.append(th);
    return { th, b, title: c.title };
  });
  tbody.append(...trs);
  const thead = el("thead");
  thead.append(head);
  const t = el("table", "array-table stats-table");
  t.append(thead, tbody);
  return t;
}

function roomsTable(rooms, names, runstats) {
  const time = (r) => seconds(runstats, "RoomStatsEntry.time", r.time);
  return sortableTable([
    { title: "Room", sort: (r) => names.room(r.id) ?? "", show: (r) => named(r.id, names.room(r.id), "room") },
    { title: "Drafted", num: true, sort: (r) => r.built, show: (r) => String(r.built) },
    { title: "Discarded", num: true, sort: (r) => r.discarded, show: (r) => String(r.discarded) },
    { title: "Draft rate", num: true, sort: (r) => draftRate(r), show: (r) => percent(draftRate(r), r) },
    { title: "Gems", num: true, sort: (r) => r.gems, show: (r) => String(r.gems) },
    { title: "Time", num: true, sort: (r) => r.time, show: (r) => duration(time(r)) },
  ], rooms);
}

function itemsTable(items, names) {
  return sortableTable([
    { title: "Item", sort: (r) => names.item(r.id) ?? "", show: (r) => named(r.id, names.item(r.id), "item") },
    { title: "Days", num: true, sort: (r) => r.coat, show: (r) => String(r.coat) },
  ], items);
}

function timersTable(timers, runstats) {
  return sortableTable([
    { title: "Document", sort: (r) => enumName(runstats, "TimerID", r.ID) ?? "", show: (r) => enumCell(runstats, "TimerID", r.ID) },
    { title: "Time", num: true, sort: (r) => r.Time, show: (r) => duration(seconds(runstats, "TimerEntry.Time", r.Time)) },
  ], timers);
}

function booksTable(books, runstats) {
  return sortableTable([
    { title: "Book", sort: (r) => enumName(runstats, "BookID", r.ID) ?? "", show: (r) => enumCell(runstats, "BookID", r.ID) },
    { title: "Days", num: true, sort: (r) => (r.DaysChecked ?? []).length, show: (r) => String((r.DaysChecked ?? []).length) },
    { title: "Which days", sort: (r) => (r.DaysChecked ?? [])[0] ?? 0, show: (r) => (r.DaysChecked ?? []).join(", ") },
  ], books);
}

const ENUM_NOUN = { TimerID: "document", BookID: "book" };

function enumCell(runstats, type, value) {
  const name = enumName(runstats, type, value);
  if (!name) return named(value, null, ENUM_NOUN[type] ?? "value");
  const s = el("span", null, readable(name));
  s.append(rawSuffix(value));
  return s;
}

// ---------------------------------------------------------------- formatting

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function rateText(e) {
  return `${percent(draftRate(e))} (${e.built} of ${e.built + e.discarded})`;
}

function percent(rate, e) {
  if (e && e.built + e.discarded === 0) return "-";
  const p = rate * 100;
  return `${p >= 10 || p === 0 ? Math.round(p) : p.toFixed(1)}%`;
}

/** A stored time in seconds, by the unit the schema records for its field. */
function seconds(runstats, field, value) {
  const unit = runstats?.units?.[field]?.unit;
  return unit === "centiseconds" ? value / 100 : value;
}

/** Seconds into the day as h:mm:ss, or m:ss under an hour. */
function clock(secs) {
  const s = Math.floor(secs);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(x)}` : `${m}:${pad(x)}`;
}

/** Seconds as hours and minutes, minutes and seconds, or seconds. */
export function duration(seconds) {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h) return `${h} h ${String(m).padStart(2, "0")} min`;
  if (m) return `${m} min ${String(sec).padStart(2, "0")} s`;
  return `${sec} s`;
}
