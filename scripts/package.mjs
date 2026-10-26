import { mkdirSync, existsSync, readFileSync, writeFileSync, copyFileSync, cpSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUTPUT = path.join(ROOT, '部署包'), CACHE = path.join(ROOT, '.cache');
const VERSION = 'v24.19.0', WINDOWS_EXPECTED = '3602f2bb1a10f2cbab4c36886218a33c1ab3db87290e73b033c46c77147d0237';
const LINUX_EXPECTED = '14b342e71204f811bde6153be8e04b62aef63c236fef92b55f9c83154b409647';
const sha = filename => createHash('sha256').update(readFileSync(filename)).digest('hex');
const linuxArchive = path.join(CACHE, `node-${VERSION}-linux-x64.tar.xz`);
if (sha(process.execPath) !== WINDOWS_EXPECTED) throw new Error(`请使用官方 Node.js ${VERSION} Windows x64 执行打包。`);
if (!existsSync(linuxArchive) || sha(linuxArchive) !== LINUX_EXPECTED) throw new Error('Linux 运行包尚未下载完成或 SHA256 不匹配。');
mkdirSync(OUTPUT, { recursive: true });
const prefix = `node-${VERSION}-linux-x64`;
execFileSync('tar', ['-xJf', linuxArchive, '-C', CACHE, `${prefix}/bin/node`, `${prefix}/LICENSE`]);
const python = process.env.GAME_PYTHON || 'py';
const archiveNames = [];
for (const platform of ['Windows', 'Linux']) {
  const name = `赎罪之旅-${platform}-x64`, destination = path.join(OUTPUT, name);
  const data = path.join(destination, 'data');
  if (existsSync(data) && readdirSync(data).length) throw new Error(`${data} 内有对局存档，拒绝覆盖正在使用的部署目录。`);
  mkdirSync(destination, { recursive: true });
  for (const folder of ['lib', 'public']) cpSync(path.join(ROOT, folder), path.join(destination, folder), { recursive: true });
  if (existsSync(path.join(ROOT, 'docs'))) cpSync(path.join(ROOT, 'docs'), path.join(destination, 'docs'), { recursive: true });
  for (const file of ['server.mjs', 'config.json', 'package.json']) copyFileSync(path.join(ROOT, file), path.join(destination, file));
  const instructions = path.join(ROOT, 'docs', '部署与使用说明.txt');
  if (existsSync(instructions)) copyFileSync(instructions, path.join(destination, '请先阅读.txt'));
  const runtime = path.join(destination, 'runtime'); mkdirSync(runtime, { recursive: true });
  copyFileSync(path.join(CACHE, prefix, 'LICENSE'), path.join(runtime, 'NODE-LICENSE.txt'));
  if (platform === 'Windows') {
    copyFileSync(process.execPath, path.join(runtime, 'node.exe'));
    for (const name of ['start.bat', '启动游戏.bat']) writeFileSync(path.join(destination, name), readFileSync(path.join(ROOT, name), 'utf8').replace(/\r?\n/g, '\r\n'));
  } else {
    copyFileSync(path.join(CACHE, prefix, 'bin', 'node'), path.join(runtime, 'node'));
    writeFileSync(path.join(destination, 'start.sh'), readFileSync(path.join(ROOT, 'start.sh'), 'utf8').replace(/\r\n/g, '\n'));
  }
  mkdirSync(data, { recursive: true });
  writeFileSync(path.join(destination, '版本信息.json'), JSON.stringify({ app: '赎罪之旅', version: '1.0.4', platform: platform + '-x64', node: VERSION, three: '0.186.1', runtimeSha256: sha(path.join(runtime, platform === 'Windows' ? 'node.exe' : 'node')), upstreamWindowsSha256: WINDOWS_EXPECTED, upstreamLinuxArchiveSha256: LINUX_EXPECTED, date: '2026-10-25', offlineStart: true }, null, 2));
  const files = [];
  const walk = directory => { for (const name of readdirSync(directory).sort()) { const file = path.join(directory, name); if (statSync(file).isDirectory()) walk(file); else if (name !== 'SHA256SUMS.txt') files.push(`${sha(file)}  ${path.relative(destination, file).split(path.sep).join('/')}`); } };
  walk(destination); writeFileSync(path.join(destination, 'SHA256SUMS.txt'), files.join('\n') + '\n');
  const archive = path.join(OUTPUT, name + (platform === 'Windows' ? '.zip' : '.tar.gz'));
  execFileSync(python, [path.join(ROOT, 'scripts', 'archive.py'), destination, archive], { stdio: 'inherit' });
  archiveNames.push(`${sha(archive)}  ${path.basename(archive)}`);
  console.log(`${name}: ${files.length} files, ${(statSync(archive).size / 1048576).toFixed(1)} MiB`);
}
writeFileSync(path.join(OUTPUT, '压缩包校验SHA256.txt'), archiveNames.join('\n') + '\n');
console.log('Deployment folders and archives are ready.');
