// The data that lets the viewer explain a save rather than print it.
//
// Everything here is committed in data/. Each file carries the game_version it describes,
// because the meanings are only valid for that build: enum values, list positions and field
// layouts all move between patches, and the failure mode is silent.

const FILES = {
  fields: "data/fields-schema.json",
  floorplans: "data/floorplans.json",
  runstats: "data/runstats-schema.json",
};

export async function loadDictionary() {
  const out = {};
  for (const [key, path] of Object.entries(FILES)) {
    const res = await fetch(path);
    if (!res.ok) {
      throw new Error(`Could not load ${path} (${res.status}). It is committed with the viewer, so this ` +
                      `checkout or the server is missing it.`);
    }
    out[key] = await res.json();
  }

  const byContainer = new Map();
  for (const f of out.fields.fields) {
    if (!byContainer.has(f.container)) byContainer.set(f.container, new Map());
    byContainer.get(f.container).set(f.name, f);
  }

  // The files belong together, so they are judged as one: their shared build, or none
  // when one carries no stamp or they disagree.
  const stamps = new Set(Object.values(out).map((v) => v.game_version ?? null));
  return {
    gameVersion: stamps.size === 1 ? [...stamps][0] : null,
    field: (container, name) => byContainer.get(container)?.get(name) ?? null,
    fieldsFor: (container) => byContainer.get(container) ?? new Map(),
    confidenceLevels: out.fields.confidence_levels ?? {},
    deadReferences: out.fields.dead_references ?? [],
    floorplans: out.floorplans,
    runstats: out.runstats,
  };
}

/** Whether the save was written by the build the data describes. Only the same id on
 *  both sides is a match: a missing id cannot vouch for anything. */
export function buildMatches(dict, saveVersion) {
  return !!saveVersion && dict.gameVersion === saveVersion;
}

export function groupLabel(group) {
  if (!group) return "Ungrouped";
  return {
    "file": "File",
    "modes": "Modes",
    "sigil-allowance": "Sigil room allowance tokens",
    "draft-pool": "Room - Chamber of Mirrors",
    "glossary": "Terminal glossary",
    "records": "Mt Holly Records",
    "permanent-resources": "Permanent Resources",
    "doors": "Doors and vaults",
    "mora-jai": "Mora Jai box",
    "tomorrow": "Carried to tomorrow",
    "sleep": "Where the day ended",
    "yesterday": "Tomorrow rooms / items",
    "gas": "Gas flames",
    "computer": "Estate computer",
    "red-envelopes": "Red letters",
    "boiler": "Room - Boiler Room",
    "pump": "Room - Pump Room",
    "repellent": "Repellent",
    "time-lock": "Room - Shelter",
    "foundation": "Room - The Foundation",
    "gift-shop": "Room - Gift Shop",
    "bookshop": "Room - Bookshop",
    "gear-room": "Location - Gear Room",
    "microchips": "Microchips",
    "gallery": "Room - Gallery",
    "additions": "Permanent additions",
    "vases": "Room - Entrance Hall",
    "tomb": "Room - Tomb",
    "upgrades": "Room upgrades",
    "upgrade-discs": "Upgrade disks used",
    "floorplans-found": "Floorplans found",
    "drafting-studio": "Room - Drafting Studio",
    "sanctum-doors": "Location - Inner Sanctum",
    "sanctum-keys": "Sanctum keys used",
    "memo-trunks": "Reservoir memo trunks",
    "axe": "Axed rooms",
    "dare": "Dare mode",
    "basement": "Location - Basement",
    "crate-tunnel": "Location - Crate tunnel",
    "reservoir": "Location - Reservoir",
    "precipice": "Location - Precipice",
    "gemstone-cavern": "Location - Gemstone Cavern",
    "blackbridge-grotto": "Location - Blackbridge Grotto",
    "library": "Room - Library",
    "still-water": "Still Water",
    "shrine": "Room - Shrine",
    "chapel": "Room - Chapel",
    "coat-check": "Room - Coat Check",
    "rumpus-room": "Room - Rumpus Room",
    "laboratory": "Room - Laboratory",
    "observatory": "Room - Observatory",
    "treasure-trove": "Room - Treasure Trove",
    "cloister": "Room - Cloister",
    "classroom": "Room - Classroom",
    "outer-rooms": "Outer rooms",
    "run-progress": "Run progress",
    "first-time": "First time",
    "breakable-walls": "Breakable walls",
    "filing-cabinet-keys": "Filing cabinet keys",
    "digging": "Digging",
    "fountain": "Room - Secret Garden",
    "planetarium": "Room - Planetarium",
    "parlor": "Room - Parlor",
    "trophies": "Trophies",
    "trophy-awards": "Trophies - awards",
    "trophy-days": "Trophies - days",
    "trophy-pickups": "Trophies - pickups",
    "trophy-triggers": "Trophies - triggers",
    "scrapbook": "Mt Holly Scrapbook",
    "dead-end-contest": "Dead End Contest",
    "vault": "Room - Vault",
    "saving": "Loading and saving",
    "special-order": "Special orders",
  }[group] ?? group[0].toUpperCase() + group.slice(1);
}

/** An explanation may hang a note on a phrase, written `[[phrase|note]]`: on screen the phrase
 *  opens the note in the popup, so a detail that would clutter the sentence waits behind it. A
 *  save field's own name is written in backticks and shown as code. Returns the pieces in order,
 *  `{ text }`, `{ text, code: true }` or `{ text, note }`. */
const NOTED = /\[\[([^\]|]+)\|([^\]]+)\]\]/g;
const CODE = /`([^`]+)`/g;
export function explanationParts(text) {
  const parts = [];
  let at = 0;
  for (const m of (text ?? "").matchAll(NOTED)) {
    if (m.index > at) parts.push(...codeParts(text.slice(at, m.index)));
    parts.push({ text: m[1].replace(CODE, "$1"), note: m[2] });
    at = m.index + m[0].length;
  }
  if (at < (text ?? "").length) parts.push(...codeParts(text.slice(at)));
  return parts;
}

/** Plain text split at its backticked names: `{ text }` and `{ text, code: true }` in order. */
export function codeParts(text) {
  const parts = [];
  let at = 0;
  for (const m of (text ?? "").matchAll(CODE)) {
    if (m.index > at) parts.push({ text: text.slice(at, m.index) });
    parts.push({ text: m[1], code: true });
    at = m.index + m[0].length;
  }
  if (at < (text ?? "").length) parts.push({ text: text.slice(at) });
  return parts;
}

/** The explanation as plain text, for places a popup cannot open another: the phrases stay and
 *  their notes are dropped, or kept after them when `withNotes` (the filter searches both), and
 *  the backticks around field names go. */
export function plainExplanation(text, withNotes = false) {
  return (text ?? "").replace(NOTED, withNotes ? "$1 $2" : "$1").replace(CODE, "$1");
}

/** What a whole group has in common, said once beside the group rather than in every field. */
export function groupNote(group) {
  return {
    "glossary": "Entries of the Glossary, which any terminal offers once you have access to the network. " +
                "Each field here says whether one entry is revealed; until it is, the Glossary shows " +
                "question marks in its place.",
    "red-envelopes": "Every room you draft has two pictures in it, and across all 45 rooms of the house " +
                     "they make one puzzle. Solving it is the first step to the codes of the safes that " +
                     "hold the red letters. Each field's note says where that safe's own hint is.",
    "repellent": "Where Repellent comes from: the Entrance Hall, guaranteed every morning as long as the " +
                 "Foundation stays in the outer-room slot; the extra item of a Bedroom, a Spare Bedroom or any " +
                 "of its upgrades drafted from the Cloister of Mila; the Lost & Found; and the Trading Post. " +
                 "One you already had can also come back from the Coat Check or with the Moon Pendant. Only " +
                 "one appears a day - once one has, the others no longer give it - and when three rooms are " +
                 "already repelled at the start of a day, only the Entrance Hall still gives one. Using it " +
                 "always repels the room you are standing in, so a room repelled today can be repelled again " +
                 "with a second Repellent: it simply takes another slot too. With three rooms already " +
                 "repelled, a fourth replaces the room in the third slot, which comes back into the draft " +
                 "at once.",
    // The Axe's use button adds 1 to The Axe Uses and sends that number as an event: 1-3 pick
    // the slot, 4 and up have no transition and fall through to slot 3. A room's cost is set to
    // 0 when axed and again each morning for the three slots only.
    // The Trading Post never offers The Axe: it is in the tier-3 worth list (TRADE LISTS/TIER 3
    // DEFAULT, TradeManager.ItemTiers), not in any offer list (Selection Menu/TIER 1-5,
    // TradeTiers), so it can only be traded away.
    "axe": "The Axe removes a room's gem cost for good, and each use fills the next of these three " +
           "slots. The Armory stops offering The Axe once you have used three. If a fourth is used " +
           "all the same, it puts that room in the third slot: the first two stay as they are, and " +
           "the room that was third stays free only until the end of the day - from the next " +
           "morning you pay its gem cost again.",
    // The only readers of the other values: FoundationSet's `Foundation Set` (location, rotation),
    // reached only when its `Foundation Check` finds Foundation set that morning, and the room's
    // State 7 X (door tiles), only on its already-laid path. As the outer room, the room's State 1
    // stops before anything is recorded or Foundation is set.
    "foundation": "When the Foundation field is false at the start of a day, nothing reads where the " +
                  "Foundation stands or how it is turned that day. Drafting the Foundation as the outer " +
                  "room does not change the Foundation field; it sets outer foundation instead.",
    // Cabinet 1 and 3's `Duplicate Find - menu` FSMs (Cabinet 2 spawns a key, Cabinet 4 five
    // coins). Cabinet 1's rolls 23 and 24 both find the Cloister; its Spare Room and Cabinet 3's
    // Observatory have their own caps, said on those fields.
    "draft-pool": "Two of the four cabinets in the Chamber of Mirrors each offer one floorplan; the other " +
                  "two hold a key and 5 coins. Each picks at random from its own list. One chooses from " +
                  "the Aquarium, Attic, Billiard Room, Boudoir, Closet, Courtyard, Laboratory, Library, " +
                  "Nook, Observatory, Parlor, Passageway, Rotunda, Security, Storeroom and Wine Cellar. " +
                  "The other chooses from the Boudoir, Cloister, Conference Room, Den, Dining Room, " +
                  "Drawing Room, East Wing Hall, Gymnasium, Music Room, Pantry, Spare Room, Trophy Room, " +
                  "Veranda, West Wing Hall and Workshop, and picks the Cloister twice as often as the rest.",
    // The chess puzzle as the user plays it (2026-10-01); the panels opening matches CASTLE's and the
    // chess screen's FSMs (Chess Panel-* moved, CHESS PIECES offered).
    "precipice": "The chess room holds the Precipice's chess puzzle: a board in the shape of the house, five " +
                 "by nine with the Antechamber marked, and the six chess pieces. Certain rooms of the house " +
                 "contain a chess piece, black or white, and any piece can turn up in several rooms. Draft a " +
                 "room with a chess piece, then place that piece - either colour - on the board where you " +
                 "drafted the room, and that tile lights up. With all six pieces on lit tiles the puzzle is " +
                 "solved: the panels behind the board open and you choose a chess power, the piece you become. " +
                 "Solving it lasts only the day, but the power you choose stays with you; to switch to " +
                 "another, solve the puzzle again on a later day. Only one power is active at a time. It " +
                 "shows in your inventory, where clicking it tells you what it does.",
    "planetarium": "Every planet is found the same way: with the Telescope item in your inventory, walk into " +
                   "a Planetarium and the lower-left prompt offers to use it. The sky then shows one planet " +
                   "you have not found yet, and " +
                   "pressing the interact key on it records it and shows what it gives. Each Planetarium " +
                   "you draft lets you look once. Which of Dauja, Fennmora, Mamora and Veia comes next is " +
                   "random: each look picks one of four orders by chance and shows the first planet in it " +
                   "you have not found. Mora always comes last, once the other four are found, and after " +
                   "all five the Telescope is no longer offered there.",
  }[group] ?? null;
}

/** What a naming family and a family outlier are, for every place the viewer says "family"
 *  or "outlier". */
export const FAMILY_NOTE =
  "A family is a rule in the data for sharing one explanation: fields whose names follow one " +
  "pattern (\"MJB - ...\", \"?...\", \"... Added\") are traced once, on one member (the exemplar), and " +
  "the others can inherit its text. A group is different: it is only the heading a field is listed " +
  "under, and decides nothing. Only members not traced on their own are compared - a traced field " +
  "has its own explanation, so the comparison could change nothing for it. An outlier is a member " +
  "whose writers and readers differ from the exemplar's: which FSMs touch the field, counted by the " +
  "FSM's name rather than where its object sits, with which action and in which direction, with the " +
  "member's own name blanked out and state names ignored. For the Glossary only the readers are " +
  "compared, since each term is set wherever you first meet it. An outlier does not inherit the " +
  "family's text; it is shown as not yet traced.";

/** How much to trust an explanation, and how to say so on screen. */
export function confidenceNote(field) {
  switch (field?.confidence) {
    case "traced":
      return null;
    case "family":
      return { tag: "by family", title: `Inherited from a naming family confirmed on ${field.family_probe}. ` +
               FAMILY_NOTE };
    case "name":
      return { tag: "unconfirmed", title: "Guessed from the field name alone; nothing was traced." };
    case "outlier":
      return { tag: "unconfirmed", title: "Named like a family whose meaning was confirmed, but not " +
               "written and read the way that family is, so its meaning is not assumed. " + FAMILY_NOTE };
    case "open":
      return { tag: "open", title: "Checked against the game data, but what it means is not settled: " +
               "the explanation says how far the evidence goes." };
    default:
      return { tag: "unknown", title: "No explanation has been established for this field." };
  }
}

/** Should this field be hidden when "hide dormant fields" is on? The data decides, per field,
 *  from the game's own files; what a save holds never decides it. */
export function isDormant(field) {
  return !!field?.dormant;
}

/** Hide this value when dormant fields are hidden? Yes at its default; and whatever it holds when
 *  nothing reads it, as the value is then dead weight. */
export function hideAsDormant(field, atDefault) {
  return isDormant(field) && (atDefault || !!field?.no_reader);
}

/** Does this save hold a value the viewer's model says the field cannot have? A dormant field
 *  that something reads should only ever be at its default: nothing writes it, writes only its
 *  starting value back, or has writers that can never change it. Shown, marked, rather than hidden,
 *  since the save and the model disagree. */
export function unexpectedValue(field, atDefault) {
  return isDormant(field) && !atDefault && !field?.no_reader;
}
