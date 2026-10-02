'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const http = require('http');
const { spawnSync } = require('child_process');
const password = 'test-only-password';
const salt = crypto.randomBytes(16).toString('hex');
process.env.ACCESS_PASSWORD_HASH = salt + ':' + crypto.scryptSync(password, salt, 64).toString('hex');
process.env.ACCESS_SESSION_SECRET = crypto.randomBytes(32).toString('hex');
const handler = require('../server');

test('password gate protects files and API, validates sessions and logout', async () => {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (url, options = {}) => fetch(base + url, { redirect: 'manual', ...options });
  const login = (value, extra = {}) => request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', ...extra }, body: JSON.stringify({ password: value }) });
  try {
    for (const url of ['/', '/index.html', '/app.js', '/styles.css', '/anything', '/public/index.html']) {
      const r = await request(url);
      assert.equal(r.status, 303, url);
      assert.equal(r.headers.get('location'), '/login');
    }
    for (const url of ['/api/config', '/api/search', '/api/health', '/api/index']) assert.equal((await request(url)).status, 401, url);
    const page = await request('/login');
    assert.equal(page.status, 200);
    assert.match(await page.text(), /输入访问密码/);
    assert.equal((await login('wrong')).status, 401);
    assert.equal((await login(password, { Origin: 'https://attacker.example' })).status, 403);
    assert.equal((await request('/api/auth/login')).status, 405);
    const r = await login(password);
    assert.equal(r.status, 200);
    const setCookie = r.headers.get('set-cookie');
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Strict/);
    assert.match(setCookie, /Max-Age=604800/);
    const cookie = setCookie.split(';')[0];
    const headers = { Cookie: cookie };
    assert.equal((await request('/api/config', { headers })).status, 200);
    const home = await request('/', { headers });
    assert.match(await home.text(), /一个框，搜遍全网盘/);
    assert.match(home.headers.get('cache-control'), /no-store/);
    assert.equal(home.headers.get('access-control-allow-origin'), null);
    assert.equal((await request('/app.js', { headers })).status, 200);
    assert.equal((await request('/login', { headers })).headers.get('location'), '/');
    assert.equal((await request('/api/config', { headers: { Cookie: cookie + 'x' } })).status, 401);
    const signedCookie = data => { const payload = Buffer.from(JSON.stringify(data)).toString('base64url'); return 'cloudsearch_session=' + payload + '.' + crypto.createHmac('sha256', process.env.ACCESS_SESSION_SECRET).update(payload).digest('base64url'); };
    const version = crypto.createHash('sha256').update(process.env.ACCESS_PASSWORD_HASH).digest('hex').slice(0, 16);
    for (const data of [{ exp: 1, v: version }, { exp: Math.floor(Date.now()/1000)+60, v: 'old-password' }]) assert.equal((await request('/api/config', { headers: { Cookie: signedCookie(data) } })).status, 401);
    assert.equal((await request('/api/auth/logout', { method: 'POST', headers: { ...headers, Origin: 'https://attacker.example' } })).status, 403);
    const logout = await request('/api/auth/logout', { method: 'POST', headers });
    assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
    assert.equal((await request('/api/config')).status, 401);
    for (let i = 0; i < 5; i++) assert.equal((await login('wrong')).status, 401);
    const limited = await login(password);
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get('retry-after')) > 0);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('missing configuration fails closed', () => {
  const result = spawnSync(process.execPath, ['-e', `const gate=require('./auth'); gate({headers:{}},{setHeader(){}},'/',()=>{},(_,status)=>{if(status!==503)process.exit(1)}).then(handled=>{if(!handled)process.exit(1)});`], { cwd: require('path').join(__dirname, '..'), env: { ...process.env, ACCESS_PASSWORD_HASH: '', ACCESS_SESSION_SECRET: '' } });
  assert.equal(result.status, 0);
});
