import { createHash } from 'node:crypto';
import { mkdirSync, statSync, existsSync, appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const filename = path.join(root, '.cache', 'node-v24.19.0-linux-x64.tar.xz');
const url = 'https://nodejs.org/dist/v24.19.0/node-v24.19.0-linux-x64.tar.xz';
const expected = '14b342e71204f811bde6153be8e04b62aef63c236fef92b55f9c83154b409647';
mkdirSync(path.dirname(filename), { recursive: true });
const total = Number((await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(20000) })).headers.get('content-length'));
let position = existsSync(filename) ? statSync(filename).size : 0;
while (position < total) {
  const end = Math.min(position + 2 * 1024 * 1024 - 1, total - 1);
  let bytes;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(url, { headers: { Range: `bytes=${position}-${end}` }, signal: AbortSignal.timeout(25000) });
      if (response.status !== 206 || response.headers.get('content-range') !== `bytes ${position}-${end}/${total}`) throw new Error('Unexpected range response.');
      bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length !== end - position + 1) throw new Error('Incomplete chunk.');
      break;
    } catch (error) { if (attempt === 3) throw error; }
  }
  appendFileSync(filename, bytes); position += bytes.length;
  console.log(`${(position / total * 100).toFixed(1)}%`);
}
const actual = createHash('sha256').update(readFileSync(filename)).digest('hex');
if (actual !== expected) throw new Error(`SHA256 mismatch: ${actual}. Remove the corrupted cache file and retry.`);
writeFileSync(path.join(root, '.cache', 'linux-runtime-verified.json'), JSON.stringify({ url, sha256: actual, size: total }, null, 2));
console.log('Linux runtime SHA256 verified: ' + actual);
