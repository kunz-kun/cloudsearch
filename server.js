#!/usr/bin/env node
/**
 * 云搜 CloudSearch — 聚合网盘资源搜索
 * 零依赖 Node 服务：静态托管 + 多上游聚合代理（解决浏览器 CORS 限制）
 *
 * 用法：node server.js
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const CONFIG_PATH = path.join(ROOT, 'config.json');

const DEFAULT_CONFIG = {
  port: 8787,
  host: '127.0.0.1',
  cacheTTL: 300, // 秒，同一关键词结果缓存时长
  timeout: 45000, // 单个上游超时 ms
  retries: 1, // 失败重试次数
  upstreams: [{ name: 'PanSou 主站', base: 'https://pansou.app', enabled: true }],
};

function loadConfig() {
  let cfg = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const user = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      cfg = Object.assign(cfg, user);
    }
  } catch (e) {
    console.warn('[config] 读取 config.json 失败，使用默认配置：' + e.message);
  }
  if (!Array.isArray(cfg.upstreams) || cfg.upstreams.length === 0) {
    cfg.upstreams = DEFAULT_CONFIG.upstreams;
  }
  return cfg;
}

const CONFIG = loadConfig();
const UPSTREAMS = CONFIG.upstreams.filter((u) => u && u.base && u.enabled !== false);

// 环境变量优先于 config.json，便于容器化部署
// Docker 里必须监听 0.0.0.0，否则容器外访问不到
const PORT = Number(process.env.PORT) || CONFIG.port;
const HOST = process.env.HOST || CONFIG.host;

/* ------------------------------------------------------------------ *
 * 工具
 * ------------------------------------------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 1024 * 512) {
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

/** 归一化分享链接，用于跨源去重 */
function normalizeUrl(u) {
  if (!u) return '';
  try {
    const x = new URL(u);
    const host = x.hostname.replace(/^www\./, '').toLowerCase();
    let p = x.pathname.replace(/\/+$/, '');
    return host + p;
  } catch (e) {
    return String(u).trim().toLowerCase();
  }
}

function cleanNote(note) {
  if (!note) return '';
  return String(note)
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* ------------------------------------------------------------------ *
 * 上游请求
 * ------------------------------------------------------------------ */

async function callUpstream(up, payload) {
  const endpoint = up.base.replace(/\/+$/, '') + '/api/search';
  const t0 = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CONFIG.timeout);
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'CloudSearch/1.0 (+local)',
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    const ms = Date.now() - t0;
    if (!resp.ok) return { ok: false, name: up.name, ms, error: 'HTTP ' + resp.status };
    const text = await resp.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      return { ok: false, name: up.name, ms, error: '响应不是合法 JSON' };
    }
    if (json && json.code !== 0 && json.code !== undefined && json.code !== 200) {
      return { ok: false, name: up.name, ms, error: json.message || '上游返回错误码 ' + json.code };
    }
    return { ok: true, name: up.name, ms, json };
  } catch (e) {
    const ms = Date.now() - t0;
    const msg = e && e.name === 'AbortError' ? '请求超时' : (e && e.message) || '网络错误';
    return { ok: false, name: up.name, ms, error: msg };
  }
}

async function callUpstreamWithRetry(up, payload) {
  let last = null;
  for (let i = 0; i <= CONFIG.retries; i++) {
    last = await callUpstream(up, payload);
    if (last.ok) return last;
    if (i < CONFIG.retries) await sleep(500 * (i + 1));
  }
  return last;
}

/** 并发请求全部上游，合并结果 */
async function aggregateSearch(params) {
  const payload = {
    kw: params.kw,
    res: 'merged_by_type',
    src: params.src || 'all',
  };
  if (params.refresh) payload.refresh = true;
  if (params.plugins && params.plugins.length) payload.plugins = params.plugins;
  if (params.channels && params.channels.length) payload.channels = params.channels;

  const settled = await Promise.all(UPSTREAMS.map((up) => callUpstreamWithRetry(up, payload)));

  const byType = Object.create(null);
  const seen = new Set();
  const sources = [];
  let total = 0;
  let rawCount = 0;
  let anyOk = false;

  for (const r of settled) {
    sources.push({
      name: r.name,
      ok: !!r.ok,
      ms: r.ms || 0,
      error: r.ok ? null : r.error,
      count: 0,
    });
    if (!r.ok) continue;
    anyOk = true;
    const data = (r.json && r.json.data) || {};
    total += Number(data.total) || 0;
    const mbt = data.merged_by_type || {};
    for (const type of Object.keys(mbt)) {
      const items = mbt[type];
      if (!Array.isArray(items)) continue;
      for (const it of items) {
        if (!it || !it.url) continue;
        rawCount++;
        const key = type + '|' + normalizeUrl(it.url);
        if (seen.has(key)) continue;
        seen.add(key);
        const entry = {
          url: it.url,
          password: it.password || '',
          note: cleanNote(it.note || it.title || ''),
          datetime: it.datetime || '',
          type,
          source: it.source || r.name,
        };
        if (Array.isArray(it.images) && it.images.length) entry.images = it.images.slice(0, 3);
        if (!byType[type]) byType[type] = [];
        byType[type].push(entry);
        sources[sources.length - 1].count++;
      }
    }
  }

  // 每个类型内按时间倒序（无时间的排后面），保持稳定
  for (const type of Object.keys(byType)) {
    byType[type].sort((a, b) => {
      const ta = a.datetime ? Date.parse(a.datetime) || 0 : 0;
      const tb = b.datetime ? Date.parse(b.datetime) || 0 : 0;
      return tb - ta;
    });
  }

  const deduped = seen.size;
  return {
    ok: anyOk,
    data: {
      total,
      deduped,
      raw_count: rawCount,
      merged_by_type: byType,
      sources,
    },
  };
}

/* ------------------------------------------------------------------ *
 * 缓存
 * ------------------------------------------------------------------ */

const cache = new Map(); // key -> { t, payload }

function cacheKey(params) {
  return JSON.stringify({
    kw: params.kw,
    src: params.src || 'all',
    plugins: (params.plugins || []).slice().sort(),
    channels: (params.channels || []).slice().sort(),
  });
}

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.t > CONFIG.cacheTTL * 1000) {
    cache.delete(key);
    return null;
  }
  return hit.payload;
}

function cacheSet(key, payload) {
  cache.set(key, { t: Date.now(), payload });
  if (cache.size > 200) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].t - b[1].t).slice(0, 50);
    for (const [k] of oldest) cache.delete(k);
  }
}

/* ------------------------------------------------------------------ *
 * 路由处理
 * ------------------------------------------------------------------ */

async function handleSearch(req, res, query) {
  const body = req.method === 'POST' ? await readBody(req) : {};
  const kw = String(body.kw || query.get('kw') || '').trim();
  if (!kw) return sendJson(res, 400, { code: 400, message: '缺少搜索关键词 kw' });

  const params = {
    kw,
    src: body.src || query.get('src') || 'all',
    refresh: body.refresh === true || query.get('refresh') === 'true',
    plugins: toArray(body.plugins || query.get('plugins')),
    channels: toArray(body.channels || query.get('channels')),
  };

  const key = cacheKey(params);
  if (!params.refresh) {
    const cached = cacheGet(key);
    if (cached) {
      return sendJson(res, 200, {
        code: 0,
        message: 'success',
        cached: true,
        elapsed: 0,
        data: cached,
      });
    }
  }

  const t0 = Date.now();
  const result = await aggregateSearch(params);
  const elapsed = Date.now() - t0;

  if (!result.ok) {
    const errors = result.data.sources.map((s) => s.name + ': ' + s.error).join('；');
    return sendJson(res, 502, {
      code: 502,
      message: '全部搜索源均不可用。' + (errors || '请检查网络或稍后重试。'),
      data: result.data,
    });
  }

  cacheSet(key, result.data);
  sendJson(res, 200, { code: 0, message: 'success', cached: false, elapsed, data: result.data });
}

async function handleHealth(res) {
  const results = await Promise.all(
    UPSTREAMS.map(async (up) => {
      const t0 = Date.now();
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 12000);
        const r = await fetch(up.base.replace(/\/+$/, '') + '/api/health', {
          signal: ctrl.signal,
          headers: { Accept: 'application/json', 'User-Agent': 'CloudSearch/1.0 (+local)' },
        });
        clearTimeout(timer);
        if (!r.ok) return { name: up.name, base: up.base, ok: false, ms: Date.now() - t0, error: 'HTTP ' + r.status };
        const j = await r.json();
        // 不同上游的 health 字段略有差异：有的给 status，有的只给 plugins/channels
        const healthy = j.status === 'ok' || j.status === undefined || (j.plugins || j.channels);
        return {
          name: up.name,
          base: up.base,
          ok: !!healthy,
          ms: Date.now() - t0,
          plugins: j.plugins || [],
          channels: j.channels || [],
          plugin_count: j.plugin_count || (j.plugins || []).length,
        };
      } catch (e) {
        return { name: up.name, base: up.base, ok: false, ms: Date.now() - t0, error: (e && e.message) || '网络错误' };
      }
    })
  );

  const plugins = new Set();
  const channels = new Set();
  for (const r of results) {
    (r.plugins || []).forEach((p) => plugins.add(p));
    (r.channels || []).forEach((c) => channels.add(c));
  }

  sendJson(res, 200, {
    code: 0,
    status: results.some((r) => r.ok) ? 'ok' : 'down',
    upstreams: results,
    plugins: [...plugins],
    channels: [...channels],
    updated: new Date().toISOString(),
  });
}

function toArray(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.filter(Boolean).map(String);
  return String(v)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/* ------------------------------------------------------------------ *
 * 静态文件
 * ------------------------------------------------------------------ */

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const target = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^([/\\])+/, ''));
  if (!target.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.stat(target, (err, stat) => {
    if (err || !stat.isFile()) {
      // SPA 回退
      const fallback = path.join(PUBLIC_DIR, 'index.html');
      fs.readFile(fallback, (e2, buf) => {
        if (e2) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 Not Found');
          return;
        }
        res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' }).end(buf);
      });
      return;
    }
    const ext = path.extname(target).toLowerCase();
    fs.readFile(target, (e3, buf) => {
      if (e3) {
        res.writeHead(500).end('Read error');
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Content-Length': buf.length,
        'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
      });
      res.end(buf);
    });
  });
}

/* ------------------------------------------------------------------ *
 * 启动
 * ------------------------------------------------------------------ */

const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const pathname = parsed.pathname;

  // 本地开发允许跨域（便于二次开发）
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }

  try {
    if (pathname === '/api/search') return void (await handleSearch(req, res, parsed.searchParams));
    if (pathname === '/api/health') return void (await handleHealth(res));
    if (pathname === '/api/config') {
      return sendJson(res, 200, {
        code: 0,
        app: '云搜 CloudSearch',
        upstreams: UPSTREAMS.map((u) => ({ name: u.name, base: u.base })),
        cacheTTL: CONFIG.cacheTTL,
        timeout: CONFIG.timeout,
      });
    }
    if (pathname.startsWith('/api/')) return sendJson(res, 404, { code: 404, message: '接口不存在' });
    return serveStatic(req, res, pathname);
  } catch (e) {
    console.error('[error]', e);
    if (!res.headersSent) sendJson(res, 500, { code: 500, message: '服务内部错误：' + e.message });
  }
});

function listen(port, attempt = 0) {
  // 端口由环境变量指定时（容器部署）不做顺延，否则端口映射会失效
  const allowFallback = !process.env.PORT;

  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && allowFallback && attempt < 10) {
      console.log('端口 ' + port + ' 被占用，尝试 ' + (port + 1) + ' ...');
      listen(port + 1, attempt + 1);
    } else {
      console.error('启动失败：' + err.message);
      process.exit(1);
    }
  });

  server.listen(port, HOST, () => {
    console.log('');
    console.log('  🌙 云搜 CloudSearch 已启动');
    console.log('  ➜  监听地址: ' + HOST + ':' + port);
    if (HOST === '0.0.0.0') {
      console.log('  ➜  容器/公网访问: http://<服务器IP>:' + port);
    } else {
      console.log('  ➜  本地访问: http://' + HOST + ':' + port);
    }
    console.log('  ➜  上游源:   ' + UPSTREAMS.map((u) => u.name + ' (' + u.base + ')').join(', '));
    console.log('  ➜  缓存:     ' + CONFIG.cacheTTL + 's   超时: ' + CONFIG.timeout + 'ms');
    console.log('');
  });
}

// 收到停止信号时优雅关闭（docker stop 会发 SIGTERM）
['SIGTERM', 'SIGINT'].forEach((sig) => {
  process.on(sig, () => {
    console.log('\n收到 ' + sig + '，正在关闭服务…');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
});

listen(PORT);
