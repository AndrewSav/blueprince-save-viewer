// The viewer: drop a save, then move between its pages.
//
// Everything happens in this page; the save is read in the browser and never leaves it. The
// page shown lives in the address after `#` - #/fields, #/arrays, #/parlor, #/rooms, #/history,
// #/stats, #/daily - so back, forward and bookmarks work while the save stays in memory. The save
// itself is never stored: a reload asks for it again, then opens the page the address names.

import { load, display, isDefault, isDefaultArray, readStats } from "./save.js";
import { loadDictionary, groupLabel, groupNote, confidenceNote, hideAsDormant, unexpectedValue, plainExplanation,
         buildMatches } from "./dictionary.js";
import { arrayPage, rawSuffix } from "./arrays.js";
import { historyPage } from "./history.js";
import { statsPage, dailyPage } from "./stats.js";
import { infoBadge, withTip, wireTips, appendExplanation } from "./tip.js";
import { loadFacts, factSheet, factSummary } from "./facts.js";
import { readSaveKey } from "./es3key.js";

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

const state = {
  dict: null,
  save: null,
  profile: null,
  // A fingerprint of the open file's bytes, which the profile picked in it is remembered under.
  fingerprint: null,
  fileName: "",
  // Debug mode: shows the two switches below on the privacy line. Ctrl-click on the title turns
  // it on or off; remembered in this browser, as the two switches are.
  debug: false,
  // Debug only: "hide" dormant values (the default, and the only mode outside debug), "show"
  // them marked among the rest, or show "only" them, to go over the dormant ones on their own.
  dormantMode: "hide",
  // Debug only: a fact sheet under each field (facts.js), loaded the first time it is asked for.
  factSheets: false,
  facts: null,
  factError: null,
  route: { page: "fields", group: null, day: null },
  lastGroup: null,
  filter: "",
  // The save key read from resources.assets, for this visit, where the browser will not keep it.
  sessionKey: null,
  // A save refused for want of a key, opened as soon as one is read.
  waiting: null,
};

const config = () => globalThis.BLUEPRINCE_CONFIG ?? {};

// The save key (the password the game encrypts saves with) never lives in the source. A
// deployment can set it in a small config.js the page reads, which make-config.mjs writes
// locally. Otherwise a player gives the page the game's
// resources.assets, the key is read from it here (es3key.js), and kept in this browser - or for
// this visit only, where the browser keeps nothing.
const configKey = () => config().es3Password || null;
const password = () => configKey() ?? remembered("saveKey", null) ?? state.sessionKey ?? null;

// Dormant fields - nothing writes them, or nothing reads them - are a debugging aid, for
// going over the unused ones to spot anything peculiar, and so are the fact sheets. Debug mode
// shows a switch for each; outside it dormant fields are simply not shown, and neither are the
// sheets, whatever the switches were left at.
const debug = () => state.debug;
const dormantMode = () => (debug() ? state.dormantMode : "hide");

// ---------------------------------------------------------------- remembered in this browser

// Per-browser conveniences kept in localStorage: debug mode and its two switches, and the
// profile last picked in a save. Any access can throw - a private window, storage switched
// off - and then nothing is remembered; the page works the same from its defaults.
const STORE = "blueprince-viewer:";

function remembered(key, fallback) {
  try {
    const v = globalThis.localStorage?.getItem(STORE + key);
    return v == null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

function remember(key, value) {
  try {
    globalThis.localStorage?.setItem(STORE + key, JSON.stringify(value));
  } catch {
    // Not kept; the page carries on.
  }
}

function forget(key) {
  try {
    globalThis.localStorage?.removeItem(STORE + key);
  } catch {
    // Nothing was kept to forget.
  }
}

function loadRemembered() {
  state.debug = remembered("debug", false) === true;
  const mode = remembered("dormantMode", "hide");
  state.dormantMode = DORMANT_MODES.some(([m]) => m === mode) ? mode : "hide";
  state.factSheets = remembered("factSheets", false) === true;
}

/** A fingerprint of a file's bytes: the profile picked in a save is picked again when the same
 *  save is opened, and not once the game has written it since. Null where the browser offers
 *  no WebCrypto (a page not served from localhost or https), which only means it is not kept. */
async function fingerprintOf(bytes) {
  try {
    const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
    return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

/** The profile last picked in this very save, if it still has it. */
function rememberedProfile(save, fingerprint) {
  const r = remembered("profile", null);
  return fingerprint && r?.save === fingerprint && save.profileNames().includes(r.name) ? r.name : null;
}

// The build id is the game's internal PlayerSettings bundleVersion. It deliberately does
// not resemble the published patch number, and nothing in the game displays it, so saying
// it without this qualification only puzzles people.
const BUILD_ID_NOTE =
  "The game build this viewer was made for: every explanation here is for this build. A loaded " +
  "save shows its own build below, on its SaveFileInfo line - the build the save was written " +
  "with - and says whether the two match. Both are the game's internal build id, not the version " +
  "in the patch notes - Blue Prince numbers those differently. Nothing in the game shows it; " +
  "MelonLoader prints it at start-up with its console enabled.";

const CONTAINER_NOTES = {
  SaveFileInfo:
    "Written by the save system for the file as a whole, not for any one profile: which build " +
    "wrote it, the revision of the save format, and when it was created and last written.",
  CurrentSave:
    "Kept by the main menu for the file as a whole, not per profile: which slot is selected, " +
    "whether it is a Dare or Curse run, and which modes the New Game screen offers.",
};

const UNGROUPED = "ungrouped";

// ---------------------------------------------------------------- pages and the address

export const PAGES = [
  { id: "fields", title: "Fields" },
  { id: "arrays", title: "Arrays" },
  { id: "parlor", title: "Parlor" },
  { id: "rooms", title: "Rarity Shifts / Room Records" },
  { id: "history", title: "History" },
  { id: "stats", title: "Stats" },
  { id: "daily", title: "Daily Stats" },
];

// #/fields/<group> names a group; #/history/<n> and #/daily/<n> a day, the latest when absent.
const DAY_PAGES = new Set(["history", "daily"]);

function parseRoute(hash) {
  const [page, ...rest] = String(hash ?? "").replace(/^#\/?/, "").split("/");
  if (!PAGES.some((p) => p.id === page)) return { page: "fields", group: null, day: null };
  const day = DAY_PAGES.has(page) ? Number.parseInt(rest[0], 10) : NaN;
  return {
    page,
    group: page === "fields" && rest.length && rest[0] ? decodeURIComponent(rest.join("/")) : null,
    day: Number.isInteger(day) && day > 0 ? day : null,
  };
}

function hashFor(route) {
  const group = route.page === "fields" && route.group ? `/${encodeURIComponent(route.group)}` : "";
  const day = DAY_PAGES.has(route.page) && route.day ? `/${route.day}` : "";
  return `#/${route.page}${group}${day}`;
}

/** Show a page. In the browser the links and the group dropdown change the address and the
 *  hashchange listener renders; tests call this directly. */
export function navigate(hash) {
  state.route = parseRoute(hash);
  const target = hashFor(state.route);
  if (globalThis.location && location.hash !== target) location.hash = target;
  render();
}

// ---------------------------------------------------------------- loading

// Exported so the render can be driven headlessly in test/render.mjs; the page itself
// reaches it through the drop and file-input listeners.
export async function openFile(file) {
  if (/^resources\.assets$/i.test(file.name)) return readKeyFile(file);
  status(`Reading ${file.name}…`);
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const fingerprint = await fingerprintOf(bytes);
    const save = await load(bytes, password());
    // Each profile's statistics log is unpacked once, here, so pages can draw it at once.
    state.stats = new Map(await Promise.all(save.profileNames().map(async (name) => {
      const items = save.slot(name).arrays.get("DATA")?.items;
      return [name, { items, ...(await readStats(items)) }];
    })));
    state.save = save;
    state.fileName = file.name;
    state.fingerprint = fingerprint;
    state.waiting = null;
    state.profile = rememberedProfile(save, fingerprint) ?? pickInitialProfile(state.save);
    ensureFacts();
    render();
  } catch (e) {
    if (e.code === "no-key") state.waiting = file;
    showError(e);
  }
}

/** Read the save key from the game's resources.assets, keep it, and open the save that was
 *  waiting for it, if any. */
async function readKeyFile(file) {
  status(`Reading the save key from ${file.name}…`);
  let key;
  try {
    key = readSaveKey(new Uint8Array(await file.arrayBuffer()));
  } catch (e) {
    showError(e);
    return;
  }
  state.sessionKey = key;
  remember("saveKey", key);
  clearError();
  renderKeyNote();
  const waiting = state.waiting;
  state.waiting = null;
  if (waiting) return openFile(waiting);
  status("Save key read from resources.assets. Encrypted saves now open here.");
}

function forgetKey() {
  state.sessionKey = null;
  forget("saveKey");
  renderKeyNote();
}

// The note under the drop zone. Nothing when the deployment sets the key; with a key read from
// resources.assets, a line saying so with a way to forget it; with none, the offer to read it.
function renderKeyNote() {
  const note = $("#password-note");
  if (configKey()) {
    note.hidden = true;
    note.replaceChildren();
    return;
  }
  note.hidden = false;
  if (password()) {
    note.className = "muted key-note";
    const drop = el("button", "link-button", "Forget it");
    drop.dataset.action = "forget-key";
    drop.addEventListener("click", forgetKey);
    note.replaceChildren("Encrypted saves open with the save key read from the game's resources.assets, " +
                         "kept in this browser. ", drop);
    return;
  }
  note.className = "warn key-note";
  const choose = el("button", "action", "Choose resources.assets");
  choose.dataset.action = "choose-key";
  choose.addEventListener("click", () => $("#file").click());
  note.replaceChildren(
    el("strong", null, "Encrypted saves need the game's save key. "),
    "It is in the game's own files: resources.assets, about 8 MB, in the BLUE PRINCE_Data folder of the " +
    "install (in Steam, right-click Blue Prince, then Manage, then Browse local files). ",
    choose,
    " or drop it on the box above. It is read here in your browser and never uploaded, and the key is " +
    "kept in this browser, so this is needed once. A save you have already decrypted opens without it.");
}

function pickInitialProfile(save) {
  const names = save.profileNames();
  if (!names.length) return null;
  // CurrentSave says which slot the menu had selected; slot 1 is `BluePrint` with no digit.
  const idx = save.currentProfileIndex();
  const wanted = idx === 1 ? "BluePrint" : `BluePrint${idx}`;
  return names.includes(wanted) ? wanted : names[0];
}

function status(text) {
  $("#status").textContent = text ?? "";
  $("#status").hidden = !text;
}

function showError(e) {
  console.error(e);
  const box = $("#error");
  box.textContent = e.message ?? String(e);
  box.hidden = false;
  status(null);
}

function clearError() {
  $("#error").hidden = true;
}

// ---------------------------------------------------------------- rendering

function render() {
  // A render replaces the page's controls, so the one in use loses focus - and with it the
  // arrow keys that walk a dropdown. Controls that re-render the page carry a focus key, and
  // focus goes back to whichever control carries the same key afterwards.
  const focusKey = globalThis.document?.activeElement?.dataset?.focusKey;
  renderContent();
  if (focusKey) {
    const key = focusKey.replace(/["\\]/g, "\\$&");
    globalThis.document.querySelector(`[data-focus-key="${key}"]`)?.focus();
  }
}

function renderContent() {
  clearError();
  status(null);
  renderKeyNote();
  // How many dormant values the toggle hides - or, when they are shown, marks - on screen.
  state.dormant = 0;
  // Any page opened without a save asks for one; it opens once a save is loaded.
  if (!state.save) {
    $("#intro").hidden = false;
    $("#viewer").hidden = true;
    $("#file-name").textContent = "";
    renderDebugTools();
    return;
  }
  $("#intro").hidden = true;
  $("#viewer").hidden = false;
  renderCommon(state.save);
  state.dormantCommon = state.dormant;
  renderProfiles(state.save);
  renderNav();
  renderPage(state.save);
  renderDebugTools();
}

/** Is this value dormant by the dictionary's rule? Counts it, and says whether to leave it
 *  out ("hide"), show it marked ("show"), show it marked as one the save and the viewer's model
 *  disagree on ("unexpected", whatever the toggle says), or show it as normal (null). With only
 *  dormant values asked for, every other value is left out. */
function dormantState(field, atDefault) {
  if (unexpectedValue(field, atDefault)) return "unexpected";
  const dormant = hideAsDormant(field, atDefault);
  if (dormant) state.dormant++;
  if (dormantMode() === "only") return dormant ? "show" : "hide";
  if (!dormant) return null;
  return dormantMode() === "hide" ? "hide" : "show";
}

/** The mark on a dormant value that is shown, saying why it is dormant. */
function dormantTag(field, unexpected = false) {
  const why = (field?.dormant_basis ?? []).join("; ") || "dormant";
  const detail = [field?.no_live_writer, field?.no_reader].filter(Boolean).map((d) => ` ${d}`).join("");
  return withTip(el("span", "tag dormant", "dormant"),
    `${unexpected ? "Dormant" : "Hidden unless dormant fields are shown"}: ${why}.${detail}`);
}

/** Beside the dormant tag on a value the field should never hold. */
function unexpectedMark(field) {
  return withTip(el("span", "tag unexpected", "!"),
    "Unexpected: the value in this save does not match the viewer's model of the game, which has " +
    `this field as dormant (${(field?.dormant_basis ?? []).join("; ") || "dormant"}) and so only ever ` +
    "at its starting value. The save and the model disagree, so the model has missed a way this " +
    "field gets set.");
}

function fact(key, value, tip = null, fieldName = null) {
  const f = el("span", "fact");
  f.append(el("span", "fact-key", key), el("span", "fact-value", value));
  // Where the page labels a field as something friendlier, the popup names it as the save
  // does - that is the name to search the file, or these explanations, for.
  if (tip) f.append(infoBadge(tip, fieldName !== key ? fieldName : null));
  return f;
}

function containerLabel(name) {
  const l = el("span", "container");
  l.append(el("span", "container-name", name), infoBadge(CONTAINER_NOTES[name]));
  return l;
}

// SaveFileInfo and CurrentSave belong to the file, not to a profile, so they come first and
// stay put while profiles and pages change. One compact line each.
function renderCommon(save) {
  const box = $("#common");
  box.replaceChildren();
  // These sit in popups already, and a popup cannot open another, so any notes are dropped.
  const explain = (name) => plainExplanation(state.dict.field("SaveFileInfo", name)?.explanation) || null;
  const fileFact = (label, name, value) => fact(label, value ?? "not recorded", explain(name), name);

  // The file's name rides on the privacy line, under the build id, where it costs no room.
  $("#file-name").textContent = state.fileName;
  const info = el("div", "fact-line");
  info.append(containerLabel("SaveFileInfo"));
  if (save.hasFileInfo) {
    const fi = save.fileInfo;
    const build = el("span", "fact");
    build.append(el("span", "fact-key", "Game build"),
                 el("span", "fact-value", fi.game_version ?? "not recorded"));
    // A build id missing on either side does not match: nothing then vouches for the data.
    const ok = buildMatches(state.dict, save.gameVersion);
    const match = el("span", "match " + (ok ? "yes" : "no"), ok ? "matches" : "does not match");
    match.id = "build-match";
    build.append(match, infoBadge(explain("game_version"), "game_version"));
    info.append(build,
      fileFact("Save system", "save_system_version", fi.save_system_version),
      fileFact("Created", "save_created", fi.save_created),
      fileFact("Last written", "data_last_modified", fi.data_last_modified));
  }
  box.append(info);

  // The one build warning, for every page: the viewer's data is for one build, and
  // against any other the labels and the map may be wrong in ways that look perfectly plausible.
  // Nothing is withheld, as nothing says what moved between the two.
  if (!buildMatches(state.dict, save.gameVersion)) {
    const viewer = state.dict.gameVersion;
    const warn = el("p", "warn compact");
    warn.id = "build-warning";
    warn.append(el("strong", null, "This save does not match the viewer's build. "),
      (viewer ? `The viewer is made for build ${viewer}` : "The viewer's data records no single build") +
      (save.gameVersion ? `; this save was written by build ${save.gameVersion}. `
                        : "; this save does not record which build wrote it. ") +
      "Field meanings and room numbers move between builds, so the explanations and the map may " +
      "be wrong in ways that look plausible." +
      (save.gameVersion ? ` The viewer needs updating to build ${save.gameVersion}.` : ""));
    box.append(warn);
  }

  const cur = save.slot("CurrentSave");
  if (cur) {
    const line = el("div", "fact-line");
    line.append(containerLabel("CurrentSave"));
    for (const [name, entry] of cur.objs) {
      const field = state.dict.field("CurrentSave", name);
      const dormant = dormantState(field, isDefault(entry, field?.start));
      if (dormant === "hide") continue;
      const f = fact(field?.label ?? name, display(entry), plainExplanation(field?.explanation) || null, name);
      // Muted but not tagged: the line is short, a tag per fact would crowd it, and flipping
      // the toggle shows at a glance which facts come and go. A value the model says this field
      // cannot have is the exception: it is not muted, and carries the "!" mark.
      if (dormant === "unexpected") f.append(unexpectedMark(field));
      else if (dormant) f.classList.add("dormant");
      line.append(f);
    }
    box.append(line);
  }
}

function renderProfiles(save) {
  const box = $("#profiles");
  box.replaceChildren();
  box.append(el("span", "container-name", "Profile"));
  for (const name of save.profileNames()) {
    const day = save.slot(name).objs.get("DAY")?.value ?? "?";
    const b = el("button", "profile" + (name === state.profile ? " selected" : ""));
    b.type = "button";
    b.dataset.focusKey = `profile:${name}`;
    b.append(el("span", "profile-name", name), el("span", "profile-day", `day ${day}`));
    b.addEventListener("click", () => {
      state.profile = name;
      if (state.fingerprint) remember("profile", { save: state.fingerprint, name });
      render();
    });
    box.append(b);
  }
  // The …Backup slots are deliberately not mentioned: every writer of one sits behind a
  // disconnected Blackbridge menu state, so they are frozen copies with nothing to say, and
  // saying "not shown" only suggests something is being withheld.
}

function renderNav() {
  const nav = $("#nav");
  nav.replaceChildren();
  for (const p of PAGES) {
    const a = el("a", p.id === state.route.page ? "current" : null, p.title);
    a.href = hashFor({ page: p.id, group: p.id === "fields" ? state.lastGroup : null });
    if (p.id === state.route.page) a.setAttribute("aria-current", "page");
    nav.append(a);
  }
}

const DORMANT_MODES = [["hide", "hidden"], ["show", "shown among the rest"], ["only", "shown on their own"]];

// The dormant toggle changes the common block above the pages as well as the page itself, so
// it sits on the privacy line at the top rather than in the navigation.
function renderDebugTools() {
  const slot = $("#debug-tools");
  slot.replaceChildren();
  if (!debug() || !state.save) return;
  const label = el("label", "dormant-toggle");
  const select = el("select", "dormant-mode");
  select.dataset.focusKey = "dormant-mode";
  for (const [mode, text] of DORMANT_MODES) {
    const o = el("option", null, text);
    o.value = mode;
    o.selected = mode === state.dormantMode;
    select.append(o);
  }
  select.addEventListener("change", () => setDormantMode(select.value));
  const common = state.dormantCommon ?? 0, onPage = state.dormant - common;
  const where = [common && `${common} in the file block`, onPage && `${onPage} on this page`]
    .filter(Boolean).join(", ");
  const said = { hide: "hidden", show: "shown, marked", only: "shown, nothing else" }[state.dormantMode];
  label.append("dormant fields ", select,
    el("span", "dormant-count", state.dormant ? ` · ${state.dormant} ${said}: ${where}` : " · none here"));
  slot.append(label, factsToggle());
}

/** The debug switch for fact sheets on the Fields page. The first time it goes on, the sheets
 *  are fetched, and the page is drawn again once they are in. */
function factsToggle() {
  const label = el("label", "dormant-toggle facts-toggle");
  const box = el("input");
  box.type = "checkbox";
  box.checked = state.factSheets;
  box.addEventListener("change", () => {
    state.factSheets = box.checked;
    remember("factSheets", state.factSheets);
    ensureFacts();
    render();
  });
  label.append(box, " fact sheets");
  if (state.factError) label.append(el("span", "dormant-count", ` · ${state.factError}`));
  else if (state.factSheets && !state.facts) label.append(el("span", "dormant-count", " · loading"));
  return label;
}

function renderPage(save) {
  const page = $("#page");
  page.replaceChildren();
  const slot = state.profile ? save.slot(state.profile) : null;
  if (!slot) {
    page.append(el("p", "muted", "This file has no profile to show."));
    return;
  }
  if (state.route.page === "fields") {
    fieldsPage(slot, page);
    return;
  }
  if (state.route.page === "stats") {
    page.append(...statsPage(statsFor(slot), state.dict.runstats));
    return;
  }
  if (state.route.page === "daily") {
    page.append(...dailyPage(statsFor(slot), state.dict.runstats, state.route.day,
                             (n) => navigate(hashFor({ page: "daily", day: n }))));
    return;
  }
  if (state.route.page === "history") {
    page.append(...historyPage(slot, state.dict, state.route.day,
                               (n) => navigate(hashFor({ page: "history", day: n }))));
    return;
  }
  // A field the dictionary homes on this page is shown here instead of in the field list.
  const homed = [...slot.objs]
    .map(([name, entry]) => ({ name, entry, field: state.dict.field("profile", name) }))
    .filter(({ field }) => field?.page === state.route.page)
    // Going over the dormant values on their own leaves out whatever is not one.
    .filter(({ field, entry }) => dormantMode() !== "only" || hideAsDormant(field, isDefault(entry, field?.start)));
  const blocks = arrayPage(state.route.page, slot, (name) => state.dict.field("profile", name),
    (field, arr) => dormantState(field, isDefaultArray(arr)),
    (heading, field, block, how) => {
      if (how === "unexpected") heading.append(dormantTag(field, true), unexpectedMark(field));
      else { block.classList.add("dormant"); heading.append(dormantTag(field)); }
    });
  if (!homed.length && !blocks.length) page.append(el("p", "muted", "Nothing to show for this profile."));
  page.append(...homed.map(homedField), ...blocks);
}

// A field that lives on a page rather than in the list: its value large, its explanation
// under it, and - where the dictionary carries one - the table of what moves it.
function homedField({ name, entry, field }) {
  const sec = el("section", "homed");
  sec.dataset.field = name;
  const head = el("div", "homed-head");
  head.append(el("span", "homed-name", field?.label ?? name),
              el("span", "homed-value", display(entry)));
  if (unexpectedValue(field, isDefault(entry, field?.start))) head.append(dormantTag(field, true), unexpectedMark(field));
  sec.append(head);
  if (field?.explanation) sec.append(appendExplanation(el("p", "muted explain"), field.explanation));
  if (field?.scoring) sec.append(scoringTable(field.scoring));
  return sec;
}

/** How a Parlor answer moves the score: one row per band of time taken, both outcomes side
 *  by side. The numbers in the data are read off the comparisons the
 *  game makes; the two outcomes split time differently, so the rows are the intervals of
 *  their combined boundaries and each is labelled from the interval it really covers. */
function scoringTable(scoring) {
  const outcomes = Object.keys(scoring);
  const edges = [...new Set(outcomes.flatMap((o) => scoring[o].map((r) => r.from)))]
    .sort((a, b) => a - b);
  const body = el("tbody");
  edges.forEach((from, i) => {
    const to = i + 1 < edges.length ? edges[i + 1] - 1 : null;
    const tr = el("tr");
    tr.append(el("td", null, secondsPhrase(from, to)));
    for (const o of outcomes) tr.append(el("td", null, changeText(scoring[o], from)));
    body.append(tr);
  });
  const head = el("tr");
  head.append(el("th", null, "Time taken"),
              ...outcomes.map((o) => el("th", null, o[0].toUpperCase() + o.slice(1))));
  const thead = el("thead");
  thead.append(head);
  const t = el("table", "array-table scoring");
  t.append(thead, body);
  return t;
}

function secondsPhrase(lo, hi) {
  if (lo === 0 && hi !== null) return `under ${hi + 1} seconds`;
  if (hi === null) return `over ${lo - 1} seconds`;
  if (lo === hi) return `exactly ${lo} seconds`;
  return `${lo} to ${hi} seconds`;
}

const signed = (n) => (n > 0 ? `+${n}` : n === 0 ? "no change" : String(n));

function changeText(rows, from) {
  const row = rows.find((r) => r.from <= from && (r.to === null || from <= r.to));
  if (!row) return "";
  if (row.random) return `${signed(row.random[0])} or ${signed(row.random[1])}, at random`;
  return signed(row.change);
}

// ---------------------------------------------------------------- the field list

const groupTitle = (g) => groupLabel(g === UNGROUPED ? null : g);
// Every group a field sits in: most are in one, a few in several (`groups`, its own group first).
const groupsOf = (field) => field?.groups ?? [field?.group ?? UNGROUPED];

// Every field at once, and the default; not a dictionary group, so it never reaches the address.
const ALL = "all";

// All the fields, or one group of them; the filter narrows whichever is shown.
function fieldsPage(slot, page) {
  const rows = [];
  for (const [name, entry] of slot.objs) {
    const field = state.dict.field("profile", name);
    // Shown on a page of its own, where what it means is next to it.
    if (field?.page) continue;
    const dormant = dormantState(field, isDefault(entry, field?.start));
    if (dormant === "hide") continue;
    rows.push({ name, entry, field, groups: groupsOf(field), dormant: dormant === "show", unexpected: dormant === "unexpected" });
  }
  // A field in several groups counts, and is listed, in each of them.
  const counts = new Map();
  for (const r of rows) for (const g of r.groups) counts.set(g, (counts.get(g) ?? 0) + 1);
  // Alphabetical by the name shown, with the fields in no group last.
  const groups = [...counts.keys()].sort((a, b) =>
    (a === UNGROUPED) - (b === UNGROUPED) || groupTitle(a).localeCompare(groupTitle(b)));
  const group = groups.includes(state.route.group) ? state.route.group : ALL;
  state.lastGroup = group === ALL ? null : group;
  const inGroup = group === ALL ? rows : rows.filter((r) => r.groups.includes(group));

  const bar = el("div", "toolbar");
  const search = el("input", "filter");
  search.type = "search";
  search.placeholder = group === ALL ? "Filter all fields" : "Filter this group";
  search.value = state.filter;
  const select = el("select", "group-select");
  select.dataset.focusKey = "group-select";
  for (const [g, n] of [[ALL, rows.length], ...groups.map((g) => [g, counts.get(g)])]) {
    const o = el("option", null, `${g === ALL ? "All" : groupTitle(g)} (${n})`);
    o.value = g;
    o.selected = g === group;
    select.append(o);
  }
  const note = el("span", "muted list-note");
  bar.append(search, select);
  if (groupNote(group)) bar.append(infoBadge(groupNote(group)));
  bar.append(note);
  const list = el("div", "field-list");
  page.append(bar, list);

  select.addEventListener("change", () =>
    navigate(hashFor({ page: "fields", group: select.value === ALL ? null : select.value })));
  search.addEventListener("input", () => { state.filter = search.value; showList(); });

  function showList() {
    const q = state.filter.trim().toLowerCase();
    const matches = (r) => (r.field?.label ?? r.name).toLowerCase().includes(q) ||
                           plainExplanation(r.field?.explanation, true).toLowerCase().includes(q);
    const shown = (q ? inGroup.filter(matches) : inGroup).sort((a, b) => a.name.localeCompare(b.name));
    note.textContent = q ? `${shown.length} of ${inGroup.length} matching` : "";
    list.replaceChildren(fieldTable(shown, group));
  }
  showList();
}

/** The field rows, for the group shown (or ALL). */
function fieldTable(rows, group) {
  const table = el("table", "fields");
  const tbody = el("tbody");
  const sheets = debug() && state.factSheets && state.facts;
  for (const r of rows) {
    tbody.append(valueRow(r, group));
    const sheet = sheets ? state.facts.sheet("profile", r.name) : null;
    if (sheet) tbody.append(factRow(sheet));
  }
  table.append(tbody);
  return table;
}

/** A field's fact sheet, folded under its row; the sheet itself is built when first opened. */
function factRow(sheet) {
  const tr = el("tr", "facts-row");
  const td = el("td");
  td.colSpan = 3;
  const det = el("details", "facts");
  const summary = el("summary");
  summary.append(...factSummary(sheet, state.save));
  det.append(summary);
  det.addEventListener("toggle", () => {
    if (det.open && !det.dataset.built) {
      det.dataset.built = "1";
      det.append(factSheet(sheet, state.save));
    }
  });
  td.append(det);
  tr.append(td);
  return tr;
}

function valueRow({ name, entry, field, groups, dormant, unexpected }, shownGroup) {
  const tr = el("tr", dormant ? "dormant" : null);
  const th = el("th");
  th.append(el("span", "field-name", field?.label ?? name));
  if (dormant) th.append(dormantTag(field));
  if (unexpected) th.append(dormantTag(field, true), unexpectedMark(field));
  const note = confidenceNote(field);
  if (note) th.append(withTip(el("span", "tag " + note.tag.replace(/\s+/g, "-"), note.tag), note.title));
  if (field?.possible_refs) {
    th.append(withTip(el("span", "tag possible", `${field.possible_refs} possible`),
      `${field.possible_refs} reference(s) name this variable but could not be pinned to one ` +
      `instance, so they are recorded without being counted as confirmed.`));
  }
  // With every group in one list, each row says which groups it belongs to; in one group, only
  // the other groups a field is also in.
  for (const g of shownGroup === ALL ? groups : groups.filter((x) => x !== shownGroup)) {
    const label = el("span", "group-label", groupTitle(g));
    th.append(groupNote(g) ? withTip(label, groupNote(g)) : label);
  }
  tr.append(th);

  // A code the game names - which treasure map - shows the name, and the number after it. An
  // empty string shows as a dash, and one of only spaces as a dash with the count after it: the
  // game clears `Blessing` with a space, and a custom network password could be all spaces.
  const value = display(entry);
  const decoded = field?.value_labels?.[String(value)];
  const spaces = typeof value === "string" && /^ +$/.test(value);
  const td = el("td", "value", decoded ?? (value === "" || spaces ? "—" : value));
  if (decoded !== undefined) td.append(rawSuffix(value));
  else if (spaces) td.append(rawSuffix(value.length === 1 ? "1 space" : `${value.length} spaces`));
  tr.append(td);

  tr.append(appendExplanation(el("td", "desc"), field?.explanation ?? ""));
  return tr;
}

// ---------------------------------------------------------------- wiring

function wire() {
  const drop = $("#drop");
  const input = $("#file");

  drop.addEventListener("click", () => input.click());
  input.addEventListener("change", () => input.files[0] && openFile(input.files[0]));

  for (const ev of ["dragenter", "dragover"]) {
    document.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); });
  }
  for (const ev of ["dragleave", "drop"]) {
    document.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); });
  }
  document.addEventListener("drop", (e) => {
    const f = e.dataTransfer?.files?.[0];
    if (f) openFile(f);
  });

  // Ctrl-click (Cmd-click on a Mac) on the title turns debug mode on or off.
  $("#title").addEventListener("click", (e) => { if (e.ctrlKey || e.metaKey) setDebug(!state.debug); });

  wireTips();
  globalThis.addEventListener?.("hashchange", () => {
    const r = parseRoute(location.hash);
    if (r.page === state.route.page && r.group === state.route.group && r.day === state.route.day) return;
    state.route = r;
    render();
  });
}

/** Used by the headless render test; in the page this is the debug toggle. */
export function setHideDormant(on) {
  setDormantMode(on ? "hide" : "show");
}

/** The debug toggle's three settings: "hide", "show" (marked, among the rest) or "only".
 *  Remembered in this browser; in force only in debug mode. */
export function setDormantMode(mode) {
  state.dormantMode = mode;
  remember("dormantMode", mode);
  if (state.save) render();
}

/** Debug mode on or off: the Ctrl-click on the title, and the render test. Remembered in this
 *  browser. The "debug" mark by the title says it is on, even before a save is open. */
export function setDebug(on) {
  state.debug = !!on;
  remember("debug", state.debug);
  $("#debug-mark").hidden = !state.debug;
  ensureFacts();
  render();
}

/** Fetch the fact sheets if debug mode and their switch are both on and they are not in yet,
 *  and draw the page again once they are - also when the switch was left on last time. */
function ensureFacts() {
  if (!debug() || !state.factSheets || state.facts || state.factError) return;
  loadFacts().then((f) => { state.facts = f; render(); })
    .catch((e) => { state.factError = e.message; render(); });
}

/** The profile's unpacked DATA, if it is still the one read when the save was opened. */
function statsFor(slot) {
  const items = slot.arrays.get("DATA")?.items;
  const read = state.stats?.get(state.profile);
  if (!items?.length) return { error: "This profile has no DATA, so there are no statistics to show." };
  if (!read || read.items !== items) return { error: "This profile's DATA has not been read." };
  return read;
}

/** The profile being shown, the save it came from, its statistics and the page - for tests. */
export function current() {
  return { save: state.save, profile: state.profile, route: { ...state.route },
           stats: state.stats?.get(state.profile)?.doc ?? null };
}

export async function start() {
  loadRemembered();
  $("#debug-mark").hidden = !state.debug;
  wire();
  try {
    state.dict = await loadDictionary();
  } catch (e) {
    showError(e);
    return;
  }
  renderKeyNote();
  $("#dict-version").textContent = state.dict.gameVersion ?? "unknown";
  $("#build-info").replaceChildren(infoBadge(BUILD_ID_NOTE));
  state.route = parseRoute(globalThis.location?.hash);
  render();
}
