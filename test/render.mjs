// Run the real ui.js against a real save, with a DOM small enough to keep in one file.
//
//   node test/render.mjs <save.es3 or save.es3.json> [password]
//
// This is not a substitute for opening the page, but it catches the things that are
// tedious to find by eye: a selector that does not exist in index.html, a crash part way
// through rendering, a page that loses data, a control that does nothing.

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { decrypt, looksDecrypted } from "../app/es3.js";
import { gameKey } from "./gamekey.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const [file, password] = process.argv.slice(2);
if (!file) {
  console.error("usage: node test/render.mjs <save> [password]");
  process.exit(2);
}

let failures = 0;
const check = (ok, what, detail = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}${detail ? "   " + detail : ""}`);
  if (!ok) failures++;
};
// For a check the profile has nothing to test with - a new profile has no rankings, say.
const skip = (what, why) => console.log(`  skip  ${what}   ${why}`);

// ---------------------------------------------------------------- static checks

const html = await readFile(join(root, "index.html"), "utf8");
const sources = Object.fromEntries(await Promise.all(["ui.js", "arrays.js", "history.js", "stats.js", "tip.js", "style.css"]
  .map(async (f) => [f, await readFile(join(root, "app", f), "utf8")])));
const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
const usedIds = [...(sources["ui.js"] + sources["tip.js"]).matchAll(/querySelector\("#([a-zA-Z0-9_-]+)"\)|\$\("#([a-zA-Z0-9_-]+)"\)/g)]
  .map((m) => m[1] ?? m[2]);
const missingIds = [...new Set(usedIds)].filter((id) => !htmlIds.has(id));
check(missingIds.length === 0, "every element the page code looks up exists in index.html",
      missingIds.length ? `missing: ${missingIds.join(", ")}` : `${new Set(usedIds).size} ids`);
// Tooltips are (i) badges with a styled popup: the page has no native title tooltips and no
// help cursor.
const titleUses = ["ui.js", "arrays.js", "history.js", "stats.js", "tip.js"].filter((f) => /\.title\s*=|setAttribute\("title"/.test(sources[f]));
check(titleUses.length === 0 && !/\stitle="/.test(html), "no native title tooltips in the page or its code",
      titleUses.join(", "));
check(!/cursor:\s*help/.test(sources["style.css"]), "no help cursor in the stylesheet");

// ---------------------------------------------------------------- a small DOM

class El {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.className = "";
    this.hidden = false;
    this._titleSet = false;
    this.files = [];
    this.checked = false;
    this.value = "";
    this.dataset = {};
    this.style = {};
    this.classList = {
      add: (c) => { this.className = [...new Set([...this.className.split(" ").filter(Boolean), c])].join(" "); },
      remove: (c) => { this.className = this.className.split(" ").filter((x) => x && x !== c).join(" "); },
    };
  }
  set title(v) { this._titleSet = true; }
  get title() { return ""; }
  // As in a real DOM, setting text replaces the children with one text node, so text set
  // first and an element appended after it are both kept.
  set textContent(v) { this.children = String(v ?? "") === "" ? [] : [text(String(v))]; }
  get textContent() { return this.children.map((c) => c.textContent).join(""); }
  append(...nodes) { for (const n of nodes) this.children.push(typeof n === "string" ? text(n) : n); }
  appendChild(n) { this.append(n); }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  // Handlers are kept so a test can click, change and type for real.
  addEventListener(type, fn) { ((this._on ??= {})[type] ??= []).push(fn); }
  fire(type, extra = {}) { for (const fn of this._on?.[type] ?? []) fn({ target: this, preventDefault() {}, ...extra }); }
  click() { this.fire("click"); }
  focus() { globalThis.document.activeElement = this; }
  setAttribute(k, v) { (this._attrs ??= {})[k] = String(v); }
  getAttribute(k) { return this._attrs?.[k] ?? null; }
  querySelectorAll() { return []; }
  /** Every element in this subtree, for assertions. */
  *walk() { yield this; for (const c of this.children) if (c.walk) yield* c.walk(); }
}
const text = (s) => ({ textContent: s, walk: function* () {} });

// Start each stub element in the state index.html gives it, so `hidden` really is the
// page's initial state rather than this file's default.
const hiddenInHtml = new Set(
  [...html.matchAll(/<[a-zA-Z]+\b([^>]*)>/g)]
    .map((m) => m[1])
    .filter((attrs) => /\bhidden\b/.test(attrs))
    .map((attrs) => attrs.match(/\bid="([^"]+)"/)?.[1])
    .filter(Boolean));
const byId = new Map([...htmlIds].map((id) => {
  const e = new El("div");
  e.hidden = hiddenInHtml.has(id);
  return [id, e];
}));
globalThis.document = {
  createElement: (t) => new El(t),
  createTextNode: text,
  // `#id`, and the one attribute lookup the page makes: `[data-focus-key="..."]`.
  querySelector: (sel) => {
    if (sel.startsWith("#")) return byId.get(sel.slice(1)) ?? null;
    const key = sel.match(/^\[data-focus-key="(.*)"\]$/)?.[1]?.replace(/\\(.)/g, "$1");
    if (key === undefined) return null;
    for (const rootEl of byId.values()) {
      for (const n of rootEl.walk()) if (n.dataset?.focusKey === key) return n;
    }
    return null;
  },
  activeElement: null,
  addEventListener() {},
};
// config.example.js, committed, shows the config's shape: it must load and carry no key, so that
// copied as it is it behaves as no config at all.
await import(pathToFileURL(join(root, "config.example.js")).href);
check(globalThis.BLUEPRINCE_CONFIG?.es3Password === "" && Object.keys(globalThis.BLUEPRINCE_CONFIG).join() === "es3Password",
      "config.example.js loads, with the key left empty", JSON.stringify(Object.keys(globalThis.BLUEPRINCE_CONFIG ?? {})));
delete globalThis.BLUEPRINCE_CONFIG;
// The real save key: an explicit argument, else config.js (what make-config.mjs writes), else
// the game's own resources.assets. The page starts
// without it, so the test can go through reading a key first; it is handed over as config.js
// would before the real save is opened.
let realKey = password ?? null;
if (!realKey) {
  try {
    // A bare Windows path is not a valid ESM specifier; it must be a file:// URL.
    await import(pathToFileURL(join(root, "config.js")).href);
    realKey = globalThis.BLUEPRINCE_CONFIG?.es3Password ?? null;
    if (realKey) console.log("  (using the save key from config.js, as the page does)");
  } catch { /* no config.js */ }
}
if (!realKey) {
  realKey = await gameKey();
  if (realKey) console.log("  (using the save key read from the game's resources.assets)");
}
if (!realKey && !looksDecrypted(new Uint8Array(await readFile(file)))) {
  console.error("This save is encrypted and there is no key for it: pass it after the file, run make-config.mjs, " +
                "or set BLUEPRINCE_GAME to the Blue Prince install folder.");
  process.exit(2);
}
// Debug mode comes only from a Ctrl-click on the title, which the test does itself; a
// `debug: true` in the config must do nothing.
globalThis.BLUEPRINCE_CONFIG = { debug: true };
// localStorage, as a Map: the page remembers debug mode, its two switches and the profile
// picked in a save.
const stored = new Map();
globalThis.localStorage = {
  getItem: (k) => (stored.has(k) ? stored.get(k) : null),
  setItem: (k, v) => stored.set(k, String(v)),
  removeItem: (k) => stored.delete(k),
};

// A save encrypted the way the game does it (app/es3.js decrypts): a 16-byte IV, then AES-128-CBC
// with the key PBKDF2-HMAC-SHA1(password, IV, 100).
async function encryptSave(plain, key) {
  const iv = crypto.getRandomValues(new Uint8Array(16));
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: iv, iterations: 100, hash: "SHA-1" }, material, 128);
  const aes = await crypto.subtle.importKey("raw", bits, "AES-CBC", false, ["encrypt"]);
  const body = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-CBC", iv }, aes, plain));
  const out = new Uint8Array(iv.length + body.length);
  out.set(iv);
  out.set(body, iv.length);
  return out;
}

// A stand-in resources.assets: filler, a stray "ES3Defaults" that is not a serialized name (no
// length before it), then the ES3Defaults settings as the game stores them (app/es3key.js).
function fakeAssets(key, encryption = 1) {
  const enc = new TextEncoder();
  const parts = [new Uint8Array(64), enc.encode("ES3Defaults"), new Uint8Array(1)];
  const int = (v) => { const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, v, true); parts.push(b); };
  const str = (s) => { const b = enc.encode(s); int(b.length); parts.push(b, new Uint8Array((4 - b.length % 4) % 4)); };
  str("ES3Defaults");
  int(0);                          // location
  str("SaveFile.es3");             // path
  int(encryption);                 // encryptionType: 1 is AES
  int(0);                          // compressionType: none
  str(key);                        // encryptionPassword
  parts.push(new Uint8Array(32));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  parts.reduce((at, p) => (out.set(p, at), at + p.length), 0);
  return out;
}

// fetch, serving the data directory off disk
globalThis.fetch = async (path) => {
  try {
    const body = await readFile(join(root, path), "utf8");
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  } catch {
    return { ok: false, status: 404, json: async () => ({}) };
  }
};

const dict = JSON.parse(await readFile(join(root, "data", "fields-schema.json"), "utf8"));
const fieldOf = (container, name) => dict.fields.find((f) => f.container === container && f.name === name);
const hasClass = (n, c) => (n.className ?? "").split(" ").includes(c);
const all = (id) => [...byId.get(id).walk()];
const page = () => all("page");

// ---------------------------------------------------------------- start, with no save

const ui = await import("../app/ui.js");
await ui.start();
check(byId.get("dict-version").textContent !== "…", "dictionary loaded into the page",
      byId.get("dict-version").textContent);
check(all("build-info").some((n) => hasClass(n, "info") && n.dataset.tip),
      "the build id in the header carries an (i) badge with its explanation");
check(byId.get("error").hidden, "no error after start");

// A page opened with no save asks for one, and opens once a save is loaded.
ui.navigate("#/arrays");
check(!byId.get("intro").hidden && byId.get("viewer").hidden, "a page opened with no save shows the drop zone");

// ---------------------------------------------------------------- the save key

// With no key, the note under the drop zone offers to read it from the game's resources.assets.
const bytes = new Uint8Array(await readFile(file));
const fileName = file.split(/[\\/]/).pop();
const KEY = "blueprince-viewer:saveKey";
const keyNote = () => byId.get("password-note");
const noteAction = (a) => [...keyNote().walk()].find((n) => n.dataset?.action === a);
check(!keyNote().hidden && hasClass(keyNote(), "warn") && /resources\.assets/.test(keyNote().textContent) &&
      !!noteAction("choose-key"), "with no key, the note under the drop zone offers to read resources.assets");
let picked = false;
byId.get("file").addEventListener("click", () => { picked = true; });
noteAction("choose-key").click();
check(picked, "its button opens the file picker");

// The test's save encrypted with a made-up key, and a resources.assets carrying that key.
const plain = looksDecrypted(bytes) ? bytes : await decrypt(bytes, realKey);
const madeUp = "a key made up for this test";
const encrypted = await encryptSave(plain, madeUp);
await ui.openFile({ name: "MtHollyBlueprint.es3", arrayBuffer: async () => encrypted.buffer });
check(!byId.get("error").hidden && /resources\.assets/.test(byId.get("error").textContent) && byId.get("viewer").hidden,
      "an encrypted save with no key is refused, pointing at resources.assets");
const assetsFile = (b) => ({ name: "resources.assets", arrayBuffer: async () => b.buffer });
await ui.openFile(assetsFile(new Uint8Array(4096)));
check(!byId.get("error").hidden && /ES3Defaults/.test(byId.get("error").textContent) && !stored.has(KEY),
      "a file without the key settings in it is refused, and nothing is kept", byId.get("error").textContent);
await ui.openFile(assetsFile(fakeAssets(madeUp, 2)));
check(!byId.get("error").hidden && /not laid out as expected/.test(byId.get("error").textContent) && !stored.has(KEY),
      "so are key settings laid out other than expected", byId.get("error").textContent);
await ui.openFile(assetsFile(fakeAssets(madeUp)));
check(stored.get(KEY) === JSON.stringify(madeUp), "the key read from resources.assets is kept in this browser");
check(byId.get("error").hidden && !byId.get("viewer").hidden && !!ui.current().save,
      "and the save that was waiting for it opens", byId.get("error").hidden ? "" : byId.get("error").textContent);
check(hasClass(keyNote(), "muted") && !!noteAction("forget-key"), "the note then says the key is kept, with a way to forget it");
noteAction("forget-key").click();
check(!stored.has(KEY) && !!noteAction("choose-key"), "forgetting it removes it, and the offer is back");

// The rest runs on the real save, with the real key handed over as config.js would - or, for a
// save already decrypted and no key to hand, the made-up one, which it does not need.
globalThis.BLUEPRINCE_CONFIG.es3Password = realKey ?? madeUp;
const fakeFile = { name: fileName, arrayBuffer: async () => bytes.buffer };
await ui.openFile(fakeFile);
check(keyNote().hidden, "a key from config.js wins: no offer, and nothing to forget");
check(byId.get("error").hidden, "no error after opening the save",
      byId.get("error").hidden ? "" : byId.get("error").textContent);
check(!byId.get("viewer").hidden && byId.get("intro").hidden, "switched from the drop zone to the viewer");
check(ui.current().route.page === "arrays" && page().some((n) => hasClass(n, "array-block")),
      "the page the address named opens once the save is loaded", ui.current().route.page);

const { save: shown, profile } = ui.current();
const slot = shown.slot(profile);

// ---------------------------------------------------------------- the common block

const common = byId.get("common").textContent;
check(common.includes("SaveFileInfo") && common.includes("CurrentSave"),
      "SaveFileInfo and CurrentSave come first, common to every profile");
check(!/decrypted/.test(common) && !common.includes("Values"),
      "no '(decrypted here)' and no raw value count", common.slice(0, 80).replace(/\s+/g, " "));
// The file's name rides on the privacy line instead of crowding the SaveFileInfo one.
check(byId.get("file-name").textContent === fakeFile.name && !common.includes(fakeFile.name),
      "the file name sits on the privacy line, not in the SaveFileInfo line",
      byId.get("file-name").textContent);
const badges = all("common").filter((n) => hasClass(n, "info"));
check(badges.length > 0 && badges.every((b) => b.dataset.tip && b.dataset.tip.length > 20),
      "every explanation in the common block sits behind an (i) badge", `${badges.length} badges`);

// The build id is meaningless on its own, so it is always qualified. Judge by the class and the
// warning's id, not by fishing for words in the prose - that once passed for the wrong reason.
const matchEl = all("common").find((n) => n.id === "build-match");
const buildWarning = () => all("common").find((n) => n.id === "build-warning");
if (!shown.hasFileInfo) {
  check(!matchEl && buildWarning(), "a save with no SaveFileInfo does not match, and says so");
  check(!common.includes("Save system") && !common.includes("Created"),
        "the facts that block would carry are omitted, not shown as unknown");
} else if (dict.game_version !== shown.gameVersion) {
  check(matchEl?.className === "match no" && buildWarning(), "a save from another build is flagged");
} else {
  check(matchEl?.className === "match yes" && !buildWarning(),
        "a matching build is confirmed rather than silent, and not warned about");
}
// The block shows friendlier labels than the save's own names, so the names must be in the
// popups: they are what the file actually calls these fields.
const infos = all("common").filter((n) => hasClass(n, "info"));
const named = ["game_version", "save_system_version", "save_created", "data_last_modified"]
  .filter((n) => shown.hasFileInfo)
  .every((n) => infos.some((i) => i.dataset.tipField === n && i.dataset.tip));
check(named, "a fact shown under a friendlier label keeps its field name in the popup");
// `current save` sits right under the block's own name, and "profile" is the word the rest
// of the page uses, so it is shown as "Profile".
const slotField = fieldOf("CurrentSave", "current save");
check(slotField?.label === "Profile" && common.includes("Profile") &&
      infos.some((i) => i.dataset.tipField === "current save"),
      "CurrentSave's own `current save` is labelled Profile, with its name in the popup");

const leftovers = ["GAME CLOCK", "Hoursx360", "Day String", "Game Time String"];
check(!leftovers.some((n) => common.includes(n)), "CurrentSave's dormant leftovers are not shown");

// ---------------------------------------------------------------- builds that do not match

// Only the build ids are compared, so a mismatch is faked by changing the save's. The day page
// is the one with the map, which a mismatch must not take away: the warning sits above every page.
if (shown.hasFileInfo) {
  const info = shown.slots.get("SaveFileInfo").objs;
  const real = info.get("game_version");
  const drawn = () => page().some((n) => hasClass(n, "day-map"));

  info.set("game_version", { type: "String", value: JSON.stringify("0.0.0.0") });
  ui.navigate("#/history");
  let warned = buildWarning()?.textContent ?? "";
  check(all("common").find((n) => n.id === "build-match")?.className === "match no" &&
        warned.includes(`made for build ${dict.game_version}`) && warned.includes("written by build 0.0.0.0") &&
        warned.includes("needs updating to build 0.0.0.0"),
        "a different build: 'does not match', and a warning naming both builds and the update needed", warned);
  check(drawn(), "a different build still shows the map");
  check(!page().some((n) => hasClass(n, "warn") && /\bbuild\b/.test(n.textContent)),
        "the day page adds no build warning of its own: there is one, above every page");

  info.delete("game_version");
  ui.navigate("#/history");
  warned = buildWarning()?.textContent ?? "";
  check(all("common").find((n) => n.id === "build-match")?.className === "match no" &&
        warned.includes("does not record which build wrote it") && !warned.includes("needs updating"),
        "a save with no build id does not match, and names no build to update to", warned);
  check(drawn(), "a save with no build id still shows the map");

  if (real) info.set("game_version", real);
  ui.navigate("#/arrays");
}

// The viewer's side: the data files are judged as one build, and only one they all carry counts.
const { loadDictionary, buildMatches } = await import("../app/dictionary.js");
const servedFetch = globalThis.fetch;
const patched = (file, change) => async (path) => {
  const res = await servedFetch(path);
  if (!res.ok || !path.endsWith(file)) return res;
  const body = change(await res.json());
  return { ok: true, status: 200, json: async () => body };
};
globalThis.fetch = patched("floorplans.json", (b) => ({ ...b, game_version: undefined }));
check((await loadDictionary()).gameVersion === null, "a data file with no build stamp leaves the viewer with no build");
globalThis.fetch = patched("runstats-schema.json", (b) => ({ ...b, game_version: "0.0.0.0" }));
check((await loadDictionary()).gameVersion === null, "data files that disagree leave the viewer with no build");
globalThis.fetch = servedFetch;
check((await loadDictionary()).gameVersion === dict.game_version, "data files that agree give their build",
      dict.game_version);
check(buildMatches({ gameVersion: "1" }, "1") && !buildMatches({ gameVersion: null }, "1") &&
      !buildMatches({ gameVersion: "1" }, null) && !buildMatches({ gameVersion: null }, null),
      "only the same build on both sides matches; a missing one never does");

// ---------------------------------------------------------------- profiles and navigation

const buttons = all("profiles").filter((n) => n.tagName === "button");
check(buttons.length > 0 && !buttons.some((b) => b.textContent.includes("Backup")),
      "a button per live profile, no backups", buttons.map((b) => b.textContent).join(" | "));
check(!/backup/i.test(byId.get("profiles").textContent),
      "frozen backup slots are not mentioned at all, rather than announced as withheld");
const links = all("nav").filter((n) => n.tagName === "a").map((a) => a.href);
check(["#/fields", "#/arrays", "#/parlor", "#/rooms", "#/history", "#/stats", "#/daily"].every((h) => links.some((l) => l.startsWith(h))),
      "the navigation reaches every page", links.join(" "));
check(!all("debug-tools").some((n) => hasClass(n, "dormant-toggle")) && byId.get("debug-mark").hidden,
      "no dormant toggle outside debug mode, even with `debug: true` in the config");

// ---------------------------------------------------------------- the field list

ui.navigate("#/fields");
const select = page().find((n) => hasClass(n, "group-select"));
const search = page().find((n) => hasClass(n, "filter"));
const rowNames = () => page().filter((n) => n.className === "field-name").map((n) => n.textContent);
const groupOf = (name) => fieldOf("profile", name)?.group ?? "ungrouped";
// A few fields sit in several groups (`groups`, their own first), and are listed in each.
const groupsOfName = (name) => fieldOf("profile", name)?.groups ?? [groupOf(name)];
const extraGroups = (names) => names.reduce((s, n) => s + groupsOfName(n).length - 1, 0);
const options = select?.children ?? [];
const optionCount = (o) => Number(o?.textContent.match(/\((\d+)\)$/)?.[1]);
check(!!select && !!search && options.length > 2, "the field list has a filter and a group dropdown",
      `All and ${options.length - 1} groups`);
const shownGroup = options.find((o) => o.selected)?.value;
check(options[0]?.value === "all" && shownGroup === "all" && ui.current().route.group === null,
      "the list opens on All, first in the dropdown", shownGroup);
const optionNames = options.slice(1).map((o) => o.textContent.replace(/ \(\d+\)$/, ""));
const realGroups = optionNames.filter((n) => n !== "Ungrouped");
check(realGroups.every((n, i) => i === 0 || realGroups[i - 1].localeCompare(n) <= 0) &&
      (!optionNames.includes("Ungrouped") || optionNames.at(-1) === "Ungrouped"),
      "the groups are listed alphabetically after All, with Ungrouped last",
      `${optionNames.slice(0, 3).join(", ")} ... ${optionNames.slice(-2).join(", ")}`);
const first = rowNames();
const groupSum = options.slice(1).reduce((s, o) => s + optionCount(o), 0);
check(first.length === optionCount(options[0]) && first.length + extraGroups(first) === groupSum && new Set(first.map(groupOf)).size > 1,
      "All lists every field once; the groups hold as many between them, a field in two groups counted in each",
      `${first.length} rows, All (${optionCount(options[0])}), groups ${groupSum}`);
const groupLabels = () => page().filter((n) => hasClass(n, "group-label")).length;
check(groupLabels() === first.length + extraGroups(first), "under All, every row names its groups",
      `${groupLabels()} for ${first.length} rows`);
const other = options.find((o) => !o.selected)?.value;
select.focus();
select.value = other;
select.fire("change");
const second = rowNames();
check(ui.current().route.group === other && second.length > 0 && second.every((n) => groupsOfName(n).includes(other)),
      "choosing a group shows only that group, and the address says so", `${other}: ${second.length}`);
check(groupLabels() === extraGroups(second), "one group's rows do not repeat its name, only the other groups a row is also in",
      `${groupLabels()} labels`);
const newSelect = page().find((n) => hasClass(n, "group-select"));
check(newSelect !== select && globalThis.document.activeElement === newSelect,
      "the group dropdown keeps focus across the re-render, so the arrow keys go on working");
globalThis.document.activeElement = null;

// The blue tents are a Gift Shop purchase and a permanent addition: listed in both groups, and
// in each labelled with the other. The satellite dish and its day are permanent additions too.
{
  const labelsOf = (fieldName) => {
    const row = page().find((n) => n.tagName === "th" && n.children.some((c) => c.className === "field-name" && c.textContent === fieldName));
    return (row?.children ?? []).filter((c) => hasClass(c, "group-label")).map((c) => c.textContent);
  };
  ui.navigate("#/fields/additions");
  const inAdditions = rowNames();
  const tentsHere = labelsOf("blue tents");
  ui.navigate("#/fields/gift-shop");
  const inShop = rowNames();
  const tentsThere = labelsOf("blue tents");
  check(inAdditions.includes("blue tents") && inShop.includes("blue tents") &&
        tentsHere.join() === "Room - Gift Shop" && tentsThere.join() === "Permanent additions" &&
        ["Satellite", "SATDAY"].every((n) => inAdditions.includes(n) || !fieldOf("profile", n)),
        "a field in two groups is listed in both, each time labelled with the other; the satellite fields are permanent additions",
        `additions: ${tentsHere}; gift shop: ${tentsThere}`);
  ui.navigate("#/fields");
}
// A field's own name in an explanation is written in backticks and shown as code, backticks gone.
{
  ui.navigate("#/fields/gift-shop");
  const row = page().find((n) => n.tagName === "tr" && [...n.walk()].some((c) => c.className === "field-name" && c.textContent === "blue tents"));
  const codes = row ? [...row.walk()].filter((n) => n.tagName === "code").map((n) => n.textContent) : [];
  check(codes.includes("slept in blue tents") && codes.includes("end of day steps") && !(row?.textContent ?? "`").includes("`"),
        "field names written in backticks in an explanation show as code, without the backticks", codes.join(", "));
  ui.navigate("#/fields");
}

// What a group has in common is said once, in an (i) beside the dropdown - not in every field.
const toolbarInfo = () => (page().find((n) => hasClass(n, "toolbar"))?.children ?? []).filter((n) => hasClass(n, "info"));
if (options.some((o) => o.value === "glossary")) {
  ui.navigate("#/fields/glossary");
  const gi = toolbarInfo();
  check(gi.length === 1 && /network/.test(gi[0].dataset.tip) &&
        rowNames().every((n) => !/network/.test(fieldOf("profile", n)?.explanation ?? "")),
        "the Terminal glossary group says where the Glossary is once, in its (i), and its fields do not repeat it",
        gi[0]?.dataset.tip.slice(0, 60));
  const { groupNote } = await import("../app/dictionary.js");
  const plain = options.find((o) => !["all", "glossary"].includes(o.value) && !groupNote(o.value))?.value;
  ui.navigate(`#/fields/${plain}`);
  check(toolbarInfo().length === 0, "a group with nothing to add has no (i)", plain);
  ui.navigate("#/fields");
  const labelled = page().filter((n) => hasClass(n, "group-label") && n.textContent === "Terminal glossary");
  check(labelled.length > 0 && labelled.every((n) => n.dataset.tip),
        "under All, the group's name on each of its rows opens the same note", `${labelled.length} rows`);
}

// A phrase in an explanation can carry a note of its own: it is marked and opens the popup,
// and the markup never reaches the screen.
ui.navigate("#/fields");
const noted = page().filter((n) => hasClass(n, "noted"));
const descText = page().filter((n) => n.className === "desc").map((n) => n.textContent).join("\n");
const notedSource = dict.fields.filter((f) => /\[\[[^\]|]+\|[^\]]+\]\]/.test(f.explanation ?? ""));
check(notedSource.length > 0 && noted.length > 0 && noted.every((n) => n.dataset.tip && n.textContent) && !/\[\[|\]\]/.test(descText),
      "a phrase with a note is marked and opens it, and no [[...]] markup is shown",
      `${noted.length} marked: ${noted.map((n) => n.textContent).join(", ")}`);

// The filter narrows what is shown: every group under All, one group once one is chosen.
ui.navigate("#/fields");
const s2 = page().find((n) => hasClass(n, "filter"));
s2.value = "trophy";
s2.fire("input");
const hits = rowNames();
const matchesTrophy = (n) => (n + " " + (fieldOf("profile", n)?.explanation ?? "")).toLowerCase().includes("trophy");
const hitGroups = new Set(hits.map(groupOf));
check(hits.length > 0 && hits.every(matchesTrophy) && hitGroups.size > 1,
      "under All, the filter searches names and explanations in every group",
      `${hits.length} matches in ${hitGroups.size} groups`);
const hitGroup = [...hitGroups][0];
const pickGroup = (g) => {
  const sel = page().find((n) => hasClass(n, "group-select"));
  sel.value = g;
  sel.fire("change");
};
pickGroup(hitGroup);
const narrowed = rowNames();
check(!page().find((n) => hasClass(n, "group-select")).disabled && page().find((n) => hasClass(n, "filter")).value === "trophy" &&
      narrowed.length === hits.filter((n) => groupOf(n) === hitGroup).length && narrowed.every((n) => groupOf(n) === hitGroup),
      "choosing a group keeps the filter, and it then matches only within that group",
      `${hitGroup}: ${narrowed.length} of ${hits.length}`);
pickGroup("all");
check(ui.current().route.group === null && rowNames().length === hits.length,
      "choosing All again returns to the plain address and every group's matches", `${rowNames().length} of ${hits.length}`);
const s5 = page().find((n) => hasClass(n, "filter"));
s5.value = "";
s5.fire("input");
// A field the dictionary homes on another page is not repeated in the list.
const homedNames = dict.fields.filter((f) => f.page && f.container === "profile").map((f) => f.name);
const stillListed = homedNames.filter((n) => {
  const s4 = page().find((x) => hasClass(x, "filter"));
  s4.value = n;
  s4.fire("input");
  const shown = rowNames().includes(n);
  s4.value = "";
  s4.fire("input");
  return shown;
});
check(homedNames.length > 0 && stillListed.length === 0,
      "a field homed on another page is left out of the field list", homedNames.join(", "));

check(page().filter((n) => hasClass(n, "tag")).every((t) => t.dataset.tip), "every confidence tag opens a popup");
check(page().some((n) => n.className === "desc" && n.textContent.trim()), "explanations reach the screen");

// A scalar code the game names shows the name, and the number after it. Any listed field with
// labels will do - one shown by default, whose value in this save has a label.
const coded = dict.fields.find((f) => f.container === "profile" && f.value_labels && !f.dormant && !f.page &&
  f.value_labels[slot.objs.get(f.name)?.value] !== undefined);
if (coded) {
  const codedRaw = slot.objs.get(coded.name).value;
  const s3 = page().find((n) => hasClass(n, "filter"));
  s3.value = coded.name;
  s3.fire("input");
  const row = page().find((n) => n.tagName === "tr" && n.textContent.startsWith(coded.name));
  const cell = row?.children.find((c) => c.className === "value");
  const raw = cell?.children.find((c) => hasClass(c, "raw"));
  check(cell?.textContent.startsWith(coded.value_labels[codedRaw]) && raw?.textContent === codedRaw,
        "a coded value shows its name, with the number after it", `${coded.name}: ${cell?.textContent ?? "row not shown"}`);
  s3.value = "";
  s3.fire("input");
}

// ---------------------------------------------------------------- the array pages

const views = (nodes) => nodes.filter((n) => n.dataset?.array);
const entries = (n) => [...n.walk()].filter((c) => hasClass(c, "array-entry")).length;
const countsRight = (vs) => vs.every((v) => entries(v) === slot.arrays.get(v.dataset.array).items.length);

ui.navigate("#/arrays");
const arrayNames = views(page()).map((v) => v.dataset.array);
check(arrayNames.join("|") === ["TCount Contraptions", "trigger array", "effect array"]
        .filter((n) => slot.arrays.has(n)).join("|"),
      "the Arrays page lists TCount Contraptions, trigger array and effect array", arrayNames.join(", "));
check(!page().some((n) => n.tagName === "details") && !/×/.test(byId.get("page").textContent),
      "no collapsers and no 'N x type' summaries on the Arrays page");
check(countsRight(views(page())), "every array shows as many entries as the save holds");
const unknownIds = () => page().filter((n) => n.className === "unknown").length;
if (matchEl?.className === "match yes") check(unknownIds() === 0, "every coded element decodes");

ui.navigate("#/parlor");
const tiers = views(page());
const orderOk = tiers.every((v) => {
  const pos = Number(slot.objs.get(`Parlor${v.dataset.array[7]}`)?.value);
  const past = [...v.walk()].filter((n) => hasClass(n, "array-entry") && hasClass(n, "past")).length;
  const next = [...v.walk()].filter((n) => hasClass(n, "array-entry") && hasClass(n, "next")).length;
  const heads = [...v.walk()].filter((n) => n.className === "order-group").map((n) => n.textContent);
  return past === pos && next === 1 && heads.some((h) => h.startsWith("Next"));
});
check(tiers.length === 4 && orderOk && countsRight(tiers),
      "the Parlor page groups each tier into past, next and future", `${tiers.length} tiers`);

// Every entry says which puzzle it is and what is written on the three boxes - past, next
// and future alike, which is what the user asked for.
const parlorEntries = tiers.flatMap((v) => [...v.walk()].filter((n) => hasClass(n, "array-entry")));
const described = parlorEntries.filter((n) => [...n.walk()].some((c) => c.tagName === "dl"));
check(parlorEntries.length > 0 && described.length === parlorEntries.length,
      "every Parlor entry shows what is written on the boxes",
      `${described.length} of ${parlorEntries.length}`);
const boxNames = [...described[0].walk()].filter((n) => n.tagName === "dt").map((n) => n.textContent);
check(boxNames.join(",") === "Blue,White,Black", "the three boxes are named", boxNames.join(","));
check(tiers.every((v) => [...v.walk()].some((n) => hasClass(n, "band"))),
      "each tier says the score range it is served in");

// Parlor Score is homed here rather than in the long list, with what moves it beside it.
const scoreBlock = page().find((n) => n.dataset?.field === "Parlor Score");
const scoreValue = slot.objs.get("Parlor Score")?.value;
check(!!scoreBlock && scoreBlock.textContent.includes(String(scoreValue)),
      "the Parlor page shows Parlor Score and its value", `score ${scoreValue}`);
const scoringRows = scoreBlock ? [...scoreBlock.walk()].filter((n) => n.tagName === "tr").length : 0;
check([...(scoreBlock?.walk() ?? [])].some((n) => hasClass(n, "scoring")) && scoringRows > 2,
      "and the table of what moves it", `${scoringRows} rows`);

// The answers are a spoiler, so they stay out of sight until the page's switch is turned on.
const solutionTags = () => page().filter((n) => hasClass(n, "solution"));
const solutionSwitch = page().find((n) => n.id === "show-solutions");
check(!!solutionSwitch && solutionTags().length === parlorEntries.length
        && solutionTags().every((s) => s.hidden === true),
      "the Parlor page hides every solution until asked",
      `${solutionTags().length} tags, switch ${solutionSwitch ? "present" : "missing"}`);
solutionSwitch.checked = true;
solutionSwitch.fire("change");
check(solutionTags().length > 0 && solutionTags().every((s) => s.hidden === false),
      "turning the switch on reveals the solutions");
solutionSwitch.checked = false;
solutionSwitch.fire("change");
check(solutionTags().every((s) => s.hidden === true), "turning it off hides them again");

ui.navigate("#/rooms");
const sections = views(page());
check(sections.length === 2 && sections.every((s) => s.tagName === "details" && s.open === true),
      "the rooms page holds two tables in sections, both open", sections.map((s) => s.dataset.array).join(", "));
check(countsRight(sections), "each table has as many rows as the save holds");
check(!sections.some((s) => / Values$/.test(s.dataset.array)), "the value halves are folded into their tables");
check(page().filter((n) => hasClass(n, "sentinel")).length === 1, "the Slot Zero placeholder is marked, not shown as a room");
check(page().some((n) => hasClass(n, "raw")), "decoded values show their raw code");

const tables = page().filter((n) => n.className === "array-table");
const cellsOf = (tr) => tr.children.filter((c) => c.tagName === "td").map((c) => c.textContent);
const tableWith = (heading) => tables.find((t) => [...t.walk()].some((n) => n.tagName === "button" && n.textContent === heading));
const drafted = tableWith("Times drafted");
if (drafted) {
  const bs = [...drafted.walk()].filter((n) => n.tagName === "button");
  const tb = drafted.children.find((c) => c.tagName === "tbody");
  const column = (k) => tb.children.map((tr) => cellsOf(tr)[k]);
  const sortedBy = (xs, dir) => xs.every((x, i) => i === 0 || dir * (Number(x) - Number(xs[i - 1])) >= 0);
  bs.find((b) => b.textContent === "Times drafted").click();
  const up = sortedBy(column(2), 1);
  bs.find((b) => b.textContent.startsWith("Times drafted")).click();
  const down = sortedBy(column(2), -1);
  bs.find((b) => b.textContent.startsWith("#")).click();
  const back = column(0).every((x, i) => Number(x) === i + 1);
  check(bs.length === 3 && up && down && back, "a table sorts by its columns and returns to the game's order",
        `up ${up}, down ${down}, back ${back}`);
}
const rarity = tableWith("Rarity");
if (rarity) {
  const toggle = page().find((n) => n.className === "table-filter")?.children.find((c) => c.tagName === "input");
  const rowsOf = [...rarity.walk()].filter((n) => hasClass(n, "array-entry"));
  const unchanged = slot.arrays.get("Rarity Shifts Values").items.filter((v) => v === "0").length;
  const before = rowsOf.filter((r) => r.hidden).length;
  toggle.checked = false; toggle.fire("change");
  const after = rowsOf.filter((r) => r.hidden).length;
  check(before === unchanged && after === 0, "the Rarity table hides unchanged rooms until the filter is unticked",
        `${before} hidden of ${rowsOf.length}, ${after} after unticking`);
}

// ---------------------------------------------------------------- the History page

const { splitHistory, estateName, estateParts, HISTORY_COUNTERS } = await import("../app/save.js");
const floorplans = JSON.parse(await readFile(join(root, "data", "floorplans.json"), "utf8"));
const historyItems = slot.arrays.get("History Data")?.items ?? [];
const history = splitHistory(historyItems) ?? [];
const estate = fieldOf("profile", "History Data")?.view?.estate_names ?? null;
if (history.length) {
  ui.navigate("#/history");
  const daySelect = () => page().find((n) => hasClass(n, "day-select"));
  const shownOption = () => daySelect()?.children.find((o) => o.selected)?.value;
  check(daySelect()?.children.length === history.length && shownOption() === String(history.length),
        "the day picker lists every recorded day and opens on the latest",
        `${daySelect()?.children.length} options for ${history.length} days, showing ${shownOption()}`);

  // Pick a day with something to show - the most counters above zero - and go to it through
  // the picker, as a person would.
  const busiest = history.reduce((best, d, i) => {
    const score = Object.values(d.counters).filter(Boolean).length;
    return score > best.score ? { i, score } : best;
  }, { i: history.length - 1, score: -1 }).i;
  const rec = history[busiest];
  // As from the keyboard: the dropdown has focus when it changes.
  const before = daySelect();
  before.focus();
  before.value = String(busiest + 1);
  before.fire("change");
  check(ui.current().route.page === "history" && ui.current().route.day === busiest + 1 &&
        shownOption() === String(busiest + 1),
        "choosing a day shows it, and the address says which", `day ${busiest + 1}`);
  check(daySelect() !== before && globalThis.document.activeElement === daySelect(),
        "the day dropdown keeps focus across the re-render, so the arrow keys go on working");

  const counters = page().filter((n) => n.dataset?.counter);
  const countersOk = counters.length === HISTORY_COUNTERS.length && counters.every((c) =>
    c.children[0].textContent === String(rec.counters[c.dataset.counter]) &&
    !/Count$/.test(c.children[1].textContent));
  check(countersOk, "all fifteen counters show the save's values under names of their own, not the save's",
        counters.map((c) => `${c.children[1].textContent} ${c.children[0].textContent}`).join(", "));
  const facts = page().filter((n) => n.dataset?.fact);
  check(facts.length === 5 && facts.every((f) => f.children[1].textContent === String(rec.header[f.dataset.fact])
                                              && f.children[0].textContent !== f.dataset.fact),
        "the header facts are labelled and match the save",
        facts.map((f) => f.textContent).join(" | "));

  const nameText = page().find((n) => hasClass(n, "estate-name"))?.textContent;
  const expected = estateName(rec.header, estate);
  check(estate ? nameText === expected && !!expected : /cannot be spelt out/.test(byId.get("page").textContent),
        estate ? "the estate name is shown as one value, spelt out from its three codes"
               : "without the word tables the page says the name cannot be spelt out",
        `${nameText} (${rec.header.Prefix1}/${rec.header.House1}/${rec.header.Suffix1})`);

  // Each word of the name has a popup of its own, saying what won it with the day's numbers.
  // Checked on every day of the profile, so won parts, size-named parts and any Abandoned
  // Project are all met.
  if (estate) {
    const unexplained = [];
    let won = 0, sized = 0, abandoned = 0;
    history.forEach((d, i) => {
      ui.navigate(`#/history/${i + 1}`);
      const est = estateParts(d.header, estate);
      const shownParts = page().filter((n) => hasClass(n, "name-part"));
      const bad = (why) => unexplained.push(`day ${i + 1}: ${why}`);
      if (est.abandoned) {
        abandoned++;
        if (shownParts.length !== 1 || !/fewer than/.test(shownParts[0].dataset.tip)) bad("abandoned");
        return;
      }
      if (shownParts.length !== est.parts.length) bad(`${shownParts.length} parts shown for ${est.parts.length}`);
      est.parts.forEach((p, k) => {
        const tip = shownParts[k]?.dataset.tip ?? "";
        if (shownParts[k]?.textContent !== p.word || shownParts[k]?.dataset.part !== p.part ||
            !tip.startsWith(`${p.part[0].toUpperCase()}${p.part.slice(1)}: ${p.word}\n`)) {
          return bad(`${p.part} "${p.word}" shown as "${shownParts[k]?.textContent}"`);
        }
        if (!p.won) {
          sized++;
          if (!tip.includes(`${d.header.RoomsinHouse} rooms`)) bad(`${p.part} does not give the room count`);
          return;
        }
        won++;
        const c = estate.checks[String(p.code)];
        const missing = [...(c.rooms ?? []), ...(c.flags ?? []), ...(c.outer ? [c.outer] : []),
          ...(c.counts ?? []).map(({ of }) => String(of.reduce((a, k2) => a + d.counters[k2], 0)))]
          .filter((x) => !tip.includes(x));
        if (missing.length) bad(`${p.part} "${p.word}" popup lacks ${missing.join(", ")}`);
      });
    });
    const what = "every word of every day's name has its own popup: what won it, with that day's numbers, or the house's size";
    const tally = `${won} won, ${sized} named for size, ${abandoned} abandoned`;
    if (unexplained.length === 0 && won === 0) skip(what, `no word was won on any day: ${tally}`);
    else check(unexplained.length === 0, what, unexplained.length ? unexplained.slice(0, 3).join("; ") : tally);
    ui.navigate(`#/history/${busiest + 1}`);
  }

  // The map: every grid slot drawn exactly once where the layout puts it, blanks as empty
  // tiles, the outer room beside the grid, and every other tile named.
  const tiles = page().filter((n) => hasClass(n, "tile"));
  const gridSlots = floorplans.grid.slots.filter((s) => s.rank);
  const drawn = tiles.map((t) => Number(t.dataset.slot)).sort((a, b) => a - b);
  check(drawn.join() === gridSlots.map((s) => s.slot).sort((a, b) => a - b).join(),
        "every map slot on the grid is drawn once", `${tiles.length} tiles`);
  const blanks = tiles.filter((t) => rec.map[Number(t.dataset.slot)] === floorplans.blank_index);
  check(blanks.length > 0 ? blanks.every((t) => hasClass(t, "empty") && !t.textContent)
                          : tiles.every((t) => !hasClass(t, "empty")),
        "a blank slot is drawn as an empty tile", `${blanks.length} blank`);
  const named = tiles.filter((t) => !hasClass(t, "empty"));
  const byIndex = new Map(floorplans.entries.map((e) => [e.index, e]));
  check(named.every((t) => t.textContent === byIndex.get(rec.map[Number(t.dataset.slot)])?.name),
        "every other tile carries the name of its floorplan", `${named.length} rooms`);
  // Top-left is the north-west corner, bottom-middle the Entrance Hall.
  const entrance = gridSlots.find((s) => s.rank === 1 && s.column === 3);
  check(Number(tiles[tiles.length - 3].dataset.slot) === entrance?.slot &&
        tiles[tiles.length - 3].textContent === "Entrance Hall",
        "north is at the top: the Entrance Hall sits in the middle of the bottom row",
        tiles[tiles.length - 3].textContent);
  check(page().some((n) => hasClass(n, "outer-room")), "the outer room is shown beside the grid");

  // Stepping moves one day at a time and stops at the ends.
  const steps = () => page().filter((n) => hasClass(n, "step"));
  ui.navigate("#/history/1");
  check(steps()[0].disabled === true && steps()[1].disabled === (history.length === 1),
        "on the first day there is no earlier one to step to");
  if (history.length > 1) {
    steps()[1].click();
    check(ui.current().route.day === 2 && shownOption() === "2", "the next-day button moves on one day");
  }

  // A History Data that does not split into whole days is reported, not drawn as if fine.
  const kept = historyItems.pop();
  ui.navigate("#/history");
  const problem = page().find((n) => hasClass(n, "history-problem"));
  check(!!problem && !page().some((n) => hasClass(n, "tile") || hasClass(n, "day-select")),
        "a History Data of the wrong length is reported instead of drawn", problem?.textContent.slice(0, 60));
  historyItems.push(kept);
  ui.navigate("#/history");
  check(!page().some((n) => hasClass(n, "history-problem")), "and a whole one is not flagged");
} else {
  ui.navigate("#/history");
  check(/No day has been recorded/.test(byId.get("page").textContent),
        "a profile with no recorded day says so");
}

// ---------------------------------------------------------------- the Stats page

const runstats = JSON.parse(await readFile(join(root, "data", "runstats-schema.json"), "utf8"));
const doc = ui.current().stats;
if (slot.arrays.get("DATA")?.items.length && doc) {
  ui.navigate("#/stats");
  const cards = page().filter((n) => n.dataset?.ranking);
  check(cards.map((c) => c.dataset.ranking).join() ===
        "mostDrafted,bestDraftRate,worstDraftRate,mostGems,mostTime,coatChecks",
        "the Stats page shows the six rankings the game builds", `${cards.length} cards`);

  // Checked against a recount written independently of rankings.js: the most drafted room is
  // the one with the most drafts among rooms other than the Secret Garden and Room 8, and the
  // best draft rate names one room only.
  const totals = new Map();
  for (const d of doc.DaysData.Days) for (const r of d.RoomData.Rooms) {
    const t = totals.get(r.id) ?? { built: 0, discarded: 0 };
    t.built += r.built; t.discarded += r.discarded; totals.set(r.id, t);
  }
  const ranked = ([id]) => id > 0 && id !== 70 && id !== 8;
  const eligible = [...totals].filter((e) => ranked(e) && e[1].built >= 1);
  const rated = [...totals].filter((e) => ranked(e) && e[1].built + e[1].discarded > 2);
  const topBuilt = Math.max(...eligible.map(([, t]) => t.built));
  const firstOf = (key) => cards.find((c) => c.dataset.ranking === key)?.children.find((n) => n.tagName === "ol")?.children ?? [];
  const drafted = firstOf("mostDrafted");
  const leads = "most drafted leads with the room drafted most often";
  if (!eligible.length) skip(leads, "no room has been drafted");
  else check(drafted.length === Math.min(3, eligible.length) && totals.get(Number(drafted[0].dataset.id))?.built === topBuilt,
             leads, `${drafted[0]?.textContent}`);
  const one = "best draft rate names one room, as the game does";
  if (!rated.length) skip(one, "no room has been drafted or discarded three times");
  else check(firstOf("bestDraftRate").length === 1, one);
  const roomNames = runstats.id_names.RoomID.labels;
  check(cards.every((c) => [...c.walk()].filter((n) => n.dataset?.id !== undefined).every((li) => {
          const card = c.dataset.ranking;
          const name = card === "coatChecks" ? runstats.id_names.ItemID.labels[Number(li.dataset.id)]
                                             : roomNames[Number(li.dataset.id)];
          return !!name && li.textContent.includes(name);
        })),
        "every ranked room and item is shown by the game's own name");

  const roomRows = page().find((n) => hasClass(n, "stats-rooms"));
  const rowsIn = (n) => [...(n?.walk() ?? [])].filter((c) => hasClass(c, "stats-row"));
  check(rowsIn(roomRows).length === doc.GlobalRoomStats.Rooms.length &&
        !rowsIn(roomRows).some((r) => [...r.walk()].some((c) => hasClass(c, "unknown"))),
        "the rooms table has a row per room in the run totals, every one named",
        `${rowsIn(roomRows).length} rows`);
  for (const [cls, list] of [["stats-items", doc.GlobalItemStats.Items], ["stats-timers", doc.GlobalTimerStats.Timers],
                             ["stats-books", doc.GlobalBookStats.Books]]) {
    const sec = page().find((n) => hasClass(n, cls));
    check(rowsIn(sec).length === list.length, `the ${cls.slice(6)} table has a row per entry`, `${list.length}`);
  }
  const warnsIn = (cls) => [...(page().find((n) => hasClass(n, cls))?.walk() ?? [])].filter((c) => hasClass(c, "warn"));
  check(warnsIn("stats-timers").some((w) => /often wrong/.test(w.textContent)) && !warnsIn("stats-books").length,
        "the reading-time section warns that its times are often wrong, and only that section");
  const pageText = byId.get("page").textContent;
  check(!/\b\d{5,} s\b/.test(pageText), "no time is shown as raw seconds");
  // Timer times are in hundredths; only a profile with a minute of something shows minutes.
  const longest = Math.max(0, ...doc.GlobalRoomStats.Rooms.map((r) => r.time),
                           ...doc.GlobalTimerStats.Timers.map((t) => t.Time / 100));
  const hm = "times of a minute or more are shown in hours and minutes";
  if (longest < 60) skip(hm, `no recorded time reaches a minute (longest ${Math.round(longest)} s)`);
  else check(/\d+ h \d\d min|\d+ min \d\d s/.test(pageText), hm);

  // An id the lists do not cover is shown as its number and flagged, not dropped.
  doc.GlobalRoomStats.Rooms.push({ id: 999, built: 1, discarded: 0, gems: 0, time: 0 });
  ui.navigate("#/stats");
  const flagged = rowsIn(page().find((n) => hasClass(n, "stats-rooms")))
    .filter((r) => [...r.walk()].some((c) => hasClass(c, "unknown") && c.textContent.includes("999")));
  check(flagged.length === 1, "a room id the game's list does not cover is shown as its number and flagged");
  doc.GlobalRoomStats.Rooms.pop();

  // The Stats page is the run: rankings and totals, and no day picker.
  ui.navigate("#/stats");
  check(!page().some((n) => hasClass(n, "stats-day-picker") || hasClass(n, "stats-timeline")),
        "the Stats page shows the run only - no day picker, no day's record");

  // Daily Stats: one day of the log. Its picker offers every recorded day and opens on the
  // latest; a day shows its own record without the rankings, and the timeline names every event.
  const days = doc.DaysData.Days;
  const statsOptions = () => [...(page().find((n) => hasClass(n, "stats-day-picker"))?.walk() ?? [])]
    .filter((n) => n.tagName === "option");
  ui.navigate("#/daily");
  if (!days.length) {
    check(/No day has been recorded/.test(byId.get("page").textContent), "Daily Stats says when no day is recorded");
  } else {
    check(statsOptions().length === days.length && statsOptions().at(-1).selected,
          "the Daily Stats picker offers every recorded day and opens on the latest", `${statsOptions().length} options`);
    const d = days.reduce((a, b) => (b.Timeline._rawEvents.length > a.Timeline._rawEvents.length ? b : a));
    ui.navigate(`#/daily/${d.Num}`);
    const sec = (cls) => page().find((n) => hasClass(n, cls));
    check(ui.current().route.day === d.Num && statsOptions().find((o) => o.selected)?.value === String(d.Num) &&
          sec("stats-daystats") && sec("stats-timeline") && !sec("stats-books") &&
          !page().some((n) => n.dataset?.ranking),
          "choosing a day shows that day's record, without the rankings or the run totals", `day ${d.Num}`);
    check(rowsIn(sec("stats-rooms")).length === d.RoomData.Rooms.length,
          "the day's rooms table has a row per room recorded that day", `${d.RoomData.Rooms.length}`);
    const statNames = [...sec("stats-daystats").walk()].filter((n) => n.tagName === "dt")
      .map((n) => n.children[0]?.textContent);
    check(statNames.length === Object.keys(d.DayStats).length && statNames.includes("Rank Reached") &&
          statNames.includes("Mechanarium Doors Open"),
          "every day stat is listed under its name, split into words", `${statNames.length}`);
    // The stats come in titled cards of related figures, every stat in exactly one.
    const cards = [...sec("stats-daystats").walk()].filter((n) => hasClass(n, "day-stat-group"));
    const inCards = cards.flatMap((c) => [...c.walk()].filter((n) => n.tagName === "dt"));
    const stacks = [...sec("stats-daystats").walk()].filter((n) => hasClass(n, "day-stat-stack"));
    const resources = cards.find((c) => c.dataset.group === "Resources");
    check(stacks.length === 4 && cards.length === 10 && cards[0].dataset.group === "Progress" &&
          hasClass(cards.find((c) => c.dataset.group === "Lab") ?? {}, "full") &&
          !stacks.some((s) => [...s.walk()].some((n) => n.dataset?.group === "Lab")) &&
          cards.some((c) => c.dataset.group === "Exams") &&
          [...(resources?.walk() ?? [])].filter((n) => hasClass(n, "day-stat-part")).length === 2 &&
          inCards.length === Object.keys(d.DayStats).length && new Set(inCards).size === inCards.length,
          "the day stats are grouped into titled cards in four stacks, each stat in one",
          cards.map((c) => c.dataset.group).join(", "));
    // The four stats that only ever grow carry a marker whose popup says so; no other stat does.
    const dts = () => [...sec("stats-daystats").walk()].filter((n) => n.tagName === "dt");
    const marked = [...sec("stats-daystats").walk()].filter((n) => hasClass(n, "running-total"));
    const markedOn = marked.map((m) => dts().find((dt) => dt.children.includes(m))?.children[0]?.textContent);
    check(marked.length === 4 && marked.every((m) => m.dataset.tip === "This value accumulates as days pass.") &&
          ["Darts Solved", "Parlors Puzzles Correct", "Parlors Puzzles Incorrect", "Lab Letters"]
            .every((l) => markedOn.includes(l)),
          "the four running totals, and only they, are marked with a popup saying so", markedOn.join(", "));
    // The day stats whose names say too little carry an (i) with what they mean; Stars and
    // Allowance carry nothing.
    const badgeOf = (label) => dts().find((dt) => dt.children[0]?.textContent === label)
      ?.children.find((c) => hasClass(c, "info"));
    check(["Class Nums", "Exam Score", "Lab Letters", "Last Room", "Casino Balance", "Casino Slot Balance",
           "Blessing Coins", "Cloister Success", "Special Order"].every((l) => badgeOf(l)?.dataset.tip) &&
          !badgeOf("Stars") && !badgeOf("Allowance"),
          "the day stats whose names say too little carry an (i) explanation, and Stars and Allowance none");
    // A stat shown under a label of its own keeps its field name in its (i).
    check([["Mechanarium Doors Open", "MechaDoorsOpen"], ["Ivory Dices Used", "IvDicesUsed"],
           ["Ivory Dices Left", "IvDicesLeft"]].every(([l, f]) => badgeOf(l)?.dataset.tipField === f) &&
          !dts().some((dt) => hasClass(dt.parent ?? {}, "zero")) &&
          ![...sec("stats-daystats").walk()].some((n) => hasClass(n, "zero")),
          "renamed stats show their field name in the (i), and no stat is dimmed");
    // A room stat of -1 (never set that day) or 0 (the placeholder slot) is none, not an unknown room.
    const statText = (label) => [...sec("stats-daystats").walk()]
      .find((n) => hasClass(n, "day-stat") && n.children[0]?.children[0]?.textContent === label);
    const keptRooms = [d.DayStats.OuterRoom, d.DayStats.LastRoom];
    d.DayStats.OuterRoom = -1; d.DayStats.LastRoom = 0;
    ui.navigate(`#/daily/${d.Num}`);
    check(["Outer Room", "Last Room"].every((l) => statText(l)?.children[1]?.textContent === "none" &&
          ![...statText(l).walk()].some((c) => hasClass(c, "unknown"))),
          "a room stat left at -1 or 0 reads none, not an unknown room");
    [d.DayStats.OuterRoom, d.DayStats.LastRoom] = keptRooms;
    ui.navigate(`#/daily/${d.Num}`);
    const trows = () => [...sec("stats-timeline").walk()].filter((n) => hasClass(n, "timeline-row"));
    const cells = (tr) => tr.children.map((c) => c.textContent);
    check(trows().length === d.Timeline._rawEvents.length &&
          trows().every((tr) => /^\d+:\d\d(:\d\d)?$/.test(cells(tr)[0]) && !/^\d+$/.test(cells(tr)[1]) &&
                                !trows().some((r) => [...r.walk()].some((c) => hasClass(c, "unknown")))),
          "the timeline lists every event in order, with a clock time and the event's name",
          `${trows().length} events`);
    const draft = d.Timeline._rawEvents.map((s) => JSON.parse(s)).find((e) => "RoomID" in e && "Gems" in e);
    const roomName = runstats.id_names.RoomID.labels[draft?.RoomID];
    check(!draft || trows().some((tr) => cells(tr)[2].includes(roomName)),
          "a draft event names the room drafted", roomName);
    // An event or room id the game's lists do not cover is flagged in place, not dropped.
    d.Timeline._rawEvents.push('{"E":9999,"T":0}', '{"E":2000,"T":1,"RoomID":999,"Gems":0}');
    ui.navigate(`#/daily/${d.Num}`);
    const odd = trows().slice(-2).map((tr) => [...tr.walk()].some((c) => hasClass(c, "unknown")));
    check(odd.every(Boolean), "an unknown event id and an unknown room in an event are shown as numbers and flagged");
    d.Timeline._rawEvents.splice(-2, 2);
    const statsSteps = () => page().filter((n) => hasClass(n, "step"));
    ui.navigate(`#/daily/${days[0].Num}`);
    check(statsSteps()[0].disabled === true && statsSteps()[1].disabled === (days.length === 1),
          "on the first day there is no earlier one to step to");
    if (days.length > 1) {
      statsSteps()[1].click();
      check(ui.current().route.day === days[1].Num && statsOptions()[1].selected,
            "the next-day button moves on one day");
    }
  }

  // A profile without DATA says so in this page.
  const data = slot.arrays.get("DATA");
  slot.arrays.delete("DATA");
  ui.navigate("#/stats");
  check(page().some((n) => hasClass(n, "stats-problem")) && /no DATA/.test(byId.get("page").textContent),
        "a profile without DATA says so on the Stats page instead of showing nothing");
  ui.navigate("#/daily");
  check(page().some((n) => hasClass(n, "stats-problem")) && /no DATA/.test(byId.get("page").textContent),
        "and on the Daily Stats page");
  slot.arrays.set("DATA", data);
  ui.navigate("#/stats");
  check(!page().some((n) => hasClass(n, "stats-problem")), "and with it back, the statistics return");
}

// ---------------------------------------------------------------- everywhere

const everywhere = () => [...all("common"), ...all("profiles"), ...all("page"), ...all("build-info")];
check(!everywhere().some((n) => n._titleSet), "nothing rendered uses a native title tooltip");
check(everywhere().filter((n) => n.dataset?.tip !== undefined).every((n) => n.dataset.tip),
      "no badge opens an empty popup");
for (const p of ["fields", "arrays", "parlor", "rooms"]) {
  ui.navigate(`#/${p}`);
  const t = byId.get("page").textContent;
  if (views(page()).some((v) => ["DATA", "History Data"].includes(v.dataset.array)) || /\bHistory Data\b/.test(t)) {
    check(false, `DATA and History Data stay off the ${p} page`);
  }
}

// ---------------------------------------------------------------- dormant fields

// Debug mode: a plain click on the title does nothing, a Ctrl-click turns it on, shows the mark
// and is remembered. Dormant values can only be brought back in debug mode.
byId.get("title").fire("click");
check(byId.get("debug-mark").hidden && !stored.has("blueprince-viewer:debug"), "a plain click on the title leaves debug mode off");
byId.get("title").fire("click", { ctrlKey: true });
check(!byId.get("debug-mark").hidden && stored.get("blueprince-viewer:debug") === "true",
      "Ctrl-click on the title turns debug mode on, shows the mark by the title and remembers it");
// Hidden in normal use; shown by the API the debug toggle drives, and only then.
ui.navigate("#/arrays");
check(!views(page()).some((v) => v.dataset.array === "MapOrder"), "a field nothing reads is hidden, whatever it holds");
const shownBefore = views(page()).map((v) => v.dataset.array);
ui.setHideDormant(false);
const shownDormant = views(page()).map((v) => v.dataset.array);
check(shownDormant.includes("MapOrder"), "dormant arrays come back when shown", shownDormant.join(", "));
const parlorArray = views(page()).find((v) => v.dataset.array === "Parlor Array");
if (slot.arrays.get("Parlor Array")?.items.length) {
  check(!!parlorArray && entries(parlorArray) === slot.arrays.get("Parlor Array").items.length,
        "an array without a view shows as a plain list");
}
// Shown, a dormant value says so: every array that comes back only with the toggle is marked,
// and the others are not.
const cameBack = views(page()).filter((v) => !shownBefore.includes(v.dataset.array));
const marked = (v) => hasClass(v, "dormant") && [...v.walk()].some((n) => hasClass(n, "tag") && hasClass(n, "dormant") && n.dataset.tip);
check(cameBack.length > 0 && cameBack.every(marked) && views(page()).filter((v) => shownBefore.includes(v.dataset.array)).every((v) => !marked(v)),
      "each dormant array the toggle brings back is marked dormant, with the reason in its popup, and no other is",
      cameBack.map((v) => v.dataset.array).join(", "));
// The same for a field in the list: one the dictionary calls dormant, at its default here.
const sleeper = dict.fields.find((f) => f.container === "profile" && f.dormant && !f.page &&
  slot.objs.has(f.name) && ["0", "false", '""'].includes(String(slot.objs.get(f.name).value)));
if (sleeper) {
  ui.navigate("#/fields");
  const s5 = page().find((x) => hasClass(x, "filter"));
  s5.value = sleeper.label ?? sleeper.name; s5.fire("input");
  const row = page().find((n) => n.tagName === "tr" &&
    [...n.walk()].some((c) => c.className === "field-name" && c.textContent === (sleeper.label ?? sleeper.name)));
  check(!!row && hasClass(row, "dormant") && [...row.walk()].some((c) => hasClass(c, "tag") && hasClass(c, "dormant")),
        "a dormant field shown by the toggle is marked in the list too", sleeper.name);
  s5.value = ""; s5.fire("input");
}
ui.setHideDormant(true);
const toggleText = (p) => { ui.navigate(p); return all("debug-tools").find((n) => hasClass(n, "dormant-toggle"))?.textContent ?? ""; };
const onFields = toggleText("#/fields");
check(all("debug-tools").some((n) => hasClass(n, "dormant-toggle")) && !all("nav").some((n) => hasClass(n, "dormant-toggle")),
      "debug mode shows the dormant toggle, on the privacy line rather than in the navigation");
const onArrays = toggleText("#/arrays");
check(/\d+ hidden: .*\d+ on this page/.test(onFields) && /\d+ hidden: .*\d+ on this page/.test(onArrays) && onFields !== onArrays,
      "the toggle says how many dormant values it hides on each page, the Arrays page included",
      `fields: "${onFields}", arrays: "${onArrays}"`);
ui.setHideDormant(false);
const commonDormant = all("common").filter((n) => hasClass(n, "fact") && hasClass(n, "dormant"));
check(commonDormant.length > 0 && !all("common").some((n) => hasClass(n, "tag") && hasClass(n, "dormant")),
      "in the file block, dormant facts are muted but carry no tag", `${commonDormant.length} muted`);
check(/shown, marked: /.test(all("debug-tools").find((n) => hasClass(n, "dormant-toggle"))?.textContent ?? ""),
      "and, once they are shown, that they are marked");
// On their own: the list holds dormant fields only, every one marked, and the file block keeps
// only its dormant facts - so they can be gone over without the rest in the way.
ui.setDormantMode("only");
ui.navigate("#/fields");
const onlyRows = page().filter((n) => n.tagName === "tr" && !hasClass(n, "facts-row"));
check(onlyRows.length > 0 && onlyRows.every((r) => hasClass(r, "dormant")),
      "shown on their own, the field list holds dormant fields and nothing else", `${onlyRows.length} rows`);
const currentLine = all("common").find((n) => hasClass(n, "fact-line") &&
  [...n.walk()].some((c) => hasClass(c, "container-name") && c.textContent === "CurrentSave"));
const currentFacts = currentLine ? currentLine.children.filter((c) => hasClass(c, "fact")) : [];
check(currentFacts.length > 0 && currentFacts.every((f) => hasClass(f, "dormant")),
      "the file block's CurrentSave line keeps only its dormant facts", `${currentFacts.length} facts`);
check(/shown, nothing else: /.test(all("debug-tools").find((n) => hasClass(n, "dormant-toggle"))?.textContent ?? ""),
      "and the toggle says so");
ui.navigate("#/arrays");
check(views(page()).length > 0 && views(page()).every((v) => hasClass(v, "dormant")),
      "the Arrays page shows only its dormant arrays too", views(page()).map((v) => v.dataset.array).join(", "));
ui.setHideDormant(true);

// A value the viewer's model says a field cannot have: a dormant field something reads, holding
// something other than its default. Made here by changing one value in the open save. It shows
// with dormant fields hidden, not muted, with the dormant tag and the "!" mark beside it.
const odd = dict.fields.find((f) => f.container === "profile" && f.dormant && !f.no_reader && !f.page &&
  slot.objs.get(f.name)?.type === "Boolean" && String(slot.objs.get(f.name).value) === "false" &&
  [null, "false"].includes(f.start ?? null));
if (odd) {
  const entry = slot.objs.get(odd.name);
  const was = entry.value;
  entry.value = "true";
  ui.navigate("#/fields");
  const f6 = page().find((x) => hasClass(x, "filter"));
  f6.value = odd.label ?? odd.name; f6.fire("input");
  const row = page().find((n) => n.tagName === "tr" &&
    [...n.walk()].some((c) => c.className === "field-name" && c.textContent === (odd.label ?? odd.name)));
  const tags = row ? [...row.walk()].filter((c) => hasClass(c, "tag")) : [];
  check(!!row && !hasClass(row, "dormant") && tags.some((t) => hasClass(t, "dormant")) &&
        tags.some((t) => hasClass(t, "unexpected") && t.textContent === "!" &&
                        /does not match the viewer's model/.test(t.dataset.tip ?? "")),
        "a value the model says a dormant field cannot have shows with dormant fields hidden, tagged dormant and marked !",
        odd.name);
  f6.value = ""; f6.fire("input");
  entry.value = was;
  ui.navigate("#/fields");
  check(!page().some((n) => hasClass(n, "unexpected")), "and with the save's own value back, nothing is marked");
} else {
  skip("a value the model says a dormant field cannot have is marked", "no dormant Boolean field read by something in this profile");
}

// Fact sheets: a second debug switch folds a fact sheet under each field.
ui.navigate("#/fields");
const factsBox = () => all("debug-tools").find((n) => hasClass(n, "facts-toggle"))
  ?.children.find((c) => c.tagName === "input");
const factRows = () => page().filter((n) => hasClass(n, "facts-row"));
check(!!factsBox() && factRows().length === 0, "debug offers a fact-sheet switch, and the sheets stay folded away until it is on");
const factsFile = JSON.parse(await readFile(join(root, "data", "field-facts.json"), "utf8"));
factsBox().checked = true;
factsBox().fire("change");
for (let i = 0; i < 100 && !factRows().length; i++) await new Promise((r) => setTimeout(r, 10));
const plainRows = page().filter((n) => n.tagName === "tr" && !hasClass(n, "facts-row"));
check(factRows().length > 0 && factRows().length === plainRows.length,
      "switched on, every field in the list has its fact sheet under it", `${factRows().length} of ${plainRows.length}`);
// Opening one builds it from the file: one entry per writer and reader the file lists.
const dayRow = plainRows.findIndex((r) => [...r.walk()].some((c) => c.className === "field-name" && c.textContent === "DAY"));
if (dayRow >= 0) {
  const det = [...factRows()[dayRow].walk()].find((n) => n.tagName === "details");
  det.open = true;
  det.fire("toggle");
  const items = [...det.walk()].filter((n) => n.tagName === "li" && n.children.some((c) => c.className === "fs-where")).length;
  const want = factsFile.sheets["profile/DAY"].refs.length;
  check(items === want, "an opened fact sheet lists every reference the file has for that field", `DAY: ${items} of ${want}`);
  // The data carries no observed values; the sheet lists
  // the open save's instead: each value of DAY with the profiles that hold it.
  const pairs = [...det.walk()].find((n) => n.tagName === "dl")?.children ?? [];
  const rows = [];
  for (let i = 0; i < pairs.length; i += 2) rows.push(`${pairs[i].textContent}=${pairs[i + 1]?.textContent}`);
  const open = ui.current().save;
  const byValue = new Map();
  for (const n of open.profileNames()) {
    const v = open.slot(n).objs.get("DAY")?.value;
    if (v != null) byValue.set(v, [...(byValue.get(v) ?? []), n]);
  }
  const expected = [`new profile=${factsFile.sheets["profile/DAY"].values.new_profile}`,
                    ...[...byValue].map(([v, names]) => `${v}=${names.join(", ")}`)];
  check(!factsFile.sources?.dumps && !factsFile.sources?.saves && Object.keys(factsFile.sheets["profile/DAY"].values).join() === "new_profile" &&
        rows.join(" | ") === expected.join(" | "),
        "a sheet's values are the new profile's and the open save's, by profile - none from the data",
        rows.join(" | "));
}
// A read that only feeds an increment (read, add, write back) is listed apart from the readers.
const clockRow = plainRows.findIndex((r) => [...r.walk()].some((c) => c.className === "field-name" && c.textContent === "clock rooms"));
check(clockRow >= 0, "clock rooms is in the field list, for the increment check");
if (clockRow >= 0) {
  const det = [...factRows()[clockRow].walk()].find((n) => n.tagName === "details");
  det.open = true;
  det.fire("toggle");
  const sums = [...det.walk()].filter((n) => n.tagName === "summary").map((n) => n.textContent);
  const c = factsFile.sheets["profile/clock rooms"].counts;
  check(c.increment.live > 0 && sums.includes(`${c.increment.live} reads that only feed an increment`)
        && sums.includes(`${c.read.live} reader${c.read.live === 1 ? "" : "s"}`),
        "a read that only feeds an increment is listed apart from the readers", sums.join(" | "));
}
// Where a read's copy goes: the Sauna's +20 is reached only through DAY's copy of the
// flag, handed on to the step tag's own flag - neither names YesterSauna.
const openSheet = (name) => {
  const i = plainRows.findIndex((r) => [...r.walk()].some((c) => c.className === "field-name" && c.textContent === name));
  if (i < 0) return null;
  const det = [...factRows()[i].walk()].find((n) => n.tagName === "details");
  det.open = true;
  det.fire("toggle");
  return det;
};
// Open every folded copy block under `root`, level by level, as a reader would.
const unfold = (root) => {
  for (let round = 0; round < 6; round++) {
    const shut = [...root.walk()].filter((n) => n.tagName === "details" && hasClass(n, "fs-copies") && !n.open);
    if (!shut.length) break;
    for (const d of shut) { d.open = true; d.fire("toggle"); }
  }
};
const sauna = openSheet("YesterSauna");
check(!!sauna, "YesterSauna is in the field list, for the copy check");
if (sauna) {
  unfold(sauna);
  const has = (t) => [...sauna.walk()].some((n) => n.textContent?.includes(t));
  check(has("[Stat Add 11]") && has("Adjustment Amount = '20'") && has("Bed UI Slide.Sauna"),
        "a read's copy is followed into the FSM it is handed on to: the Sauna's +20 shows under DAY's read");
}
// Where a value crosses into C#: the draft hands its copy of the Rumpus Room's cooldown
// to RoomDraftHelper.IgnoreRoomFor, which no FSM shows - the sheet's summary and its game-code
// block both say so, and the trace marks the use.
const rumpusRow = plainRows.find((r) => [...r.walk()].some((c) => c.className === "field-name" && c.textContent === "rumpus room cooldown"));
const rumpusSheet = openSheet("rumpus room cooldown");
if (rumpusSheet) {
  const summary = [...rumpusSheet.walk()].find((n) => n.tagName === "summary")?.textContent ?? "";
  const block = [...rumpusSheet.walk()].find((n) => hasClass(n, "fs-native"));
  unfold(rumpusSheet);
  const marked = [...rumpusSheet.walk()].some((n) => hasClass(n, "fs-native-use") && n.textContent.includes("RoomDraftHelper.IgnoreRoomFor()"));
  check(/reaches C# code/.test(summary) && !!block && block.textContent.includes("RoomDraftHelper.IgnoreRoomFor()") && marked,
        "a field whose copy reaches the game's C# says so in its summary, its game-code block and its trace",
        summary);
}
check(!!rumpusRow, "rumpus room cooldown is in the field list, for the game-code check");
// The family-outlier flag explains what a family and an outlier are. No shipped field is an
// outlier now (only untraced family members are compared), so a made-up sheet stands in.
{
  const { factSummary, factSheet } = await import("../app/facts.js");
  const fake = { container: "profile", name: "Example Added", type: "int", category: null, csharp_literal: false,
                 counts: {}, refs: [], values: { new_profile: "0" },
                 checks: { contradictions: [], no_reader: null,
                           family_outlier: { family: "draft-pool", exemplar: "Aquarium Added", n_missing: 1, n_extra: 2,
                                             missing: [], extra: [] } } };
  const flag = factSummary(fake).find((p) => typeof p !== "string" && p.dataset?.tip);
  const line = [...factSheet(fake).walk()].find((n) => n.dataset?.tip && n.textContent === "Family outlier");
  check(!!flag && flag.textContent === "family outlier" && /A group is different/.test(flag.dataset.tip) &&
        /Only members not traced on their own/.test(flag.dataset.tip) && line?.dataset.tip === flag.dataset.tip,
        "the family-outlier flag, in a sheet's summary and in the sheet, opens the note on what a family, a group and an outlier are");
}
const saveSlotSheet = openSheet("SaveSlot");
if (saveSlotSheet) {
  const sums = [...saveSlotSheet.walk()].filter((n) => n.tagName === "summary").map((n) => n.textContent);
  const c = factsFile.sheets["profile/SaveSlot"].counts;
  check(c.unused.live > 0 && sums.includes(`${c.unused.live} reads whose copy nothing uses`),
        "a read whose copy nothing uses is listed apart from the readers", sums.filter((s) => /read/.test(s)).join(" | "));
}
// The Blackbridge duplicate and restore screens save their own copy of a whole profile, which
// carries Save Complete along; those are listed apart from the persistent manager's own writes.
const saveDoneSheet = openSheet("Save Complete");
if (saveDoneSheet) {
  const sums = [...saveDoneSheet.walk()].filter((n) => n.tagName === "summary").map((n) => n.textContent);
  const c = factsFile.sheets["profile/Save Complete"].counts;
  // A block's heading counts all its references and says how many of them are dead.
  const heading = (n, dead, noun) => `${n + dead} ${noun}` + (dead ? ` · ${dead} dead` : "");
  check(c.copy.live > 0 && c.write.live > 0 && sums.includes(heading(c.copy.live, c.copy.dead, "saves of a whole-profile copy"))
        && sums.includes(heading(c.write.live, c.write.dead, `writer${c.write.live + c.write.dead === 1 ? "" : "s"}`)),
        "a save of a whole-profile copy is listed apart from the writers", sums.join(" | "));
}
check(!!saveDoneSheet, "Save Complete is in the field list, for the whole-profile copy check");
// A state entered only through a global event nothing sends never runs: each Blackbridge
// restore row's own save states are listed, as dead, with the event nobody sends.
if (saveDoneSheet) {
  const texts = [...saveDoneSheet.walk()].map((n) => n.textContent ?? "");
  const unsent = factsFile.sheets["profile/Save Complete"].refs.filter((r) => /nothing sends/.test(r.dead ?? ""));
  check(unsent.length > 0 && texts.some((t) => t.startsWith("dead - never runs: it is reached only through the global event"))
        && texts.some((t) => /global event Event \d, which nothing sends/.test(t)),
        "a reference entered only through an event nothing sends is shown dead, and its entry says why",
        `${unsent.length} such references`);
}
factsBox().checked = false;
factsBox().fire("change");
check(factRows().length === 0, "switching it off folds the sheets away again");
check(stored.get("blueprince-viewer:factSheets") === "false" && stored.get("blueprince-viewer:dormantMode") === "\"hide\"",
      "the fact-sheet switch and the dormant setting are remembered in this browser",
      `${stored.get("blueprince-viewer:factSheets")}, ${stored.get("blueprince-viewer:dormantMode")}`);

// Debug mode off: the toggles go, and a dormant setting left at "shown" no longer shows anything.
ui.setHideDormant(false);
byId.get("title").fire("click", { ctrlKey: true });
ui.navigate("#/arrays");
check(byId.get("debug-mark").hidden && stored.get("blueprince-viewer:debug") === "false" &&
      !all("debug-tools").some((n) => hasClass(n, "dormant-toggle")) &&
      !views(page()).some((v) => v.dataset.array === "MapOrder"),
      "Ctrl-click again turns debug mode off: no toggles, and dormant values stay hidden whatever the setting was left at");

// The profile picked in a save is picked again when the same save is opened, and not once the
// file has changed: it is remembered under a fingerprint of the file's bytes.
{
  const choice = all("profiles").find((n) => n.tagName === "button" && !hasClass(n, "selected"));
  if (choice) {
    const name = choice.dataset.focusKey.slice("profile:".length);
    choice.click();
    await ui.openFile(fakeFile);
    const kept = ui.current().profile;
    check(kept === name, "reopening the same save goes back to the profile picked in it", `${kept}, picked ${name}`);
    if (file.endsWith(".json")) {
      const changed = new Uint8Array(bytes.length + 1);
      changed.set(bytes);
      changed[bytes.length] = 0x20;
      await ui.openFile({ name: fakeFile.name, arrayBuffer: async () => changed.buffer });
      check(byId.get("error").hidden && ui.current().profile === profile,
            "a changed save opens on the profile the game had selected, not the one picked before",
            `${ui.current().profile}, game's ${profile}`);
    }
  }
}

// Starting again reads back what was remembered: debug mode and the dormant setting.
stored.set("blueprince-viewer:debug", "true");
stored.set("blueprince-viewer:dormantMode", "\"only\"");
await ui.start();
{
  const select = all("debug-tools").find((n) => hasClass(n, "dormant-mode"));
  const selected = select?.children.find((o) => o.selected)?.value;
  check(!byId.get("debug-mark").hidden && selected === "only",
        "a fresh start reads debug mode and the dormant setting back from this browser", selected);
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
