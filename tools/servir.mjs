// Servidor local só para testar o web app: node tools/servir.mjs  →  http://localhost:5173/?demo
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(fileURLToPath(new URL(".", import.meta.url)), "..", "web");
const tipos = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".webp": "image/webp", ".png": "image/png", ".webmanifest": "application/manifest+json" };

createServer(async (req, res) => {
  const caminho = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([\\/])+/, "");
  const arquivo = join(raiz, caminho || "index.html");
  if (!arquivo.startsWith(raiz)) { res.writeHead(403).end(); return; }
  try {
    const dados = await readFile(arquivo.endsWith("\\") || arquivo.endsWith("/") ? join(arquivo, "index.html") : arquivo);
    res.writeHead(200, { "content-type": tipos[extname(arquivo)] || "application/octet-stream", "cache-control": "no-store" }).end(dados);
  } catch {
    res.writeHead(404).end("não encontrado");
  }
}).listen(5173, () => console.log("Mural em http://localhost:5173/?demo"));
