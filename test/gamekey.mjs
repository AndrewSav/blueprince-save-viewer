// The save key for the tests when neither the command line nor config.js gives one: read from the
// game's resources.assets, as make-config.mjs and the page do (app/es3key.js), in the install that
// BLUEPRINCE_GAME names. Null when it names none, or the file is not there.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { readSaveKey } from "../app/es3key.js";

export async function gameKey() {
  const dir = process.env.BLUEPRINCE_GAME;
  if (!dir) return null;
  try {
    return readSaveKey(await readFile(join(dir, "BLUE PRINCE_Data", "resources.assets")));
  } catch {
    return null;
  }
}
