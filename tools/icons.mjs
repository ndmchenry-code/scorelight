// Draws the app icon (an eighth note with a "hit" ring) into PNGs without any image library.
import fs from "node:fs";
import zlib from "node:zlib";

const BG = [0x1F, 0x6F, 0x8B], NOTE = [0xFF, 0xFF, 0xFF], RING = [0xF2, 0xB6, 0x40];

function crc32(buf){
  let c, crc = 0xFFFFFFFF;
  for(let n=0;n<buf.length;n++){ c = (crc ^ buf[n]) & 0xFF; for(let k=0;k<8;k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data){
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba){
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((size*4 + 1) * size);
  for(let y=0;y<size;y++){ raw[y*(size*4+1)] = 0; rgba.copy(raw, y*(size*4+1)+1, y*size*4, (y+1)*size*4) }
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

// Coverage tests in a 0..1 square.
const inHead = (x, y) => {
  const a = -20 * Math.PI/180, dx = x - 0.42, dy = y - 0.66;
  const u = dx*Math.cos(a) - dy*Math.sin(a), v = dx*Math.sin(a) + dy*Math.cos(a);
  return (u/0.13)**2 + (v/0.092)**2 <= 1;
};
const inStem = (x, y) => x >= 0.515 && x <= 0.552 && y >= 0.22 && y <= 0.64;
const flagEdge = (y, y0) => 0.533 + 0.16*Math.sin(Math.PI * Math.min(1, Math.max(0, (y - y0) / 0.30)) * 0.85);
const inFlag = (x, y) => y >= 0.22 && y <= 0.52 && x >= 0.533 && x <= flagEdge(y, 0.22) && (y < 0.29 || x >= flagEdge(y, 0.29));
const inRing = (x, y) => { const d = Math.hypot(x - 0.42, y - 0.66); return d >= 0.175 && d <= 0.2 };
const inRounded = (x, y, r) => {
  const cx = Math.min(Math.max(x, r), 1 - r), cy = Math.min(Math.max(y, r), 1 - r);
  return Math.hypot(x - cx, y - cy) <= r;
};

function render(size, { maskable }){
  const out = Buffer.alloc(size*size*4), SS = 4;
  for(let py=0;py<size;py++) for(let px=0;px<size;px++){
    let r=0,g=0,b=0,a=0;
    for(let sy=0;sy<SS;sy++) for(let sx=0;sx<SS;sx++){
      const x = (px + (sx+.5)/SS) / size, y = (py + (sy+.5)/SS) / size;
      if(!maskable && !inRounded(x, y, 0.22)) continue;
      // maskable icons keep the artwork inside the central safe zone
      const s = maskable ? 0.72 : 0.92, ux = (x - 0.5)/s + 0.5 + 0.02, uy = (y - 0.5)/s + 0.5 - 0.04;
      let c = BG;
      if(inRing(ux, uy)) c = RING;
      if(inHead(ux, uy) || inStem(ux, uy) || inFlag(ux, uy)) c = NOTE;
      r += c[0]; g += c[1]; b += c[2]; a += 255;
    }
    const n = SS*SS, i = (py*size + px)*4;
    if(a){ out[i] = r/(a/255); out[i+1] = g/(a/255); out[i+2] = b/(a/255) }
    out[i+3] = a/n;
  }
  return png(size, out);
}

const dir = process.argv[2];
fs.mkdirSync(dir, { recursive:true });
fs.writeFileSync(`${dir}/icon-192.png`, render(192, { maskable:false }));
fs.writeFileSync(`${dir}/icon-512.png`, render(512, { maskable:false }));
fs.writeFileSync(`${dir}/maskable-512.png`, render(512, { maskable:true }));
fs.writeFileSync(`${dir}/apple-touch-icon.png`, render(180, { maskable:true }));
console.log("icons written to", dir);
