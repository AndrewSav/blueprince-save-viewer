// The save key: the password Easy Save 3 encrypts MtHollyBlueprint.es3 with, read out of the game.
//
// It is not secret from anyone who has the game - it ships in the `ES3Defaults` settings asset
// inside BLUE PRINCE_Data/resources.assets, which the game reads to open its own saves. So rather
// than carry it, the viewer reads it from a copy of that file the player supplies (or that
// make-config.mjs finds in the install). Written to run unchanged in the browser and in Node.
//
// After the asset's name come: location (int32), path (string), encryptionType (int32),
// compressionType (int32), encryptionPassword (string). A string is an int32 length, its UTF-8
// bytes, then padding to a 4-byte boundary. The name itself is such a string, so the four bytes
// before it hold its length.

const MARKER = new TextEncoder().encode("ES3Defaults");

/** The save key in `bytes` (a resources.assets), or an Error saying why it is not there. */
export function readSaveKey(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const at = findMarker(data, view);
  if (at < 0) {
    throw new Error("This file has no ES3Defaults settings in it, so it is not the game's resources.assets " +
                    "(it is in the game's install, under BLUE PRINCE_Data).");
  }
  const align4 = (n) => (n + 3) & ~3;
  let off = align4(at + MARKER.length);
  const int32 = () => {
    if (off + 4 > data.length) throw layout("it ends early");
    const v = view.getInt32(off, true);
    off += 4;
    return v;
  };
  const str = () => {
    const len = int32();
    if (len < 0 || off + len > data.length) throw layout("a string runs past the end");
    const v = new TextDecoder("utf-8").decode(data.subarray(off, off + len));
    off = align4(off + len);
    return v;
  };
  int32();                         // location
  str();                           // path
  const encryption = int32();
  const compression = int32();
  const key = str();
  if (encryption !== 1) throw layout(`its encryption type is ${encryption}, not 1 (AES)`);
  if (compression !== 0) throw layout(`its compression type is ${compression}, not 0 (none)`);
  if (!key.length) throw layout("its password is empty");
  return key;
}

const layout = (why) => new Error(`The ES3Defaults settings in this file are not laid out as expected: ${why}.`);

// The first "ES3Defaults" whose four preceding bytes are its length, as a serialized name has.
function findMarker(data, view) {
  const first = MARKER[0], last = data.length - MARKER.length;
  for (let i = data.indexOf(first, 4); i >= 0 && i <= last; i = data.indexOf(first, i + 1)) {
    let k = 1;
    while (k < MARKER.length && data[i + k] === MARKER[k]) k++;
    if (k === MARKER.length && view.getInt32(i - 4, true) === MARKER.length) return i;
  }
  return -1;
}
