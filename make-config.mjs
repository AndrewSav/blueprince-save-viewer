// Write a local config.js so encrypted saves open during development.
//
//   node make-config.mjs <the Blue Prince install folder>
//
// It reads the password out of the game install, exactly as the game itself does, and never
// stores it anywhere but the file it writes - which is git-ignored. A deployment can write the
// same file its own way; config.example.js shows its shape.
//
// The password lives in the `ES3Defaults` settings asset inside resources.assets; app/es3key.js
// reads it, the same code the page uses when a player gives it that file instead.

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readSaveKey } from "./app/es3key.js";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const gameDir = args.find((a) => !a.startsWith("--"));
if (!gameDir) {
  console.error("usage: node make-config.mjs <the Blue Prince install folder>");
  console.error("  the folder that holds BLUE PRINCE_Data (in Steam: Manage, then Browse local files)");
  process.exit(2);
}
const assets = join(gameDir, "BLUE PRINCE_Data", "resources.assets");

if (!existsSync(assets)) {
  console.error(`Not found: ${assets}`);
  console.error("Pass the install folder: the one that holds BLUE PRINCE_Data.");
  process.exit(1);
}

let password;
try {
  password = readSaveKey(await readFile(assets));
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

const out = join(here, "config.js");
await writeFile(out, `// Written by make-config.mjs for local development. Git-ignored: do not commit.
globalThis.BLUEPRINCE_CONFIG = { es3Password: ${JSON.stringify(password)} };
`, "utf8");

console.log(`Wrote ${out}`);
console.log(`  password read from ${assets}`);
console.log(`  ${password.length} characters; not printed here, and config.js is git-ignored`);
