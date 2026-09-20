// Info badges and the popup they open.
//
// One popup element (#tip in index.html) serves the whole page. Anything carrying `data-tip`
// opens it: an (i) badge made by `infoBadge`, or an element that is its own label, such as a
// confidence tag, marked by `withTip`. It opens on hover and on keyboard focus, a tap toggles
// it on touch screens, and Escape closes it. Native `title` tooltips are not used anywhere:
// they are small, slow to appear and cannot be styled.

import { explanationParts, codeParts } from "./dictionary.js";

const el =(tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

/** An (i) badge that shows `text` in the popup. `fieldName` is the save's own name for the
 *  thing, shown above the text where the page labels it as something friendlier. */
export function infoBadge(text, fieldName = null) {
  const b = el("span", "info", "i");
  b.tabIndex = 0;
  b.setAttribute("role", "button");
  b.setAttribute("aria-label", "More information");
  b.dataset.tip = text;
  if (fieldName) b.dataset.tipField = fieldName;
  return b;
}

/** Append an explanation to `node`, each phrase that carries a note (`[[phrase|note]]`, see
 *  dictionary.js) as a marked span that opens the note in the popup, and each backticked field
 *  name as code. Returns `node`. */
export function appendExplanation(node, text) {
  for (const p of explanationParts(text)) {
    node.append(p.note ? withTip(el("span", "noted", p.text), p.note) : p.code ? el("code", null, p.text) : p.text);
  }
  return node;
}

/** Append plain text with its backticked field names as code. Returns `node`. */
function appendWithCode(node, text) {
  for (const p of codeParts(text)) node.append(p.code ? el("code", null, p.text) : p.text);
  return node;
}

/** Let an existing element open the popup with `text`. */
export function withTip(node, text) {
  node.dataset.tip = text;
  node.classList.add("has-tip");
  node.tabIndex = 0;
  return node;
}

let openFor = null;

// A note this many lines long or longer - a field's values, one per line - is laid out in columns.
const LIST_LINES = 16;
const GAP = 8;

function show(target) {
  const tip = document.querySelector("#tip");
  if (!tip) return;
  const parts = [];
  if (target.dataset.tipField) {
    const line = el("p", "tip-field", "Field name: ");
    line.append(el("b", null, target.dataset.tipField));
    parts.push(line);
  }
  // A badge may carry only the field name, with no explanation to add.
  const lines = (target.dataset.tip ?? "").split("\n");
  const table = lines.some((l) => l.includes("\t"));
  const list = !table && lines.length >= LIST_LINES ? el("div", "tip-cols") : null;
  if (table) {
    parts.push(...tableParts(lines));
  } else if (list) {
    for (const l of lines) list.append(appendWithCode(el("div"), l));
    parts.push(list);
  } else if (target.dataset.tip) {
    parts.push(appendWithCode(el("p", "tip-text"), target.dataset.tip));
  }
  tip.replaceChildren(...parts);
  tip.classList.toggle("tip-list", !!list);
  // Measured at the window's left edge, so where it last stood does not narrow it
  tip.style.left = "0px";
  tip.style.top = "0px";
  tip.hidden = false;
  openFor = target;
  const r = target.getBoundingClientRect();
  if (list) fitColumns(tip, list, lines.length, r);
  // Below the target if it fits, otherwise above, and failing both as high as it goes - over
  // the target if need be, which is harmless as the popup takes no pointer events. Never off
  // either side of the window.
  const w = tip.offsetWidth, h = tip.offsetHeight, gap = GAP;
  const x = Math.max(gap, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - gap));
  const below = r.bottom + gap + h <= window.innerHeight;
  const y = below ? r.bottom + gap : Math.max(gap, r.top - gap - h);
  tip.style.left = `${x + window.scrollX}px`;
  tip.style.top = `${y + window.scrollY}px`;
}

/** A note can carry a small grid: lines with tabs in them are table rows, cells split at the
 *  tabs, the first row of a run its header; the lines around a run stay text. */
function tableParts(lines) {
  const out = [];
  let table = null, text = [];
  const flush = () => {
    if (text.length) out.push(appendWithCode(el("p", "tip-text"), text.join("\n")));
    text = [];
  };
  for (const line of lines) {
    if (!line.includes("\t")) {
      table = null;
      text.push(line);
      continue;
    }
    flush();
    if (!table) out.push(table = el("table", "tip-table"));
    const row = el("tr");
    for (const cell of line.split("\t")) row.append(appendWithCode(el(table.rows.length ? "td" : "th"), cell));
    table.append(row);
  }
  flush();
  return out;
}

/** A long list in one column runs off the screen, and the popup closes when the mouse leaves
 *  its target, so it cannot be scrolled. Give it as many columns as it takes to fit the height
 *  on the roomier side of the target (a target mid-window has about half the window either
 *  side); if that makes it wider than the window, fit the whole window's height instead. */
function fitColumns(tip, list, count, r) {
  const rows = (n) => { list.style.gridTemplateRows = `repeat(${n}, auto)`; };
  rows(count);
  const line = list.firstElementChild?.offsetHeight || 19;
  const chrome = tip.offsetHeight - list.offsetHeight;
  const side = Math.max(r.top, window.innerHeight - r.bottom) - 2 * GAP;
  for (const space of [side, window.innerHeight - 2 * GAP]) {
    const cols = Math.ceil(count / Math.max(1, Math.floor((space - chrome) / line)));
    rows(Math.ceil(count / cols));
    if (tip.offsetWidth <= window.innerWidth - 2 * GAP) return;
  }
}

function hide() {
  const tip = document.querySelector("#tip");
  if (tip) tip.hidden = true;
  openFor = null;
}

/** Wire the popup once for the whole document. */
export function wireTips() {
  const owner = (e) => e.target.closest?.("[data-tip]") ?? null;
  document.addEventListener("mouseover", (e) => { const t = owner(e); if (t && t !== openFor) show(t); });
  document.addEventListener("mouseout", (e) => {
    const t = owner(e);
    if (t && !t.contains(e.relatedTarget)) hide();
  });
  document.addEventListener("focusin", (e) => { const t = owner(e); if (t) show(t); });
  document.addEventListener("focusout", () => hide());
  // A tap on a touch screen arrives as a hover and then a click, so a click only ever opens -
  // toggling would close what the hover just opened. Tapping anywhere else closes it.
  document.addEventListener("click", (e) => {
    const t = owner(e);
    if (t) show(t);
    else hide();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });
  // Through globalThis, so the headless test (no window) can load the page code.
  globalThis.addEventListener?.("scroll", () => hide(), { passive: true });
}
