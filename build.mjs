// Builds the installable app into www/ (upload that folder to any HTTPS static host).
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import * as esbuild from "esbuild";

const out = "www";
fs.rmSync(out, { recursive:true, force:true });
fs.mkdirSync(out, { recursive:true });

await esbuild.build({
  entryPoints: ["src/app.js"], bundle: true, format: "esm", minify: true,
  target: ["es2020", "safari15"], outfile: `${out}/app.js`, legalComments: "none", logLevel: "warning"
});
for(const f of ["index.html", "manifest.webmanifest"]) fs.copyFileSync(`src/${f}`, `${out}/${f}`);
fs.writeFileSync(`${out}/sw.js`, fs.readFileSync("src/sw.js", "utf8").replace("__VERSION__", Date.now().toString(36)));
execFileSync(process.execPath, ["tools/icons.mjs", `${out}/icons`], { stdio:"inherit" });
fs.writeFileSync(`${out}/.nojekyll`, "");
const kb = f => (fs.statSync(`${out}/${f}`).size / 1024).toFixed(0) + " KB";
console.log(`built ${out}/  app.js ${kb("app.js")}`);
