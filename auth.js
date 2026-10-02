'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);
const passwordHash = process.env.ACCESS_PASSWORD_HASH || '';
const sessionSecret = process.env.ACCESS_SESSION_SECRET || '';
const configured = /^[a-f0-9]{32}:[a-f0-9]{128}$/.test(passwordHash) && sessionSecret.length >= 32;
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const COOKIE = 'cloudsearch_session';
const failures = new Map();
const version = crypto.createHash('sha256').update(passwordHash).digest('hex').slice(0, 16);

function secure(req) {
  return Boolean(process.env.VERCEL || req.socket?.encrypted);
}

function cookie(req, value, maxAge) {
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure(req) ? '; Secure' : ''}`;
}

function sign(payload) {
  return crypto.createHmac('sha256', sessionSecret).update(payload).digest('base64url');
}

function sessionValid(req) {
  const value = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
  if (!value || value.length > 512) return false;
  const parts = value.split('.');
  if (parts.length !== 2) return false;
  const expected = Buffer.from(sign(parts[0]));
  const signature = Buffer.from(parts[1]);
  if (signature.length !== expected.length || !crypto.timingSafeEqual(signature, expected)) return false;
  try {
    const data = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    const now = Math.floor(Date.now() / 1000);
    return data.v === version && Number.isInteger(data.exp) && data.exp > now && data.exp <= now + SESSION_SECONDS;
  } catch { return false; }
}

function sameOrigin(req) {
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  const origin = req.headers.origin;
  if (!origin) return true; // Non-browser clients do not send Origin.
  return origin === `${secure(req) ? 'https' : 'http'}://${req.headers.host}`;
}

function redirect(res, location) {
  res.writeHead(303, { Location: location }).end();
}

// This per-instance limiter reduces repeated guesses; it is not a global WAF limit.
function clientKey(req) {
  return process.env.VERCEL ? (req.headers['x-vercel-forwarded-for'] || req.socket?.remoteAddress || 'unknown') : (req.socket?.remoteAddress || 'unknown');
}

module.exports = async function authGate(req, res, pathname, readBody, sendJson) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  if (!configured) {
    sendJson(res, 503, { code: 503, message: '访问密码尚未配置，请联系管理员。' });
    return true;
  }

  if (pathname === '/api/auth/login' || pathname === '/api/auth/logout') {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      sendJson(res, 405, { code: 405, message: '请使用 POST 请求。' });
      return true;
    }
    if (!sameOrigin(req)) {
      sendJson(res, 403, { code: 403, message: '请求来源不允许。' });
      return true;
    }
    if (pathname === '/api/auth/logout') {
      res.setHeader('Set-Cookie', cookie(req, '', 0));
      sendJson(res, 200, { code: 0 });
      return true;
    }
    if (!(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
      sendJson(res, 415, { code: 415, message: '请使用 JSON 请求。' });
      return true;
    }
    const now = Date.now();
    for (const [key, item] of failures) if (item.until <= now) failures.delete(key);
    const key = clientKey(req);
    const item = failures.get(key);
    if (item && item.count >= 5) {
      res.setHeader('Retry-After', String(Math.ceil((item.until - now) / 1000)));
      sendJson(res, 429, { code: 429, message: '密码错误次数过多，请稍后再试。' });
      return true;
    }
    const body = await readBody(req);
    const password = typeof body?.password === 'string' ? body.password : '';
    const [salt, digest] = passwordHash.split(':');
    const candidate = password.length <= 1024 ? await scrypt(password, salt, 64) : Buffer.alloc(64);
    if (!password || !crypto.timingSafeEqual(candidate, Buffer.from(digest, 'hex'))) {
      if (failures.size >= 10000) failures.delete(failures.keys().next().value);
      failures.set(key, { count: (item?.count || 0) + 1, until: item?.until || now + 60000 });
      sendJson(res, 401, { code: 401, message: '密码不正确，请重试。' });
      return true;
    }
    failures.delete(key);
    const payload = Buffer.from(JSON.stringify({ exp: Math.floor(now / 1000) + SESSION_SECONDS, v: version, nonce: crypto.randomBytes(16).toString('hex') })).toString('base64url');
    res.setHeader('Set-Cookie', cookie(req, `${payload}.${sign(payload)}`, SESSION_SECONDS));
    sendJson(res, 200, { code: 0 });
    return true;
  }

  const authenticated = sessionValid(req);
  if (pathname === '/login') {
    if (authenticated) redirect(res, '/');
    else {
      res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(path.join(__dirname, 'auth', 'login.html')));
    }
    return true;
  }
  if (!authenticated) {
    if (pathname.startsWith('/api/')) sendJson(res, 401, { code: 401, message: '请先输入访问密码。' });
    else redirect(res, '/login');
    return true;
  }
  return false;
};
