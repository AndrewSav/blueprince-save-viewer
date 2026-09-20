// The profile's arrays, laid out on the pages they belong to. The dictionary (fields-schema.json)
// says what each array is and how to show it - its `view` - and the view's kind decides the
// page: tables go to Rarity Shifts / Room Records, sequences the Parlor works through go to
// Parlor, DATA and History Data have views of their own, and the rest go to Arrays. A decoded
// value shows its raw code after it, because a decoding is only as good as the data behind
// it.

import { display } from "./save.js";
import { appendExplanation } from "./tip.js";

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

/** An element as a person would read it: strings unquoted, everything else verbatim. */
export function itemText(arr, raw) {
  if (arr.type !== "String") return raw;
  try { return JSON.parse(raw); } catch { return raw; }
}

/** The page an array belongs on, or null for one that is not shown with the others. */
export function pageFor(field) {
  switch (field?.view?.kind) {
    case "own-view": return null;
    case "table": case "table-part": return "rooms";
    case "order": return "parlor";
    default: return "arrays";
  }
}

/** The raw code after a decoded value, muted. */
export function rawSuffix(raw) {
  return el("span", "raw", String(raw));
}

/** The blocks for one page: every array of `slot` that belongs there. `fieldOf(name)` is the
 *  dictionary entry; `dormant(field, arr)` applies the dormant rule, and `mark(heading, field,
 *  block, state)` labels a dormant array that is shown, `state` being "show" or "unexpected" -
 *  one that is not shown is left out by `dormant`. */
export function arrayPage(page, slot, fieldOf, dormant, mark) {
  const out = [];
  solutions = [];
  for (const [name, arr] of slot.arrays) {
    const field = fieldOf(name);
    // Half of a two-array table is shown inside the other half's.
    if (pageFor(field) !== page || field?.view?.kind === "table-part") continue;
    const state = dormant(field, arr);
    if (state === "hide") continue;
    const block = page === "rooms" ? tableSection(name, arr, field, slot) : arrayBlock(name, arr, field, slot);
    if (state === "show" || state === "unexpected") mark(block.children[0], field, block, state);
    out.push(block);
  }
  // The answers are a spoiler, so one switch for the page covers every puzzle on it.
  if (solutions.length) out.unshift(solutionToggle(solutions));
  solutions = null;
  return out;
}

// Collects the "holds the gems" labels while a page is being built, so the toggle above them
// can reach every one without the page having to be searched afterwards.
let solutions = null;

const REMEMBER = "blueprince.parlor.showSolutions";

function remembered() {
  try { return localStorage.getItem(REMEMBER) === "yes"; } catch { return false; }
}

function remember(on) {
  try { localStorage.setItem(REMEMBER, on ? "yes" : "no"); } catch { /* private window */ }
}

function solutionToggle(spans) {
  const label = el("label", "table-filter");
  const box = el("input");
  box.type = "checkbox";
  box.id = "show-solutions";
  box.checked = remembered();
  const apply = () => spans.forEach((s) => { s.hidden = !box.checked; });
  box.addEventListener("change", () => { remember(box.checked); apply(); });
  label.append(box, ` Show which box holds the gems (${spans.length} puzzles)`);
  apply();
  return label;
}

function arrayBody(arr, field, slot) {
  const view = field?.view;
  if (!arr.items.length) return el("p", "muted empty", "Empty.");
  switch (view?.kind) {
    case "table": return table(arr, slot.arrays.get(view.values), view);
    case "indexed": return indexed(arr, view);
    case "values": return values(arr, view);
    case "order": return order(arr, view, slot.objs.get(view.cursor));
    default: return plain(arr);
  }
}

function arrayBlock(name, arr, field, slot) {
  const sec = el("section", "array-block");
  // Lets a test find each view and count its entries against the save.
  sec.dataset.array = name;
  sec.append(el("h3", null, field?.view?.title ?? name));
  // The explanation and, where there is one, the condition under which the list is used are
  // one short line together rather than two stacked ones.
  const note = el("p", "muted explain");
  if (field?.explanation) appendExplanation(note, field.explanation);
  if (field?.view?.band) {
    note.append(el("span", "band",
      `${field?.explanation ? " " : ""}Served while Parlor Score is ${field.view.band}.`));
  }
  if (note.children.length) sec.append(note);
  sec.append(arrayBody(arr, field, slot));
  return sec;
}

// The tables are long, so each sits in a section that can be folded away; both start open.
function tableSection(name, arr, field, slot) {
  const det = el("details", "table-section");
  det.open = true;
  det.dataset.array = name;
  det.append(el("summary", null, field?.view?.title ?? field?.table?.table ?? name));
  if (field?.explanation) det.append(appendExplanation(el("p", "muted explain"), field.explanation));
  det.append(arrayBody(arr, field, slot));
  return det;
}

function labelled(text, raw, cls = "") {
  const span = el("span", cls, text);
  // A true/false code says nothing its label does not.
  if (raw !== "true" && raw !== "false") span.append(rawSuffix(raw));
  return span;
}

/** Compare two cells: as numbers when both are numbers, otherwise as text. */
export function compareCells(a, b) {
  const x = Number(a), y = Number(b);
  if (a !== "" && b !== "" && !Number.isNaN(x) && !Number.isNaN(y)) return x - y;
  return String(a).localeCompare(String(b));
}

function table(keys, values, view) {
  const box = el("div", "array-view");
  const vals = values?.items ?? [];
  if (vals.length !== keys.items.length) {
    box.append(el("p", "warn",
      `The two halves of this table differ in length (${keys.items.length} names, ` +
      `${vals.length} values), so they cannot be lined up reliably.`));
  }
  const rows = keys.items.map((raw, i) => ({
    i, key: itemText(keys, raw), value: i < vals.length ? itemText(values, vals[i]) : "",
  }));
  const trs = rows.map((r) => {
    const isSentinel = view.sentinel && r.key === view.sentinel;
    const tr = el("tr", "array-entry" + (isSentinel ? " sentinel" : ""));
    tr.append(el("td", "index", String(r.i + 1)));
    tr.append(el("td", null, isSentinel ? `${r.key} (a placeholder in the list, not an entry)` : r.key));
    const td = el("td");
    const label = view.value_labels?.[r.value];
    td.append(label !== undefined ? labelled(label, r.value) : el("span", null, r.value));
    tr.append(td);
    return tr;
  });

  // Sort by any column; "#" is the game's own order, so it is always possible to go back.
  // Values sort by their raw value, which puts Commonplace..Rare in rarity order.
  const columns = [["#", (r) => r.i], [view.columns?.[0] ?? "Key", (r) => r.key],
                   [view.columns?.[1] ?? "Value", (r) => r.value]];
  const tbody = el("tbody");
  const head = el("tr");
  const buttons = columns.map(([title], c) => {
    const th = el("th");
    const button = el("button", "sort", title);
    button.type = "button";
    button.addEventListener("click", () => sortBy(c));
    th.append(button);
    head.append(th);
    return { th, button, title };
  });
  let sortCol = 0, dir = 1;
  function sortBy(c) {
    dir = c === sortCol ? -dir : 1;
    sortCol = c;
    const get = columns[c][1];
    const order = rows.slice().sort((a, b) => dir * compareCells(get(a), get(b)) || a.i - b.i);
    tbody.replaceChildren(...order.map((r) => trs[r.i]));
    buttons.forEach(({ th, button, title }, k) => {
      button.textContent = k === c ? `${title} ${dir > 0 ? "▲" : "▼"}` : title;
      th.setAttribute("aria-sort", k === c ? (dir > 0 ? "ascending" : "descending") : "none");
    });
  }
  tbody.append(...trs);

  // A value whose rows say nothing - a room whose rarity was never changed - can be hidden,
  // and is by default. The rows stay in the table, only out of sight.
  if (view.hide_value !== undefined) {
    const hideable = rows.filter((r) => r.value === view.hide_value).length;
    const label = el("label", "table-filter");
    const box2 = el("input");
    box2.type = "checkbox";
    box2.checked = true;
    const apply = () => rows.forEach((r) => { trs[r.i].hidden = box2.checked && r.value === view.hide_value; });
    box2.addEventListener("change", apply);
    label.append(box2, ` Hide the ${hideable} marked "${view.value_labels?.[view.hide_value] ?? view.hide_value}"`);
    box.append(label);
    apply();
  }

  const t = el("table", "array-table");
  const thead = el("thead");
  thead.append(head);
  t.append(thead, tbody);
  box.append(t);
  return box;
}

function indexed(arr, view) {
  const list = el("ul", "array-view array-list");
  arr.items.forEach((raw, i) => {
    const v = itemText(arr, raw);
    const li = el("li", "array-entry");
    const name = view.labels?.[i];
    li.append(el("span", "entry-key" + (name ? "" : " unknown"), name ?? `#${i} (not named)`), ": ");
    const label = view.value_labels?.[v];
    li.append(label !== undefined ? labelled(label, v) : el("span", null, v));
    list.append(li);
  });
  return list;
}

function values(arr, view) {
  const list = el("ol", "array-view array-list");
  for (const raw of arr.items) {
    const v = itemText(arr, raw);
    const li = el("li", "array-entry");
    const label = view.value_labels?.[v];
    li.append(label !== undefined ? labelled(label, v) : labelled(`unknown id`, v, "unknown"));
    list.append(li);
  }
  return list;
}

// A sequence the game works through from the front: the entries before the position it keeps
// are past, the one at it is next, the rest are still to come. Each group is shown under its
// own heading rather than hinted at by colour or a tooltip.
function order(arr, view, cursorEntry) {
  const box = el("div", "array-view");
  const items = arr.items.map((raw, i) => ({ i, id: String(itemText(arr, raw)) }));
  const pos = cursorEntry ? Number(display(cursorEntry)) : NaN;
  if (!Number.isInteger(pos) || pos < 0) {
    box.append(el("p", "muted", `No position recorded, so past and future cannot be told apart.`),
               numbered(items, "", view));
    return box;
  }
  const groups = [["Past", items.slice(0, pos), "past"], ["Next", items.slice(pos, pos + 1), "next"],
                  ["Future", items.slice(pos + 1), "future"]];
  for (const [title, list, cls] of groups) {
    if (!list.length) continue;
    box.append(el("h4", "order-group", list.length > 1 ? `${title} (${list.length})` : title),
               numbered(list, cls, view));
  }
  if (pos >= items.length) box.append(el("p", "muted", `All ${items.length} have been given.`));
  return box;
}

function numbered(list, cls, view) {
  const ol = el("ol", "array-list" + (cls ? ` ${cls}` : ""));
  if (list.length) ol.start = list[0].i + 1;
  for (const { id } of list) {
    const li = el("li", "array-entry" + (cls ? ` ${cls}` : ""));
    const puzzle = view?.puzzles?.[id];
    li.append(el("span", "entry-key", `${view?.item ?? "Item"} ${id}`));
    if (puzzle) li.append(boxes(puzzle));
    ol.append(li);
  }
  if (view?.puzzles) ol.classList.add("puzzles");
  return ol;
}

/** What is written on each of the three boxes, and - only once the page's toggle is on -
 *  which one holds the gems. A box with nothing on it is part of the puzzle: one of them
 *  says so about another, so it is shown as empty rather than left out. */
function boxes(puzzle) {
  const dl = el("dl", "puzzle");
  for (const [name, text] of Object.entries(puzzle.boxes)) {
    dl.append(el("dt", `box ${name.toLowerCase()}`, name));
    const dd = el("dd", text ? null : "muted", text || "(nothing written on it)");
    if (puzzle.solution === name) {
      const tag = el("span", "solution", " holds the gems");
      solutions?.push(tag);
      dd.append(tag);
    }
    dl.append(dd);
  }
  return dl;
}

function plain(arr) {
  const list = el("ol", "array-view array-list plain");
  for (const raw of arr.items) list.append(el("li", "array-entry", String(itemText(arr, raw))));
  return list;
}
