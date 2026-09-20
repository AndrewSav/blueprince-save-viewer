// Easy Save 3 files, as Blue Prince writes them: decryption and the quasi-JSON parser.
//
// Runs unchanged in a browser and in Node, because both have `crypto.subtle`. That is
// deliberate: it lets the pipeline be tested headlessly against a real save instead of
// only in a page.

const IV_SIZE = 16;
const KEY_SIZE = 16;
const PBKDF2_ITERATIONS = 100;

/** Does this look like a decrypted save rather than an encrypted one?
 *
 * An encrypted file starts with a random IV byte, so the first non-space character being
 * `{` is a reliable separator and does not depend on the file's name.
 */
export function looksDecrypted(bytes) {
  let i = 0;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3; // BOM
  while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0d || bytes[i] === 0x0a)) i++;
  return bytes[i] === 0x7b; // '{'
}

/** Decrypt an .es3: [16-byte IV][AES-128-CBC, PKCS7], key = PBKDF2-HMAC-SHA1(password, IV, 100). */
export async function decrypt(bytes, password) {
  if (bytes.length < IV_SIZE + 16 || (bytes.length - IV_SIZE) % 16 !== 0) {
    throw new Error("Not an encrypted ES3 file: its length is not an IV plus whole AES blocks.");
  }
  const iv = bytes.slice(0, IV_SIZE);
  const material = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  // ES3 salts with the IV itself and derives a 128-bit key.
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: iv, iterations: PBKDF2_ITERATIONS, hash: "SHA-1" },
    material, KEY_SIZE * 8);
  const key = await crypto.subtle.importKey("raw", bits, "AES-CBC", false, ["decrypt"]);
  let plain;
  try {
    plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-CBC", iv }, key, bytes.slice(IV_SIZE)));
  } catch {
    throw new Error("Decryption failed. The password is wrong, or this is not an encrypted ES3 file.");
  }
  if (plain[0] === 0x1f && plain[1] === 0x8b) {
    throw new Error("The decrypted data is gzip-compressed; this reader does not handle compressed ES3 files.");
  }
  return plain;
}

// ---------------------------------------------------------------- the quasi-JSON parser

// A decrypted save is Easy Save's own output and is NOT valid JSON. A primitive reads
//     "__type" : "System.Int32"42
// with the value jammed straight after the closing quote of the type and no separator,
// while UnityEngine.Vector3 and ES3PlayMaker.PMDataWrapper do carry a comma before their
// fields.

const TYPES = {
  "System.Int32": "Int32",
  "System.Single": "Single",
  "System.Boolean": "Boolean",
  "System.String": "String",
  "UnityEngine.Vector3": "Vector3",
};

class Parser {
  constructor(text) {
    this.s = text;
    this.i = 0;
  }

  error(path, message) {
    return new Error(`${path}: ${message} (at offset ${this.i})`);
  }

  ws() {
    while (this.i < this.s.length && " \t\r\n".includes(this.s[this.i])) this.i++;
  }

  expect(ch, path) {
    this.ws();
    if (this.s[this.i] !== ch) throw this.error(path, `expected '${ch}', found '${this.s[this.i] ?? "end of file"}'`);
    this.i++;
  }

  jsonString(path) {
    this.ws();
    const start = this.i;
    this.expect('"', path);
    for (;;) {
      if (this.i >= this.s.length) throw this.error(path, "unterminated string");
      const c = this.s[this.i++];
      if (c === "\\") { this.i++; continue; }
      if (c === '"') break;
    }
    const raw = this.s.slice(start, this.i);
    try {
      return JSON.parse(raw);
    } catch {
      throw this.error(path, "bad string literal");
    }
  }

  /** The raw text of a scalar, which may be a JSON string or a bare token. */
  scalarToken(path) {
    this.ws();
    const start = this.i;
    if (this.s[this.i] === '"') {
      this.jsonString(path);
      return this.s.slice(start, this.i);
    }
    while (this.i < this.s.length && !",}] \t\r\n".includes(this.s[this.i])) this.i++;
    if (this.i === start) throw this.error(path, "expected a value");
    return this.s.slice(start, this.i);
  }

  typeField(path) {
    this.ws();
    const key = this.jsonString(path);
    if (key !== "__type") throw this.error(path, `expected "__type", found "${key}"`);
    this.expect(":", path);
    const type = this.jsonString(path);
    const bare = type.split(",")[0];
    if (!(bare in TYPES)) throw this.error(path, `unsupported type ${bare}`);
    return TYPES[bare];
  }

  typedScalar(path) {
    this.expect("{", path);
    const type = this.typeField(path);
    let value;
    if (type === "Vector3") {
      this.expect(",", path);
      const parts = {};
      for (const comp of ["x", "y", "z"]) {
        const got = this.jsonString(path);
        if (got !== comp) throw this.error(path, `expected Vector3 field '${comp}', found '${got}'`);
        this.expect(":", path);
        parts[comp] = this.scalarToken(`${path}.${comp}`);
        if (comp !== "z") this.expect(",", path);
      }
      value = [parts.x, parts.y, parts.z];
    } else {
      // The value sits straight after the closing quote of the type, no separator.
      value = this.scalarToken(path);
    }
    this.expect("}", path);
    return { type, value };
  }

  nullLiteral() {
    this.ws();
    if (this.s.startsWith("null", this.i)) { this.i += 4; return true; }
    return false;
  }

  slot(name) {
    this.expect("{", name);
    const type = (() => {
      this.ws();
      const key = this.jsonString(name);
      if (key !== "__type") throw this.error(name, `expected "__type", found "${key}"`);
      this.expect(":", name);
      return this.jsonString(name).split(",")[0];
    })();
    if (type !== "ES3PlayMaker.PMDataWrapper") {
      throw this.error(name, `expected a PMDataWrapper slot, found ${type}`);
    }
    this.expect(",", name);
    const field = this.jsonString(name);
    if (field !== "value") throw this.error(name, `expected a 'value' field, found '${field}'`);
    this.expect(":", name);

    const objs = new Map();
    const arrays = new Map();
    this.expect("{", name);
    this.ws();
    while (this.s[this.i] !== "}") {
      const key = this.jsonString(name);
      this.expect(":", `${name}/${key}`);
      if (key === "objs") {
        if (!this.nullLiteral()) this.readObjs(name, objs);
      } else if (key === "arrays") {
        if (!this.nullLiteral()) this.readArrays(name, arrays);
      } else if (key === "obj" || key === "array") {
        if (!this.nullLiteral()) throw this.error(`${name}/${key}`, "expected null; this save has a shape the reader has not seen");
      } else {
        throw this.error(`${name}/${key}`, "unexpected field in a PMDataWrapper value");
      }
      this.ws();
      if (this.s[this.i] === ",") { this.i++; this.ws(); }
    }
    this.expect("}", name);
    this.expect("}", name);
    return { name, objs, arrays };
  }

  readObjs(slot, out) {
    this.expect("{", `${slot}/objs`);
    this.ws();
    while (this.s[this.i] !== "}") {
      const key = this.jsonString(`${slot}/objs`);
      this.expect(":", `${slot}/${key}`);
      out.set(key, this.typedScalar(`${slot}/${key}`));
      this.ws();
      if (this.s[this.i] === ",") { this.i++; this.ws(); }
    }
    this.expect("}", `${slot}/objs`);
  }

  readArrays(slot, out) {
    this.expect("{", `${slot}/arrays`);
    this.ws();
    while (this.s[this.i] !== "}") {
      const key = this.jsonString(`${slot}/arrays`);
      this.expect(":", `${slot}/arrays/${key}`);
      this.ws();
      this.expect("[", `${slot}/arrays/${key}`);
      const items = [];
      let type = null;
      this.ws();
      while (this.s[this.i] !== "]") {
        const item = this.typedScalar(`${slot}/arrays/${key}[${items.length}]`);
        if (type === null) type = item.type;
        else if (type !== item.type) {
          throw this.error(`${slot}/arrays/${key}[${items.length}]`,
            `element type ${item.type} differs from ${type}; mixed arrays are not supported`);
        }
        items.push(item.value);
        this.ws();
        if (this.s[this.i] === ",") { this.i++; this.ws(); continue; }
        break;
      }
      this.expect("]", `${slot}/arrays/${key}`);
      out.set(key, { type, items });
      this.ws();
      if (this.s[this.i] === ",") { this.i++; this.ws(); }
    }
    this.expect("}", `${slot}/arrays`);
  }
}

/** Parse a decrypted save into a Map of slot name -> {objs, arrays}. */
export function parse(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const p = new Parser(text);
  const slots = new Map();
  p.ws();
  p.expect("{", "<root>");
  p.ws();
  if (p.s[p.i] !== "}") {
    for (;;) {
      const name = p.jsonString("<root>");
      p.expect(":", name);
      slots.set(name, p.slot(name));
      p.ws();
      if (p.s[p.i] === ",") { p.i++; p.ws(); continue; }
      break;
    }
  }
  p.expect("}", "<root>");
  return slots;
}
