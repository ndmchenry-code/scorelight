// Local preview of www/ on http://localhost:PORT (localhost counts as secure, so mic, camera and offline work).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve("www"), port = Number(process.env.PORT) || 8770;
const types = { ".html":"text/html; charset=utf-8", ".js":"text/javascript", ".webmanifest":"application/manifest+json", ".png":"image/png" };
http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if(p.endsWith("/")) p += "index.html";
  const file = path.join(root, p);
  if(!file.startsWith(root) || !fs.existsSync(file)){ res.writeHead(404); return res.end("not found") }
  res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream", "Cache-Control":"no-cache" });
  fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log(`serving www/ at http://localhost:${port}`));
