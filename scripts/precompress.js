// Writes .br and .gz copies of the storefront's fingerprinted JS/CSS/WASM after `vite build`, so the
// server can send compressed bytes without compressing on every request (see server.js).
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'vishrea-react', 'dist', 'assets');
if (!fs.existsSync(dir)) {
  console.error(`[precompress] ${dir} not found; run the client build first`);
  process.exit(1);
}

let raw = 0;
let br = 0;
for (const name of fs.readdirSync(dir).filter((f) => /\.(js|css|wasm)$/.test(f))) {
  const file = path.join(dir, name);
  const buf = fs.readFileSync(file);
  // The face-detection runtime is ~14 MB; quality 9 keeps the build quick at almost the same size.
  const quality = buf.length > 4 * 1024 * 1024 ? 9 : 11;
  const b = zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: quality, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } });
  fs.writeFileSync(`${file}.br`, b);
  fs.writeFileSync(`${file}.gz`, zlib.gzipSync(buf, { level: 9 }));
  raw += buf.length;
  br += b.length;
}
console.log(`[precompress] ${Math.round(raw / 1024)} KB of JS/CSS/WASM → ${Math.round(br / 1024)} KB brotli`);
