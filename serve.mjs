// A static file server for local development, with no dependencies.
//
//   node serve.mjs [port]
//
// Any static file server will do; this exists so the page can be opened without installing
// one. Module scripts and fetch() need a real origin, so opening index.html from the
// filesystem will not work.

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.argv[2] ?? 8080);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path.endsWith("/")) path += "index.html";
  // Keep the server inside its own directory.
  const file = join(root, normalize(path).replace(/^(\.\.[/\\])+/, ""));
  if (!file.startsWith(root)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error("not a file");
    const body = await readFile(file);
    res.writeHead(200, {
      "Content-Type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
      "Content-Length": body.length,
      "Cache-Control": "no-store",
    }).end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" }).end(`Not found: ${path}`);
  }
}).listen(port, () => {
  console.log(`Serving ${root}`);
  console.log(`  http://localhost:${port}/`);
});
