import { build } from "esbuild";
import { mkdir, rm, readFile, writeFile, copyFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
await rm("dist", { recursive: true, force: true });
await mkdir("dist/icons", { recursive: true });
await build({
  entryPoints: ["src/app.js"],
  bundle: true,
  outfile: "dist/app.js",
  format: "esm",
  target: ["safari16"],
  minify: true,
});
await copyFile("src/app.css", "dist/app.css");
await copyFile("../QuietReader/src/analytics.css", "dist/analytics.css");
await copyFile("index.html", "dist/index.html");
// Dependency-free PNG icons: cream open book on the reader's charcoal background.
function crc(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(name, bytes) {
  const n = Buffer.from(name),
    len = Buffer.alloc(4),
    checksum = Buffer.alloc(4);
  len.writeUInt32BE(bytes.length);
  checksum.writeUInt32BE(crc(Buffer.concat([n, bytes])));
  return Buffer.concat([len, n, bytes, checksum]);
}
function icon(size) {
  const bytes = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size,
        v = y / size;
      const page =
        ((u > 0.23 && u < 0.49) || (u > 0.51 && u < 0.77)) &&
        v > 0.27 &&
        v < 0.72;
      const line =
        page &&
        ((v > 0.38 && v < 0.4) ||
          (v > 0.47 && v < 0.49) ||
          (v > 0.56 && v < 0.58)) &&
        u > 0.28 &&
        u < 0.72;
      const color = page && !line ? [225, 222, 202] : [33, 33, 33],
        i = y * (size * 4 + 1) + 1 + x * 4;
      bytes.set([...color, 255], i);
    }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(bytes)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
for (const [name, size] of [
  ["icon-192", 192],
  ["icon-512", 512],
  ["apple-touch-icon", 180],
])
  await writeFile(`dist/icons/${name}.png`, icon(size));
await writeFile(
  "dist/manifest.webmanifest",
  JSON.stringify(
    {
      id: "./",
      name: "静读 · Quiet Reader",
      short_name: "静读",
      lang: "zh-CN",
      start_url: "./",
      scope: "./",
      display: "standalone",
      background_color: "#212121",
      theme_color: "#212121",
      icons: [
        {
          src: "./icons/icon-192.png",
          sizes: "192x192",
          type: "image/png",
          purpose: "any",
        },
        {
          src: "./icons/icon-512.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "any maskable",
        },
      ],
    },
    null,
    2,
  ),
);
const files = [
  "./",
  "./index.html",
  "./app.js",
  "./app.css",
  "./analytics.css",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
];
const version = createHash("sha256");
for (const f of files.slice(1))
  version.update(await readFile("dist/" + f.slice(2)));
await writeFile(
  "dist/sw.js",
  `const CACHE='quiet-reader-${version.digest("hex").slice(0, 16)}';const FILES=${JSON.stringify(files)};
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES.map(f=>new Request(f,{cache:'reload'}))))));
self.addEventListener('message',e=>{if(e.data==='SKIP_WAITING')self.skipWaiting()});
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('quiet-reader-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{const url=new URL(e.request.url);if(e.request.method!=='GET'||url.origin!==self.location.origin||!url.href.startsWith(self.registration.scope))return;e.respondWith(caches.open(CACHE).then(async cache=>{const cached=await cache.match(e.request,{ignoreSearch:true});if(cached)return cached;try{return await fetch(e.request)}catch(error){if(e.request.mode==='navigate')return cache.match('./index.html');throw error}}))});`,
);
console.log("Built dist: standalone PWA, no runtime dependencies.");
