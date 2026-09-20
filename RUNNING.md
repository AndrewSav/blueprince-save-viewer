# Running the viewer locally

Quick reference. The prose version is in `README.md`; this is the copy-and-paste.

## Start it

From the checkout:

```
node serve.mjs 8137
```

Then open <http://localhost:8137>. The port is optional and defaults to **8080**, so plain `node serve.mjs` serves <http://localhost:8080>. Any free port works; 8137 is just what this project has been using.

It runs in the foreground, printing the folder it serves and its address once at start-up and nothing per request. **Ctrl-C stops it.** There is nothing to install - no dependencies, no build step - and nothing is written to disk while it runs.

A static server is needed because ES modules and `fetch` require a real origin. Opening `index.html` from the filesystem does not work.

## From anywhere

```
node "<this checkout>/serve.mjs" 8137
```

`serve.mjs` serves the directory it lives in, not the current one, so the working directory does not matter.

## The data

The viewer reads its dictionaries from `data/`, which is committed with it: `fields-schema.json`, `floorplans.json`, `runstats-schema.json` and `field-facts.json`. If the page says one is missing, the checkout or the server is incomplete. They are replaced as a set, all four from one game build.

## Opening an encrypted save

A raw `MtHollyBlueprint.es3` is encrypted. With no key configured, the note under the drop zone offers to read it from the game's `BLUE PRINCE_Data/resources.assets`; the key is then kept in the browser. To skip that, put it in the config instead:

```
node make-config.mjs <install>  # writes config.js with the password; <install> holds BLUE PRINCE_Data
```

`config.js` is optional and git-ignored; `config.example.js` shows what goes in it (copy it to `config.js` and fill in the key, or let `make-config.mjs` write it). Without the key the page opens an already-decrypted `.es3.json` as it is, and asks for resources.assets for an encrypted one.

## Debug mode

Ctrl-click (Cmd-click on a Mac) on the page title turns debug mode, with its dormant-fields and fact-sheet switches, on or off; the browser remembers it.

## Port already in use

`serve.mjs` will exit with `EADDRINUSE`. Either pick another port or find the process and stop it:

```
# Windows
netstat -ano | findstr :8137
taskkill /PID <pid> /F

# Linux, macOS
lsof -i :8137
kill <pid>
```
