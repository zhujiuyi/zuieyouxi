import http from 'node:http';
import { readFileSync, existsSync, statSync, createReadStream, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { randomUUID } from 'node:crypto';
import { RoomStore } from './lib/rooms.mjs';
import { GameError } from './lib/engine.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
async function readBody(req) {
  let text = '', size = 0;
  for await (const part of req) { size += part.length; if (size > 16384) throw new GameError('请求过大。', 413); text += part; }
  try { return JSON.parse(text || '{}'); } catch { throw new GameError('请求不是有效 JSON。'); }
}
export function createGameServer(options = {}) {
  let fileConfig = {};
  try { fileConfig = JSON.parse(readFileSync(path.join(ROOT, 'config.json'), 'utf8').replace(/^\uFEFF/, '')); } catch (e) { if (e.code !== 'ENOENT') throw new Error(`config.json 无法解析：${e.message}`); }
  const config = { host: '0.0.0.0', port: 3000, maxRooms: 200, turnSeconds: 120, roomRetentionHours: 168, publicUrl: '', ...fileConfig, ...options };
  config.port = Number(process.env.PORT || config.port);
  config.host = process.env.HOST || config.host;
  if (!Number.isInteger(config.port) || config.port < 0 || config.port > 65535) throw new Error('port 必须为 1–65535。');
  if (!Number.isFinite(config.turnSeconds) || config.turnSeconds < 10 || config.turnSeconds > 3600) throw new Error('turnSeconds 必须为 10–3600 秒。');
  const store = new RoomStore(options.dataDir || path.join(ROOT, 'data'), config);
  const streams = new Set(), rateBuckets = new Map();
  const rateLimit = (key, limit) => {
    const now = Date.now(), previous = rateBuckets.get(key);
    const bucket = !previous || now > previous.until ? { count: 0, until: now + 60000 } : previous;
    bucket.count++; rateBuckets.set(key, bucket);
    if (bucket.count > limit) throw new GameError('操作过于频繁，请稍后重试。', 429);
  };
  const headers = res => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  };
  const server = http.createServer(async (req, res) => {
    headers(res);
    try {
      const url = new URL(req.url, 'http://local'), pathname = decodeURIComponent(url.pathname);
      const ip = req.socket.remoteAddress || 'unknown';
      if (pathname.startsWith('/api/')) {
        if (req.headers.origin) {
          let originHost;
          try { originHost = new URL(req.headers.origin).host; } catch { throw new GameError('请求来源不匹配。', 403); }
          const expectedHost = config.publicUrl ? new URL(config.publicUrl).host : req.headers.host;
          if (originHost !== expectedHost && originHost !== req.headers.host) throw new GameError('请求来源不匹配。', 403);
        }
        if (req.method === 'GET' && pathname === '/api/health') { json(res, 200, { ok: true, version: '1.0.7', rooms: store.rooms.size }); return; }
        if (req.method === 'GET' && pathname === '/api/config') { json(res, 200, { publicUrl: config.publicUrl, minPlayers: 3, maxPlayers: 5 }); return; }
        if (req.method === 'POST' && pathname === '/api/rooms') {
          rateLimit('create:' + ip, 15); const body = await readBody(req); json(res, 201, store.create(body.name, body.title)); return;
        }
        const match = pathname.match(/^\/api\/rooms\/(\d{6})(?:\/(join|events|actions))?$/);
        if (!match) throw new GameError('接口不存在。', 404);
        const [, id, action] = match;
        if (req.method === 'POST' && action === 'join') {
          rateLimit('join:' + ip, 40); const body = await readBody(req); json(res, 200, store.join(id, body.name)); return;
        }
        const token = req.headers.authorization?.replace(/^Bearer /, '');
        const who = store.authorize(id, token);
        if (req.method === 'GET' && !action) { json(res, 200, store.state(id, who)); return; }
        if (req.method === 'GET' && action === 'events') {
          rateLimit('events:' + ip, 120);
          if (streams.size >= 1500) throw new GameError('服务器连接已满，请稍后重试。', 503);
          if ([...streams].filter(s => s.playerId === who).length >= 5) throw new GameError('此座位打开的页面过多，请关闭部分页面。', 429);
          res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
          res.flushHeaders(); req.socket.setTimeout(0); req.socket.setNoDelay(true);
          const stream = { playerId: who, res }; streams.add(stream);
          const send = () => {
            if (res.destroyed || res.writableEnded) return;
            try {
              const state = store.state(id, who);
              if (!state.players.some(p => p.id === who)) { res.write('event: removed\ndata: {}\n\n'); res.end(); return; }
              if (res.writableLength > 1024 * 1024) { res.destroy(); return; }
              res.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
            } catch { res.write('event: removed\ndata: {}\n\n'); res.end(); }
          };
          send.playerId = who;
          const unsubscribe = store.subscribe(id, who, send);
          const heartbeat = setInterval(() => { if (!res.destroyed) res.write(': keepalive\n\n'); }, 15000);
          res.on('close', () => { clearInterval(heartbeat); streams.delete(stream); unsubscribe(); });
          return;
        }
        if (req.method === 'POST' && action === 'actions') {
          rateLimit('actions:' + who, 180);
          const body = await readBody(req); json(res, 200, store.action(id, who, body)); return;
        }
        throw new GameError('接口不存在。', 404);
      }
      if (!['GET', 'HEAD'].includes(req.method)) throw new GameError('请求方法不支持。', 405);
      let filename;
      if (pathname === '/shared/cards.mjs') filename = path.join(ROOT, 'lib', 'cards.mjs');
      else {
        const relative = pathname === '/' || /^\/room\/\d{6}\/?$/.test(pathname) ? 'index.html' : pathname.replace(/^\//, '');
        filename = path.resolve(ROOT, 'public', relative);
        if (!filename.startsWith(path.join(ROOT, 'public') + path.sep)) throw new GameError('文件不存在。', 404);
      }
      if (!existsSync(filename) || !statSync(filename).isFile()) throw new GameError('文件不存在。', 404);
      const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
      res.writeHead(200, { 'Content-Type': mime[path.extname(filename)] || 'application/octet-stream', 'Content-Length': statSync(filename).size, 'Cache-Control': /\.(html|js|mjs|css)$/.test(filename) ? 'no-cache' : 'public, max-age=86400' });
      if (req.method === 'HEAD') res.end(); else createReadStream(filename).pipe(res);
    } catch (error) {
      if (res.headersSent) { res.end(); return; }
      if (!(error instanceof GameError)) console.error(`[${randomUUID()}]`, error);
      json(res, error instanceof GameError ? error.status : 500, { error: error instanceof GameError ? error.message : '服务器暂时无法处理请求，请稍后重试。' });
    }
  });
  server.requestTimeout = 30000; server.headersTimeout = 15000; server.maxHeadersCount = 60;
  const timer = setInterval(() => {
    store.tick();
    for (const [key, bucket] of rateBuckets) if (Date.now() > bucket.until) rateBuckets.delete(key);
  }, 1000); timer.unref();
  const stop = async () => {
    clearInterval(timer);
    for (const { res } of streams) res.end();
    server.closeIdleConnections();
    await new Promise(resolve => server.close(resolve));
  };
  return { server, store, config, stop };
}
if (process.argv[1] && existsSync(process.argv[1]) && realpathSync(path.resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    const app = createGameServer();
    app.server.on('error', error => {
      console.error(error.code === 'EADDRINUSE' ? `端口 ${app.config.port} 已被占用，请修改 config.json 中的 port。` : error.message); process.exitCode = 1;
    });
    app.server.listen(app.config.port, app.config.host, () => {
      console.log('\n  赎罪之旅 · 多人联机桌游  v1.0.7\n');
      console.log(`  本机访问：http://localhost:${app.config.port}`);
      for (const interfaces of Object.values(networkInterfaces())) for (const net of interfaces || []) if (net.family === 'IPv4' && !net.internal) console.log(`  内网访问：http://${net.address}:${app.config.port}`);
      console.log(`  对外访问：http://服务器公网IP:${app.config.port}`);
      console.log('  请在服务器防火墙和云安全组放行上述 TCP 端口。\n  按 Ctrl+C 停止；房间自动保存，下次启动后可重连。\n');
      app.store.diagnostics.forEach(message => console.warn(message));
    });
    let stopping = false;
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { if (stopping) return; stopping = true; console.log('\n正在关闭服务器…'); await app.stop(); });
  } catch (error) { console.error('启动失败：' + error.message); process.exitCode = 1; }
}
