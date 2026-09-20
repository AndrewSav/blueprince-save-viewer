// Fact sheets: everything the game data says about one field, for checking its meaning.
//
// Read from data/field-facts.json and shown
// only in debug mode, under each field on the Fields page, when "fact sheets" is ticked. The
// file is several megabytes, so it is fetched the first time the switch goes on, not with the
// dictionary. Nothing here is interpreted: it lays out who writes and reads the field, whether
// each can run, and the values in the save being viewed, with the checks that flag it for
// review. It is written
// for someone checking a meaning, so it names FSMs, states and actions as the game data does.

import { withTip } from "./tip.js";
import { FAMILY_NOTE } from "./dictionary.js";
import { display } from "./save.js";

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

let loading = null;
// Where each read's copy of a field goes: the traces and the shared nodes they hand on
// to, by id. Kept here once loaded, since a sheet's reads refer to them.
let copyNodes = {};

/** Fetch field-facts.json once; resolves to {sheet(container, name)} or throws. */
export function loadFacts() {
  loading ??= fetch("data/field-facts.json").then(async (res) => {
    if (!res.ok) throw new Error(`Could not load data/field-facts.json (${res.status}). It is committed with the ` +
                                 `viewer, so this checkout or the server is missing it.`);
    const data = await res.json();
    copyNodes = data.copy_nodes ?? {};
    return { gameVersion: data.game_version, sources: data.sources,
             sheet: (container, name) => data.sheets[`${container}/${name}`] ?? null };
  });
  return loading;
}

// A sequence state starts its actions one at a time, each waiting for the one before to finish
// (PlayMaker's FsmState.ActivateActions), unlike a normal state, which starts them all at once.
const SEQUENCE_NOTE = "A sequence state: its actions start one at a time, each waiting for the one before " +
  "to finish. A delayed send or a wait holds up every action after it, a transition among them, so " +
  "nothing earlier in the state is cut short. In a normal state every action starts at once, and an " +
  "event from any of them leaves the state straight away, cancelling its delayed sends.";

const NOUN = { write: ["writer", "writers"],
               copy: ["save of a whole-profile copy", "saves of a whole-profile copy"],
               read: ["reader", "readers"],
               unknown: ["reference of unclear direction", "references of unclear direction"],
               increment: ["read that only feeds an increment", "reads that only feed an increment"],
               unused: ["read whose copy nothing uses", "reads whose copy nothing uses"] };
const KINDS = ["write", "copy", "read", "unknown", "increment", "unused"];
// The shipped file an FSM comes from: a scene, or a prefab the game places at run time.
const SOURCE_NAMES = { level0: "the Initialize scene", level1: "the main menu scene", level2: "the estate scene",
                       sharedassets2: "a prefab (rooms and pickups)", resources: "a Resources prefab" };
const noun = (kind, n) => `${n} ${NOUN[kind][n === 1 ? 0 : 1]}`;
// A read that only feeds an increment (read, add, write back), or whose copy nothing uses, is
// kept apart from the readers; a screen saving its own copy of the whole profile under a slot's
// key (the Blackbridge duplicate and restore screens) apart from the writers.
const kindOf = (r) => (r.kind === "read" && r.increment != null ? "increment"
                       : r.kind === "read" && r.copy_unused ? "unused"
                       : r.kind === "write" && r.via === "saveAll" ? "copy" : r.kind);

/** One line saying what a field's sheet holds, for the row's toggle: its parts, text and the
 *  "family outlier" flag, which opens FAMILY_NOTE. `save` is the save being viewed. */
export function factSummary(sheet, save) {
  const c = sheet.counts;
  const part = (k) => {
    if (!c[k]) return null;
    const n = c[k].live + c[k].dead;
    if (!n) return null;
    const extra = [c[k].dead && `${c[k].dead} dead`, c[k].off && `${c[k].off} off`].filter(Boolean).join(", ");
    return noun(k, n) + (extra ? ` (${extra})` : "");
  };
  const game = (side) => (sheet.native?.[side] ?? []).some((r) => r.game);
  const flags = [sheet.checks?.contradictions?.length && "contradiction",
                 sheet.checks?.no_reader && "no live reader",
                 sheet.checks?.family_outlier && withTip(el("span", null, "family outlier"), FAMILY_NOTE),
                 inNoProfile(sheet, save) && "not in this save"]
    .filter(Boolean);
  // Where the value crosses into the game's own C#: not a problem, so not "flagged".
  // Engine and library C# is left out, as in the sheet's block below.
  const crossings = [game("reaches") && "reaches C# code", game("fed_by") && "set from C# code"].filter(Boolean);
  const out = [KINDS.map(part).filter(Boolean).join(", ") || "no references"];
  if (crossings.length) out.push(" · " + crossings.join(", "));
  if (flags.length) out.push(" · flagged: ", ...flags.flatMap((f, i) => (i ? [", ", f] : [f])));
  return out;
}

/** The whole sheet as a block, its values read from `save`, the save being viewed. */
export function factSheet(sheet, save) {
  const box = el("div", "fact-sheet");
  const head = el("p", "fs-head");
  head.append(el("span", null, sheet.type),
    sheet.category ? el("span", null, ` · developer category ${sheet.category}`) : "",
    el("span", null, sheet.csharp_literal
      ? " · its name is a string in the game's C#, so C# may read or write it too"
      : " · not named in the game's C#, so only the FSMs below touch it"));
  box.append(head);

  const checks = checkLines(sheet, save);
  if (checks.length) {
    const ul = el("ul", "fs-checks");
    for (const c of checks) ul.append(typeof c === "string" ? el("li", null, c) : c);
    box.append(ul);
  }

  box.append(valuesBlock(sheet, save));
  if (sheet.native) box.append(nativeBlock(sheet.native));
  for (const kind of KINDS) {
    const refs = sheet.refs.filter((r) => kindOf(r) === kind);
    if (refs.length) box.append(refsBlock(kind, refs));
  }
  if (!sheet.refs.length) box.append(el("p", "muted", "No action in the game's FSMs names this field."));
  return box;
}

/** Where the field's value crosses into C# and where C# hands one back: the member,
 *  the FSM and state, and how the value gets there. Engine and library members are marked, since
 *  their behaviour is documented rather than hidden. */
function nativeBlock(native) {
  const box = el("div", "fs-native");
  const side = (title, rows) => {
    if (!rows?.length) return;
    box.append(el("div", "fs-native-title", title));
    const ul = el("ul");
    for (const r of rows) {
      const li = el("li", r.game ? null : "muted");
      li.append(el("code", null, r.member),
        el("span", null, ` · ${r.fsm.split("@")[0]} [${r.state}] · ${r.via}`));
      if (!r.game) li.append(el("span", null, ` · ${r.assembly}, not the game's own C#`));
      if (r.does) li.append(el("span", "muted", ` · ${r.does}`));
      if (r.whole) li.append(el("span", "muted", ` · ${r.whole}`));
      ul.append(li);
    }
    box.append(ul);
  };
  side("its value reaches C#", native.reaches);
  side("a write to it takes a value from C#", native.fed_by);
  return box;
}

function checkLines(sheet, save) {
  const out = [];
  for (const c of sheet.checks?.contradictions ?? []) out.push(`Contradiction: ${c}.`);
  if (sheet.checks?.no_reader) out.push(`No live reader: ${sheet.checks.no_reader}.`);
  const fo = sheet.checks?.family_outlier;
  if (fo) {
    const li = el("li");
    li.append(withTip(el("span", null, "Family outlier"), FAMILY_NOTE),
      `: not written and read the way ${fo.exemplar} is (${fo.family}): ` +
      `${fo.n_missing} of its references missing, ${fo.n_extra} extra.`);
    out.push(li);
  }
  if (inNoProfile(sheet, save)) {
    // A slot keeps the variables of the game version that last wrote it.
    out.push("Not in any profile of this save: they were last saved by a version of the game " +
             "that did not have it yet.");
  }
  return out;
}

// The values come from the save being viewed, not from the data: each value
// with the profiles that hold it, or for a CurrentSave field, the save's one CurrentSave block.
// Backups are left out, as they are everywhere in the viewer.
function slotsFor(sheet, save) {
  if (!save) return [];
  return sheet.container === "profile" ? save.profileNames().map((n) => [n, save.slot(n)])
    : sheet.container === "CurrentSave" && save.slot("CurrentSave") ? [["CurrentSave", save.slot("CurrentSave")]]
    : [];
}

const holds = (sheet, slot) =>
  sheet.type === "FsmArray" ? slot.arrays.has(sheet.name) : slot.objs.has(sheet.name);

function inNoProfile(sheet, save) {
  return sheet.container === "profile" && !!save && !slotsFor(sheet, save).some(([, slot]) => holds(sheet, slot));
}

// A value as the data gives the new-profile one: true/false, whole numbers without ".0",
// strings unquoted, lists and vectors as [a, b, c].
function valueText(sheet, slot) {
  const plain = (s) => {
    s = String(s);
    if (/^".*"$/.test(s)) try { return JSON.parse(s); } catch { /* not a JSON string */ }
    return /^-?\d+\.0+$/.test(s) ? s.replace(/\.0+$/, "") : s;
  };
  if (sheet.type === "FsmArray") {
    const items = slot.arrays.get(sheet.name)?.items;
    return items ? `[${items.map(plain).join(", ")}]` : null;
  }
  const entry = slot.objs.get(sheet.name);
  if (!entry) return null;
  return entry.type === "Vector3" ? `[${entry.value.map(plain).join(", ")}]` : plain(display(entry));
}

function valuesBlock(sheet, save) {
  const dl = el("dl", "fs-values");
  const row = (k, val) => dl.append(el("dt", null, k), el("dd", null, val));
  row("new profile", sheet.values.new_profile ?? "?");
  const byValue = new Map();
  for (const [name, slot] of slotsFor(sheet, save)) {
    const v = valueText(sheet, slot);
    if (v == null) continue;
    if (!byValue.has(v)) byValue.set(v, []);
    byValue.get(v).push(name);
  }
  // A long list is cut short: the rows are for comparing, and the Arrays page has it whole.
  const shown = (v) => (v === "" ? "(empty)" : v.length > 120 ? `${v.slice(0, 120)}…` : v);
  for (const [v, names] of byValue) row(shown(v), names.join(", "));
  return dl;
}

function refsBlock(kind, refs) {
  const det = el("details", "fs-refs");
  det.open = refs.length <= 12;
  const live = refs.filter((r) => !r.dead).length;
  det.append(el("summary", null, noun(kind, refs.length) +
    (live < refs.length ? ` · ${refs.length - live} dead` : "")));
  const ol = el("ol", "fs-list");
  for (const r of refs) ol.append(refItem(r));
  det.append(ol);
  return det;
}

function refItem(r) {
  const li = el("li", r.dead ? "fs-dead" : r.off ? "fs-off" : null);
  const where = el("div", "fs-where");
  const [obj, path] = [r.fsm.split("@")[0], r.fsm.split("@").slice(1).join("@")];
  where.append(el("strong", null, r.component && r.component !== obj ? `${r.component} on ${obj}` : obj),
    el("span", "muted", ` ${path}`), el("span", null, ` · [${r.state}]`),
    r.sequence ? withTip(el("span", "muted", " · sequence"), SEQUENCE_NOTE) : "",
    r.fsm_settings?.length ? el("span", "muted", ` · FSM settings: ${r.fsm_settings.join(", ")}`) : "",
    r.dump === "level2" ? el("span", "muted", " · from the scene file")
      : r.dump === "shipped" ? el("span", "muted", ` · ${SOURCE_NAMES[r.source] ?? r.source ?? "shipped"}`)
      : r.dump === "assets" ? el("span", "muted", ` · only in the shipped assets (${r.source})`) : "");
  li.append(where);

  const what = el("div", "fs-what");
  what.append(el("code", null, `${r.action}(${Object.entries(r.args ?? {})
    .map(([k, v]) => `${k}=${v}`).join(", ")})`));
  if (r.effect) what.append(el("span", "muted", ` → ${effectText(r.effect)}`));
  if (r.via === "loadAll") what.append(el("span", "muted", ` · its own copy, loaded from ${r.key}`));
  if (r.via === "saveAll") what.append(el("span", "muted",
    ` · saves this screen's copy of a whole profile under ${r.key}; the field goes with it, as this screen last set it`));
  if (r.via === "glossary") what.append(el("span", "muted", " · the term is shown in the Glossary once this is set"));
  if (kindOf(r) === "increment") what.append(el("span", "muted",
    " · read only to add to it and write it back, so not a use of the value"));
  if (kindOf(r) === "unused") what.append(el("span", "muted", ` · ${r.copy_unused}, so not a use of the value`));
  li.append(what);
  if (r.copies && copyNodes[r.copies]) li.append(copiesBlock(copyNodes[r.copies]));

  if (r.entry) li.append(el("div", "fs-entry muted", entryText(r.entry)));
  if (r.dead) li.append(el("div", "fs-flag", `dead - ${r.dead}`));
  else if (r.off) li.append(el("div", "fs-flag warn", `off? ${r.off}`));
  if (r.switch) li.append(el("div", "fs-entry muted", r.switch));
  return li;
}

// ---------------------------------------------------------------- copies

/** Where a read's copy goes: what reads the copy afterwards, each test's outcomes and what they
 *  do, and what the copy is handed on to - other FSMs, other variables - opened on request. */
function copiesBlock(node) {
  const det = el("details", "fs-copies");
  const live = (node.uses ?? []).filter((u) => !u.dead).length;
  det.append(el("summary", null, `where the copy goes: $${node.var} · ` +
    (live ? `${live} use${live === 1 ? "" : "s"}` : "no live use") +
    (node.read_by_name?.length ? ` · read by name from ${node.read_by_name.length} other FSM(s)` : "")));
  det.addEventListener("toggle", () => {
    if (det.open && det.children.length === 1) det.append(nodeBody(node, new Set()));
  });
  return det;
}

function nodeBody(node, path) {
  const box = el("div", "fs-copy");
  if (node.csharp_literal) box.append(el("div", "muted",
    "its name is a string in the game's C#, so C# may read it too"));
  const ul = el("ul", "fs-uses");
  for (const u of node.uses ?? []) ul.append(useItem(u, path));
  if (!(node.uses ?? []).length) ul.append(el("li", "muted", "nothing in this FSM reads it"));
  box.append(ul);
  if (node.also_set?.length) box.append(el("div", "muted", `also set by: ${node.also_set.join("; ")}`));
  for (const r of node.read_by_name ?? []) {
    const d = el("div", "fs-handoff");
    d.append(el("span", null, `read by name from ${r.fsm.split("@")[0]} [${r.state}] ${r.action}`));
    d.append(handedOn(r.node, r.stopped, path));
    box.append(d);
  }
  return box;
}

function useItem(u, path) {
  const li = el("li", u.dead ? "fs-dead" : null);
  li.append(el("span", null, `[${u.state}] `), el("code", null, `${u.action}(${u.prop ?? ""})`));
  if (u.sequence) li.append(withTip(el("span", "muted", " · sequence"), SEQUENCE_NOTE));
  if (u.does) li.append(el("span", "muted", ` → ${u.does}`));
  if (u.native) li.append(el("span", "fs-native-use", ` · hands it to ${u.native.game ? "the game's" : u.native.assembly} ${u.native.member}`));
  if (u.from_assets) li.append(el("span", "muted", ` · from the shipped assets: ${u.from_assets}`));
  if (u.before) li.append(el("div", "fs-flag warn", u.before));
  if (u.dead) li.append(el("div", "fs-flag", `dead - ${u.dead}`));
  if (u.outcomes?.length) {
    const ol = el("ul", "fs-outcomes");
    for (const o of u.outcomes) ol.append(outcomeItem(o, path));
    li.append(ol);
  }
  if (u.hand_off) li.append(handOff(u.hand_off, path));
  for (const i of u.into ?? []) {
    const d = el("div", "fs-handoff");
    d.append(el("span", null, `feeds $${i.var}`), handedOn(i.node, i.stopped, path));
    li.append(d);
  }
  return li;
}

function outcomeItem(o, path) {
  const li = el("li");
  if (o.continues) {
    li.append(el("span", null, `${o.on}: carries on in this state`));
    effectsList(li, o.effects, o.hand_offs, path);
    return li;
  }
  li.append(el("span", null, `${o.on}: ${o.event} → ${o.to ?? "nowhere"}`));
  if (o.skips_rest) li.append(el("span", "muted", " (skips the rest of this state)"));
  if (o.note) li.append(el("span", "muted", ` (${o.note})`));
  for (const step of o.chain ?? []) {
    const d = el("div", "fs-step");
    d.append(el("span", null, `[${step.state}]`));
    if (step.sequence) d.append(withTip(el("span", "muted", " · sequence"), SEQUENCE_NOTE));
    effectsList(d, step.effects, step.hand_offs, path);
    li.append(d);
  }
  return li;
}

function effectsList(parent, effects, hands, path) {
  if (effects?.length) parent.append(el("div", "muted", effects.join("; ")));
  for (const h of hands ?? []) parent.append(handOff(h, path));
}

function handOff(h, path) {
  const d = el("div", "fs-handoff");
  d.append(el("span", null, `→ ${h.to}`));
  if (h.field) d.append(el("span", "muted", ` · the saved field ${h.field}, which has a sheet of its own`));
  if (h.note) d.append(el("span", "muted", ` · ${h.note}`));
  if (h.stopped) d.append(el("span", "muted", ` · ${h.stopped}`));
  for (const id of h.nodes ?? []) d.append(handedOn(id, null, path));
  return d;
}

/** A shared node, opened on request; one already open further up this branch is not repeated. */
function handedOn(id, stopped, path) {
  const node = id && copyNodes[id];
  if (!node) return el("span", "muted", ` · ${stopped ?? "not followed"}`);
  if (path.has(id)) return el("span", "muted", " · (already shown above)");
  const det = el("details", "fs-copies");
  det.append(el("summary", null, `${node.fsm.split("@")[0]}.${node.var}`));
  det.addEventListener("toggle", () => {
    if (det.open && det.children.length === 1) det.append(nodeBody(node, new Set([...path, id])));
  });
  return det;
}

function effectText([kind, detail]) {
  return { const: `sets ${detail}`, add: `adds ${detail}`, copy: `copies ${detail}`, toggle: "toggles",
           save: "saves the whole profile", computed: `stores a result (${detail})` }[kind] ?? kind;
}

function entryText(e) {
  const ways = [];
  if (e.start) ways.push("the start state");
  for (const ev of e.global) ways.push(`global event ${ev}`);
  // A global event nothing can send this FSM never fires.
  for (const ev of e.unsent ?? []) ways.push(`global event ${ev}, which nothing sends`);
  const from = e.from.slice(0, 6).map(([s, ev]) => `${s} on ${ev}`);
  if (from.length) ways.push(`from ${from.join("; ")}${e.from.length > 6 ? `; ${e.from.length - 6} more` : ""}`);
  return ways.length ? `entered as ${ways.join(", ")}` : "nothing leads into this state";
}
