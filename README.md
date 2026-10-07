# Blue Prince save viewer

Drop a Blue Prince save on the page and read what is in it. A save holds tens of thousands of values across its slots, each one a bare PlayMaker variable name with no explanation, so the point of this is to say what they mean rather than merely print them.

**Use it at <https://andrewsav.github.io/blueprince-save-viewer>.**

**Everything runs in the browser.** The file is read locally and never uploaded: whatever serves the page only serves static files, and the page sends nothing back. The whole pipeline is browser-native — `crypto.subtle` for AES-128-CBC and PBKDF2-HMAC-SHA1, `DecompressionStream("deflate-raw")` for the compressed statistics blob — so there is no build step and no dependencies.

## Running it

```
node make-config.mjs <install>  # optional: encrypted .es3 files open without asking for resources.assets
node serve.mjs                  # http://localhost:8080
```

A plain static server is needed because ES modules and `fetch` require a real origin; opening `index.html` from the filesystem will not work.

## The pages

The top of the page stays compact and the same everywhere: the title with the internal build id the explanations are for, a one-line privacy note, then what is common to the whole file - `SaveFileInfo` and `CurrentSave`, a line each - and a row of profile buttons. Under that, a navigation bar and the page:

| page | address | what it shows |
| --- | --- | --- |
| Fields | `#/fields/<group>` | the profile's fields, all of them (the default) or one group from a dropdown; the filter searches names and explanations within what is shown |
| Arrays | `#/arrays` | `TCount Contraptions` and the Laboratory experiment, decoded |
| Parlor | `#/parlor` | the four puzzle tiers in serving order: past, next, future |
| Rarity Shifts / Room Records | `#/rooms` | the two room tables, sortable, each in a section that starts open |
| History | `#/history/<n>` | one day of `History Data` at a time, the latest when no day is named: its estate name spelt out, each word saying what won it, the five facts, the fifteen counters and the house as a grid |
| Stats | `#/stats` | the run in the statistics log (`DATA`): the six rankings the game builds, worked out its way, then the room, Coat Check, reading-time and book totals as sortable tables |
| Daily Stats | `#/daily/<n>` | one day of the statistics log at a time, the latest when no day is named: its status and length, its day stats, its rooms, Coat Check items and reading times, and its timeline of events in order |

It is one page with the route after `#`, so the save stays in memory while you move between pages, and back, forward and bookmarks work. The save itself is never stored: a reload asks for it again and then opens the page the address names.

**The History page is there for the counters, and for why the house got its name.** It is named after the save's `History Data` and the game screen that shows the same days. That screen already shows each day's name, facts and map; it often does not show the full list of fifteen counters, and it lists what earned the name without saying which word each thing earned. Here the name is spelt out from its three codes, and each word opens its own popup: the check that won it, with that day's numbers ("12 dead ends; a house of more than 35 rooms needs at least 12"), or that it was named for the house's size. A History Data whose length is not exactly 70 x DAY is reported rather than drawn as if it were fine.

Explanations and notes open from **(i) badges** in a styled popup, on hover, keyboard focus or a tap - never a native tooltip. Confidence tags open the same popup.

## The data it explains saves with

The labels come from four files in `data/`:

| file | what it carries |
| --- | --- |
| `fields-schema.json` | every field in a save: label, explanation, group, confidence, dormant and inert flags, and for each array how to lay it out, with the game's own names for its codes - for `History Data`, the words behind the name codes and what wins each one |
| `floorplans.json` | map-slot index → floorplan and the name of its room, and where the history screen draws each slot, for the per-day house map |
| `runstats-schema.json` | the shape of the `RunStatsData` document inside the `DATA` array, its units, and the game's own names for room and item ids |
| `field-facts.json` | a fact sheet per field - every writer and reader, whether each can run, the value a new profile starts with - for the debug view; fetched only when asked for |

They are **committed here**, so a checkout of this repo runs on its own, and replaced as a set, all four from one game build.

Each file records the `game_version` it describes, and every save records the build that wrote it. The four belong together, so the viewer takes them as one build - none at all if one is unstamped or they disagree. It compares that with the save's and, unless the two are the same id, says so loudly above every page, because the failure mode is silent: field meanings move between builds, and a stale label looks perfectly plausible while being wrong. A build id missing on either side does not match. Nothing is hidden, as nothing says what moved between the two builds; the warning says the viewer needs updating to the save's build.

**That version is the game's internal build id** — PlayerSettings `bundleVersion`, such as `1.1.10.29`. It deliberately does not resemble the published patch number, and nothing in the game displays it; MelonLoader prints it at start-up when its console is enabled. So it never appears unexplained: the header's (i) says what it is, and the `SaveFileInfo` line says whether it matches the build that wrote the save you opened, which is the only thing the number is actually for.

## How it explains a save

**Every field's meaning has been traced** by reading the code that uses it. A field a later game build adds carries a tag until it is traced too, saying how much is known about it: *unknown*, *unconfirmed* (guessed from its name) or *by family* (taken from the fields its name matches).

**Dormant fields are not shown** — those nothing in the game writes or only ever sets back to its starting value, those whose writers can never change them, and those nothing reads. The data marks each of them `dormant`, from the game's own code. A field nothing reads is hidden whatever it holds: the value is dead weight. Any other dormant field should only ever hold its default, so when the loaded save holds something else the save and the viewer's model disagree: the value is shown whatever the toggle says, not muted, with its "dormant" tag and a "!" mark whose popup says that this save's value does not match the model. Going over them is a debugging job, so the toggle that shows them appears only in debug mode, which Ctrl-click (Cmd-click on a Mac) on the page title turns on or off; a "debug" mark by the title says it is on. The browser remembers debug mode, the toggle's setting and the fact-sheet switch (localStorage), and outside debug mode neither setting has any effect. The toggle sits in the middle of the privacy line at the top, because it changes the common block as well as the page, and says how many dormant values it hides there and on the page shown. Once shown, each is muted and, on the pages, carries a dashed "dormant" tag whose popup gives the reason; the file block's short CurrentSave line goes without the tags, where flipping the toggle shows at a glance which facts come and go, and only a value the model says it cannot hold carries the "!" mark there.

**Fact sheets, for checking a meaning.** Debug mode has a second switch beside it, "fact sheets". On, every field on the Fields page gets a folded line under it - how many writers and readers it has, how many of those can never run, and any check that flags it - which opens into the sheet: each writer and reader with its FSM, state, action and parameters and how the state is entered, which ones are dead (a state nothing reaches, or a demo-only branch) or only possibly switched on, the value a new profile starts with, the values each profile of the open save holds, and whether the game's C# names the field. They come from `field-facts.json`, several megabytes, so the page fetches it the first time the switch goes on - all but the values, which are read from the save being viewed. The sheets name FSMs and states as the game data does: they are evidence for whoever writes the meanings, not text for a player.

**The Stats page works out what the game does not save.** `DATA` holds the run totals; the rankings built from them - most drafted, best and worst draft rate, most gems and time spent, most coat-checked - are rebuilt by the game each time the Mt Holly Scrapbook is opened, so the page rebuilds them the same way (`app/rankings.js`, read from the game code: which rooms each leaves out, how it breaks ties, and that the worst draft rate is the tail of the best). Rooms that tie come out in the game's order too: the game sorts with .NET's `List.Sort`, which does not keep equal entries in the order they came in but is deterministic, and `app/listsort.js` is that algorithm, read from the game's binary and checked against .NET's own sort (`test/listsort.mjs`), run on the same list in the same order. Room and item ids are named from the lists the game itself names them from, so none is left as a number. Daily Stats has the log's record of one day - the figures the game noted for it, and a timeline naming every event with its time into the day and what it involved (the room drafted, the item coat-checked, the rarity set, or how long a document was open, and whether its timer was stopped or ran to the end of the day). Every time on both pages is converted by the unit `runstats-schema.json` records for its field. Changing a dropdown keeps it focused, so the arrow keys can walk through the choices.

**Arrays are decoded where the game says what their codes mean**, each on the page its kind belongs to. `RoomRecords` and `Rarity Shifts` are tables that sort by any column ("#" returns to the game's own order), and `Rarity Shifts` hides the rooms whose rarity was never changed until you untick the filter. The Workshop contraptions and the Laboratory experiment are shown by name. The Parlor's puzzle lists are grouped into past, next and future, each entry carrying what is written on the three boxes, and each list saying the `Parlor Score` range it is served in. A decoded value shows its raw code after it, muted. `History Data` has the History page, and `DATA` the Stats and Daily Stats pages.

**Parlor solutions are hidden until you ask.** Which box holds the gems is on the page but out of sight; one switch at the top of the Parlor page reveals every one, and the choice is remembered in that browser. The statements themselves are always readable, future puzzles included, so the page shows the order without answering it for you.

**Backup slots are not shown.** Every writer of a `…Backup` key sits behind a disconnected Blackbridge menu state, so they can no longer change and are frozen at whatever they held when that feature last worked.

## The password

Saves are AES-encrypted. The password is **not** in this repository. A deployment can supply it in a small `config.js` beside `index.html`, which the page picks up.

Without it the page asks the player for it instead. The password ships with the game, in the `ES3Defaults` settings asset inside `BLUE PRINCE_Data/resources.assets` (about 8 MB), so the note under the drop zone offers to read that file: chosen with its button or dropped on the drop zone, it is read in the browser (`app/es3key.js`), never uploaded, and the key is kept in localStorage - or for the visit only, where the browser keeps nothing - and can be forgotten from the same note. A save dropped before the key is read opens as soon as it is. A key from `config.js` always wins, and then the note is not shown. A save that is already decrypted opens with no key at all.

`config.js` is optional and git-ignored; `config.example.js` shows its shape, with the key left empty, which behaves as no config at all. For local development, `node make-config.mjs <the Blue Prince install folder>` writes `config.js` for you. It reads the password out of the same `ES3Defaults` settings asset with the same code, prints only its length, and writes it nowhere else.

Be clear-eyed about what this buys: a client-side app has to hand the password to the browser, so anyone who can reach a page served with a `config.js` can read the password out of it. The point is keeping it out of the repository, not keeping it secret from whoever uses the site.

## Layout

```
index.html        the page
app/es3.js        decryption and the Easy Save quasi-JSON parser
app/save.js       the model: slots, containers, the DATA blob, History Data
app/dictionary.js the data in data/, and how much to trust each explanation
app/ui.js         the shell and the router: header, common block, profiles, pages, field list
app/arrays.js     the array pages: tables, decoded codes, ordered lists
app/history.js    the History page: day picker, estate name and what won each word, facts, counters, the house grid
app/stats.js      the Stats and Daily Stats pages: ranking cards and run totals, one day of the log
app/rankings.js   the game's rankings, worked out as it does them
app/listsort.js   the game's List.Sort, so tied entries come out in the game's order
app/tip.js        (i) badges and the popup they open
app/facts.js      the debug fact sheets under each field, fetched on demand
app/es3key.js     reads the save key out of the game's resources.assets
app/style.css     the page's styles, light and dark
data/             what the viewer explains saves with, committed
serve.mjs         a dependency-free static server for development
package.json      npm scripts: serve, and test (the sort test, which needs no save)
config.example.js the shape of the optional, git-ignored config.js, with no key in it
.nojekyll         empty: GitHub Pages serves the files as they are, without running Jekyll
make-config.mjs   writes a local config.js by reading the password from the game
test/core.mjs     the reading pipeline, against a real save
test/render.mjs   the real ui.js driven against a real save, on a small DOM
test/gamekey.mjs  the save key for the tests, from the game install when config.js has none
test/listsort.mjs app/listsort.js against .NET's List.Sort (no save needed)
test/listsort-oracle.cs  writes test/listsort-cases.json with .NET's own sort
```

The modules under `app/` are written to run unchanged in Node as well as a browser - `ui.js` and the page modules on the tests' small stub DOM - which is what lets the tests exercise the real code against a real save instead of a stand-in.

## Tests

```
node test/core.mjs   <save.es3|save.es3.json> [password]
node test/render.mjs <save.es3|save.es3.json> [password]
node test/listsort.mjs
```

`core` runs the reading pipeline against a real save, and `render` drives the real `ui.js` page by page on a small stub DOM; each prints every check it makes. For an encrypted save both take the save key from the argument, else `config.js`, else the game's own resources.assets in the install the `BLUEPRINCE_GAME` environment variable names (`test/gamekey.mjs`).

`listsort` needs no save, and is what `npm test` runs. It puts the port of the game's sort through the lists in `test/listsort-cases.json` and must match what .NET's `List<T>.Sort` did with each: the same order, the same number of comparisons and the same pairs compared in the same sequence. The lists are mostly full of ties, plus a few built against the sort so that it falls back to heapsort, with and without ties there. The cases are committed; `dotnet run test/listsort-oracle.cs -- test/listsort-cases.json` rewrites them.

None of them replaces opening the page, but they catch what is tedious to find by eye.

## Parsing note

A decrypted save is Easy Save 3's own output and is **not valid JSON**. A primitive reads

```
"__type" : "System.Int32"42
```

with the value jammed straight after the closing quote of the type and no separator, while `UnityEngine.Vector3` and `ES3PlayMaker.PMDataWrapper` do carry a comma before their fields. `app/es3.js` follows these rules.
