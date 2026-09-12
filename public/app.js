/* ============================================================
   云搜 CloudSearch — 前端交互
   ============================================================ */
(function () {
  'use strict';

  /* ---------------- 网盘类型字典 ---------------- */
  const NETDISK = {
    quark: { name: '夸克网盘', short: '夸克', color: '#4e6ef2' },
    aliyun: { name: '阿里云盘', short: '阿里', color: '#7c5cfc' },
    baidu: { name: '百度网盘', short: '百度', color: '#2a5cff' },
    uc: { name: 'UC 网盘', short: 'UC', color: '#ff7a00' },
    xunlei: { name: '迅雷云盘', short: '迅雷', color: '#2e7cff' },
    xunleiyun: { name: '迅雷云盘', short: '迅雷', color: '#2e7cff' },
    '123': { name: '123 云盘', short: '123', color: '#1e6fff' },
    '123pan': { name: '123 云盘', short: '123', color: '#1e6fff' },
    aliyundrive: { name: '阿里云盘', short: '阿里', color: '#7c5cfc' },
    guangya: { name: '光鸭云盘', short: '光鸭', color: '#ff5c8a' },
    lanzou: { name: '蓝奏云', short: '蓝奏', color: '#2196f3' },
    lanzouyun: { name: '蓝奏云', short: '蓝奏', color: '#2196f3' },
    terabox: { name: 'TeraBox', short: 'Tera', color: '#2d6cdf' },
    tianyi: { name: '天翼云盘', short: '天翼', color: '#e1251b' },
    cloud189: { name: '天翼云盘', short: '天翼', color: '#e1251b' },
    '189': { name: '天翼云盘', short: '天翼', color: '#e1251b' },
    mobile: { name: '移动云盘', short: '移动', color: '#0090d9' },
    '115': { name: '115 网盘', short: '115', color: '#2e9bff' },
    onedrive: { name: 'OneDrive', short: 'OD', color: '#0078d4' },
    googledrive: { name: 'Google Drive', short: 'GD', color: '#4285f4' },
    pikpak: { name: 'PikPak', short: 'PP', color: '#5b5b5b' },
    weiyun: { name: '腾讯微云', short: '微云', color: '#12b7f5' },
    caiyun: { name: '彩云网盘', short: '彩云', color: '#00b3e3' },
    '360': { name: '360 云盘', short: '360', color: '#2bb24c' },
    magnet: { name: '磁力链接', short: '磁力', color: '#5b6472' },
    ed2k: { name: '电驴链接', short: '电驴', color: '#7a8494' },
    others: { name: '其他来源', short: '其他', color: '#64748b' },
  };

  const FALLBACK_COLORS = ['#0ea5e9', '#14b8a6', '#8b5cf6', '#f97316', '#ec4899', '#22c55e', '#6366f1', '#eab308'];

  function diskInfo(type) {
    if (NETDISK[type]) return NETDISK[type];
    let h = 0;
    for (let i = 0; i < type.length; i++) h = (h * 31 + type.charCodeAt(i)) >>> 0;
    return {
      name: type,
      short: type.length <= 3 ? type : type.slice(0, 3),
      color: FALLBACK_COLORS[h % FALLBACK_COLORS.length],
    };
  }

  const HOT_WORDS = ['三体', '庆余年', '流浪地球', '老友记', '权力的游戏', 'Python 教程', 'PS 2024', '考研数学', '英语四级', '周杰伦'];

  const WALL_DISKS = ['quark', 'aliyun', 'baidu', 'xunlei', 'uc', '123', 'tianyi', '115', 'weiyun', 'magnet'];

  const PAGE_SIZE = 24;
  const H_KEY = 'cs_history';
  const T_KEY = 'cs_theme';

  /* 网盘展示优先级：越靠前越主流，用于组内链接排序 */
  const TYPE_ORDER = [
    'quark', 'aliyun', 'aliyundrive', 'baidu', 'uc', 'xunlei', 'xunleiyun',
    '123', '123pan', 'tianyi', 'cloud189', '189', 'mobile', '115', '115pan',
    'pikpak', 'weiyun', 'caiyun', 'guangya', 'lanzou', 'lanzouyun', 'terabox',
    'onedrive', 'googledrive', 'magnet', 'ed2k', 'others',
  ];
  const typeRank = (t) => {
    const i = TYPE_ORDER.indexOf(t);
    return i < 0 ? 99 : i;
  };

  /* ---------------- 状态 ---------------- */
  const state = {
    q: '',
    data: null, // {total, deduped, merged_by_type, sources}
    type: 'all',
    view: 'merged', // merged = 同一资源合并为一张卡；flat = 每条链接一张卡
    sort: 'time',
    shown: PAGE_SIZE,
    loading: false,
    elapsed: 0,
    cached: false,
    adv: { src: 'all', plugins: [], channels: [] },
    health: null,
  };

  /* ---------------- DOM ---------------- */
  const $ = (id) => document.getElementById(id);
  const els = {
    hero: $('hero'),
    form: $('searchForm'),
    input: $('q'),
    clearBtn: $('clearBtn'),
    searchBtn: $('searchBtn'),
    btnText: document.querySelector('.btn-text'),
    btnSpinner: document.querySelector('.btn-spinner'),
    hotChips: $('hotChips'),
    historyBlock: $('historyBlock'),
    historyChips: $('historyChips'),
    clearHistory: $('clearHistory'),
    diskWall: $('diskWall'),
    filterbar: $('filterbar'),
    typeTabs: $('typeTabs'),
    resultMeta: $('resultMeta'),
    sortSel: $('sortSel'),
    viewSeg: $('viewSeg'),
    refreshBtn: $('refreshBtn'),
    results: $('results'),
    loadMoreWrap: $('loadMoreWrap'),
    loadMore: $('loadMore'),
    stateBox: $('stateBox'),
    srcStatus: $('srcStatus'),
    srcStatusText: $('srcStatusText'),
    themeBtn: $('themeBtn'),
    advBtn: $('advBtn'),
    drawer: $('drawer'),
    drawerMask: $('drawerMask'),
    drawerClose: $('drawerClose'),
    srcSeg: $('srcSeg'),
    pluginPicker: $('pluginPicker'),
    pluginFilter: $('pluginFilter'),
    pluginCount: $('pluginCount'),
    channelPicker: $('channelPicker'),
    channelFilter: $('channelFilter'),
    channelCount: $('channelCount'),
    upstreamList: $('upstreamList'),
    resetAdv: $('resetAdv'),
    applyAdv: $('applyAdv'),
    toast: $('toast'),
    topbar: document.querySelector('.topbar'),
  };

  /* ---------------- 工具 ---------------- */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escRe(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /** 在已转义的文本中高亮关键词 */
  function highlight(escapedText, kw) {
    if (!kw) return escapedText;
    const terms = kw
      .split(/\s+/)
      .filter((t) => t.length > 0)
      .map(escRe)
      .sort((a, b) => b.length - a.length);
    if (!terms.length) return escapedText;
    try {
      return escapedText.replace(new RegExp('(' + terms.join('|') + ')', 'gi'), '<mark>$1</mark>');
    } catch (e) {
      return escapedText;
    }
  }

  function splitNote(note) {
    const raw = String(note || '').trim();
    if (!raw) return { title: '（无标题资源）', desc: '' };
    const lines = raw.split('\n').map((s) => s.trim()).filter(Boolean);
    if (lines.length <= 1) {
      const s = lines[0] || raw;
      return { title: s.length > 92 ? s.slice(0, 90) + '…' : s, desc: '' };
    }
    return { title: lines[0], desc: lines.slice(1).join('\n') };
  }

  function extractPwd(item) {
    if (item.password) return String(item.password).trim();
    const u = item.url || '';
    let m = u.match(/[?&]pwd=([A-Za-z0-9]+)/i);
    if (m) return m[1];
    m = u.match(/(?:提取码|密码|pwd|code)[:：=\s]*([A-Za-z0-9]{4,8})/i);
    if (m) return m[1];
    const n = item.note || '';
    m = n.match(/(?:提取码|密码)[:：\s]*([A-Za-z0-9]{4,8})/);
    return m ? m[1] : '';
  }

  function fmtTime(dt) {
    if (!dt) return '';
    const t = Date.parse(dt);
    if (!t || isNaN(t)) return '';
    const diff = Date.now() - t;
    const MIN = 60000, HOUR = 3600000, DAY = 86400000;
    if (diff < 0) return '刚刚';
    if (diff < HOUR) return Math.max(1, Math.floor(diff / MIN)) + ' 分钟前';
    if (diff < DAY) return Math.floor(diff / HOUR) + ' 小时前';
    if (diff < 30 * DAY) return Math.floor(diff / DAY) + ' 天前';
    if (diff < 365 * DAY) return Math.floor(diff / (30 * DAY)) + ' 个月前';
    return Math.floor(diff / (365 * DAY)) + ' 年前';
  }

  function fmtFull(dt) {
    if (!dt) return '';
    const t = Date.parse(dt);
    if (!t || isNaN(t)) return '';
    const d = new Date(t);
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  let toastTimer = null;
  function toast(msg, isErr) {
    els.toast.textContent = msg;
    els.toast.classList.toggle('err', !!isErr);
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2200);
  }

  async function copyText(text, okMsg) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      toast(okMsg || '已复制');
      return true;
    } catch (e) {
      toast('复制失败，请手动选择', true);
      return false;
    }
  }

  /* ---------------- 主题 ---------------- */
  function initTheme() {
    let urlTheme = null;
    try {
      urlTheme = new URLSearchParams(location.search).get('theme');
    } catch (e) {}
    const saved = localStorage.getItem(T_KEY);
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = urlTheme === 'dark' || urlTheme === 'light' ? urlTheme : saved || (prefersDark ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
  }
  function toggleTheme() {
    const cur = document.documentElement.getAttribute('data-theme');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem(T_KEY, next);
  }

  /* ---------------- 历史记录 ---------------- */
  function getHistory() {
    try {
      const v = JSON.parse(localStorage.getItem(H_KEY) || '[]');
      return Array.isArray(v) ? v : [];
    } catch (e) {
      return [];
    }
  }
  function pushHistory(kw) {
    if (!kw) return;
    let list = getHistory().filter((x) => x !== kw);
    list.unshift(kw);
    list = list.slice(0, 12);
    try {
      localStorage.setItem(H_KEY, JSON.stringify(list));
    } catch (e) {}
    renderHistory();
  }
  function renderHistory() {
    const list = getHistory();
    els.historyBlock.hidden = list.length === 0;
    els.historyChips.innerHTML = list
      .map(
        (w) =>
          '<button class="chip" data-kw="' + esc(w) + '">' + esc(w) +
          '<span class="x" data-remove="' + esc(w) + '">×</span></button>'
      )
      .join('');
  }

  /* ---------------- 首屏装饰 ---------------- */
  function renderHot() {
    els.hotChips.innerHTML = HOT_WORDS.map((w) => '<button class="chip" data-kw="' + esc(w) + '">' + esc(w) + '</button>').join('');
  }
  function renderWall() {
    els.diskWall.innerHTML = WALL_DISKS.map((t) => {
      const d = diskInfo(t);
      return (
        '<span class="disk-pill"><i style="background:' + d.color + '">' + esc(d.short) + '</i>' + esc(d.name) + '</span>'
      );
    }).join('');
  }

  /* ---------------- 搜索 ---------------- */
  let searchAbort = null;

  async function doSearch(kw, opts) {
    opts = opts || {};
    kw = String(kw || '').trim();
    if (!kw) {
      toast('请输入搜索关键词', true);
      els.input.focus();
      return;
    }
    state.q = kw;
    els.input.value = kw;
    pushHistory(kw);
    setLoading(true);
    els.stateBox.innerHTML = ''; // 清掉上一次的空态/错误态提示
    showSkeleton();
    els.hero.classList.add('compact');
    els.filterbar.hidden = false;
    updateUrl(kw);

    if (searchAbort) searchAbort.abort();
    searchAbort = new AbortController();
    const timer = setTimeout(() => searchAbort.abort(), 90000);

    const t0 = Date.now();
    try {
      const resp = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kw,
          src: state.adv.src,
          plugins: state.adv.plugins,
          channels: state.adv.channels,
          refresh: !!opts.refresh,
        }),
        signal: searchAbort.signal,
      });
      clearTimeout(timer);
      const json = await resp.json();
      state.elapsed = json.elapsed != null ? json.elapsed : Date.now() - t0;
      state.cached = !!json.cached;

      if (json.code !== 0) {
        state.data = null;
        renderAll();
        showError(json.message || '搜索失败，请稍后重试');
        return;
      }
      state.data = json.data;
      state.type = 'all';
      state.shown = PAGE_SIZE;
      state.sort = els.sortSel.value;
      renderAll();
      if (json.data.deduped === 0) {
        showEmpty();
      }
      updateSourceStatus();
    } catch (e) {
      clearTimeout(timer);
      if (e && e.name === 'AbortError') {
        // 用户发起了新搜索，忽略
        return;
      }
      state.data = null;
      renderAll();
      showError('网络请求失败：' + ((e && e.message) || '未知错误'));
    } finally {
      setLoading(false);
    }
  }

  function setLoading(on) {
    state.loading = on;
    els.searchBtn.disabled = on;
    els.btnText.hidden = on;
    els.btnSpinner.hidden = !on;
  }

  function updateUrl(kw) {
    try {
      const u = new URL(location.href);
      if (kw) u.searchParams.set('q', kw);
      else u.searchParams.delete('q');
      history.replaceState(null, '', u.toString());
    } catch (e) {}
  }

  /* ---------------- 数据整理 ---------------- */
  function flatList() {
    if (!state.data) return [];
    const mbt = state.data.merged_by_type || {};
    let arr = [];
    if (state.type === 'all') {
      Object.keys(mbt).forEach((t) => {
        mbt[t].forEach((it) => arr.push(it));
      });
    } else {
      arr = (mbt[state.type] || []).slice();
    }
    // 排序
    if (state.sort === 'time') {
      arr.sort((a, b) => {
        const ta = a.datetime ? Date.parse(a.datetime) || 0 : 0;
        const tb = b.datetime ? Date.parse(b.datetime) || 0 : 0;
        if (tb !== ta) return tb - ta;
        return 0;
      });
    } else if (state.sort === 'name') {
      arr.sort((a, b) => {
        const la = splitNote(a.note).title;
        const lb = splitNote(b.note).title;
        return la.localeCompare(lb, 'zh-Hans-CN');
      });
    }
    return arr;
  }

  /* ---------------- 同一资源聚合 ---------------- */

  /** 标题归一化：去掉空白与标点，用于判断是否同一资源 */
  function normalizeTitle(t) {
    return String(t || '')
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[【】\[\]（）()《》〈〉<>「」『』·•.,，。!！?？~～\-—_|:：;；'"“”‘’+*&/\\]/g, '');
  }

  /** 把标题相同的链接合并成一张资源卡，组内按网盘主流程度排序 */
  function groupItems(items) {
    const map = new Map();
    const order = [];
    for (const it of items) {
      const parts = splitNote(it.note);
      const key = normalizeTitle(parts.title) || '__url__' + it.url;
      let g = map.get(key);
      if (!g) {
        g = { key, title: parts.title, desc: parts.desc, links: [], datetime: '' };
        map.set(key, g);
        order.push(key);
      }
      g.links.push(it);
      if (!g.desc && parts.desc) g.desc = parts.desc;
      const t = it.datetime ? Date.parse(it.datetime) || 0 : 0;
      const gt = g.datetime ? Date.parse(g.datetime) || 0 : 0;
      if (t > gt) g.datetime = it.datetime;
    }
    return order.map((k) => {
      const g = map.get(k);
      g.links.sort((a, b) => typeRank(a.type) - typeRank(b.type));
      return g;
    });
  }

  /** 当前视图下真正要展示的列表 */
  function currentList() {
    const arr = flatList();
    return state.view === 'merged' ? groupItems(arr) : arr;
  }

  function typeCounts() {
    const mbt = (state.data && state.data.merged_by_type) || {};
    const types = Object.keys(mbt);
    let all = [];
    types.forEach((t) => {
      all = all.concat(mbt[t]);
    });
    // 数量口径跟随当前视图：合并视图算资源数，列表视图算链接数
    const merged = state.view === 'merged';
    const list = types.map((t) => ({
      type: t,
      count: merged ? groupItems(mbt[t]).length : mbt[t].length,
    }));
    list.sort((a, b) => b.count - a.count || typeRank(a.type) - typeRank(b.type));
    return { list, total: merged ? groupItems(all).length : all.length };
  }

  /* ---------------- 渲染 ---------------- */
  function renderAll() {
    renderTabs();
    renderMeta();
    renderResults();
    renderLoadMore();
  }

  function renderTabs() {
    const { list, total } = typeCounts();
    let html =
      '<button class="type-tab' + (state.type === 'all' ? ' active' : '') + '" data-type="all" role="tab">' +
      '<span>全部</span><span class="n">' + total + '</span></button>';
    html += list
      .map((it) => {
        const d = diskInfo(it.type);
        return (
          '<button class="type-tab' + (state.type === it.type ? ' active' : '') + '" data-type="' + esc(it.type) + '" role="tab">' +
          '<i style="background:' + d.color + '">' + esc(d.short) + '</i>' +
          '<span>' + esc(d.name) + '</span><span class="n">' + it.count + '</span></button>'
        );
      })
      .join('');
    els.typeTabs.innerHTML = html;
  }

  function renderMeta() {
    if (!state.data) {
      els.resultMeta.innerHTML = '';
      return;
    }
    const list = currentList();
    const linkTotal = flatList().length;
    const d = state.data;
    const srcOk = (d.sources || []).filter((s) => s.ok).length;
    const srcAll = (d.sources || []).length;
    let html =
      state.view === 'merged'
        ? '找到 <b>' + list.length + '</b> 个资源'
        : '找到 <b>' + list.length + '</b> 条结果';
    if (state.view === 'merged' && linkTotal > list.length) {
      html += '<span class="sep">·</span>共 ' + linkTotal + ' 条链接';
    }
    if (state.type === 'all' && d.raw_count != null && d.raw_count > d.deduped) {
      html += '<span class="sep">·</span>去重前 ' + d.raw_count + ' 条';
    }
    html += '<span class="sep">·</span>' + srcOk + '/' + srcAll + ' 个源响应';
    html += '<span class="sep">·</span>' + (state.elapsed / 1000).toFixed(1) + 's';
    if (state.cached) html += '（缓存）';
    if (srcOk < srcAll) {
      html += '<span class="sep">·</span><span class="warn">部分源不可用</span>';
    }
    els.resultMeta.innerHTML = html;
  }

  function cardHtml(item, kw) {
    const d = diskInfo(item.type);
    const { title, desc } = splitNote(item.note);
    const pwd = extractPwd(item);
    const time = fmtTime(item.datetime);
    const full = fmtFull(item.datetime);

    const titleHtml = highlight(esc(title), kw);
    const descHtml = desc ? highlight(esc(desc), kw) : '';

    const metaParts = [];
    if (time) {
      metaParts.push(
        '<span class="meta-item" title="' + esc(full) + '">' +
          '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.4" stroke="currentColor" stroke-width="1.6"/><path d="M12 7.6V12l3 1.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>' +
          esc(time) + '</span>'
      );
    }
    if (pwd) {
      metaParts.push('<button class="pwd-pill" data-copy="' + esc(pwd) + '" title="点击复制提取码">提取码 ' + esc(pwd) + '</button>');
    } else {
      metaParts.push('<span class="pwd-none">无需提取码</span>');
    }
    if (item.source) {
      metaParts.push('<span class="meta-item">' + esc(String(item.source).slice(0, 26)) + '</span>');
    }

    return (
      '<article class="card" style="--c:' + d.color + '">' +
      '<div class="card-badge">' + esc(d.short) + '</div>' +
      '<div class="card-main">' +
      '<h3 class="card-title">' + titleHtml + '</h3>' +
      (descHtml ? '<p class="card-desc">' + descHtml + '</p>' : '') +
      '<div class="card-meta">' + metaParts.join('') + '</div>' +
      '</div>' +
      '<div class="card-actions">' +
      '<button class="act-btn" data-copy="' + esc(item.url) + '" title="复制分享链接">' +
      '<svg viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="10.5" height="10.5" rx="2.4" stroke="currentColor" stroke-width="1.7"/><path d="M6.5 15H5.8A1.8 1.8 0 0 1 4 13.2V5.8A1.8 1.8 0 0 1 5.8 4h7.4A1.8 1.8 0 0 1 15 5.8v.7" stroke="currentColor" stroke-width="1.7"/></svg>' +
      '</button>' +
      '<button class="act-btn primary" data-open="' + esc(item.url) + '" title="打开链接">' +
      '<svg viewBox="0 0 24 24" fill="none"><path d="M14 5h5v5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M19 5l-7.4 7.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M18.4 14.2v3.6a1.8 1.8 0 0 1-1.8 1.8H6.2a1.8 1.8 0 0 1-1.8-1.8V7.4a1.8 1.8 0 0 1 1.8-1.8h3.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>' +
      '</button>' +
      '</div>' +
      '</article>'
    );
  }

  const ICON_CLOCK =
    '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.4" stroke="currentColor" stroke-width="1.6"/><path d="M12 7.6V12l3 1.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  const ICON_COPY =
    '<svg viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="10.5" height="10.5" rx="2.4" stroke="currentColor" stroke-width="1.7"/><path d="M6.5 15H5.8A1.8 1.8 0 0 1 4 13.2V5.8A1.8 1.8 0 0 1 5.8 4h7.4A1.8 1.8 0 0 1 15 5.8v.7" stroke="currentColor" stroke-width="1.7"/></svg>';
  const ICON_OPEN =
    '<svg viewBox="0 0 24 24" fill="none"><path d="M14 5h5v5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M19 5l-7.4 7.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M18.4 14.2v3.6a1.8 1.8 0 0 1-1.8 1.8H6.2a1.8 1.8 0 0 1-1.8-1.8V7.4a1.8 1.8 0 0 1 1.8-1.8h3.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

  /** 资源卡：同一资源的多个网盘入口收在一张卡里 */
  function groupCardHtml(g, kw) {
    // 只有一个网盘时退回紧凑卡片，不为一条链接多占两行
    if (g.links.length === 1) return cardHtml(g.links[0], kw);

    const time = fmtTime(g.datetime);
    const full = fmtFull(g.datetime);

    const rows = g.links
      .map((it) => {
        const d = diskInfo(it.type);
        const pwd = extractPwd(it);
        return (
          '<div class="link-row" style="--c:' + d.color + '">' +
          '<span class="link-badge">' + esc(d.short) + '</span>' +
          (pwd
            ? '<button class="pwd-pill" data-copy="' + esc(pwd) + '" title="点击复制提取码">提取码 ' + esc(pwd) + '</button>'
            : '<span class="pwd-none">无需提取码</span>') +
          '<span class="link-acts">' +
          '<button class="act-btn sm" data-copy="' + esc(it.url) + '" title="复制链接">' + ICON_COPY + '</button>' +
          '<button class="act-btn sm primary" data-open="' + esc(it.url) + '" title="打开链接">' + ICON_OPEN + '</button>' +
          '</span>' +
          '</div>'
        );
      })
      .join('');

    return (
      '<article class="res-card">' +
      '<h3 class="card-title">' + highlight(esc(g.title), kw) + '</h3>' +
      (g.desc ? '<p class="card-desc">' + highlight(esc(g.desc), kw) + '</p>' : '') +
      '<div class="card-meta">' +
      (time ? '<span class="meta-item" title="' + esc(full) + '">' + ICON_CLOCK + esc(time) + '</span>' : '') +
      '<span class="meta-item">' + g.links.length + ' 个网盘可用</span>' +
      '</div>' +
      '<div class="link-list">' + rows + '</div>' +
      '</article>'
    );
  }

  function renderResults() {
    if (!state.data) {
      els.results.innerHTML = '';
      return;
    }
    const list = currentList();
    if (list.length === 0) {
      els.results.innerHTML = '';
      return;
    }
    const slice = list.slice(0, state.shown);
    els.results.innerHTML = slice
      .map((it) => (state.view === 'merged' ? groupCardHtml(it, state.q) : cardHtml(it, state.q)))
      .join('');
  }

  function renderLoadMore() {
    if (!state.data) {
      els.loadMoreWrap.hidden = true;
      return;
    }
    const more = currentList().length - state.shown;
    if (more > 0) {
      els.loadMoreWrap.hidden = false;
      els.loadMore.querySelector('span').textContent =
        '加载更多（还有 ' + more + (state.view === 'merged' ? ' 个资源' : ' 条') + '）';
    } else {
      els.loadMoreWrap.hidden = true;
    }
  }

  function showSkeleton() {
    els.stateBox.innerHTML = '';
    let html = '';
    for (let i = 0; i < 5; i++) {
      html +=
        '<div class="skeleton"><div class="sk-badge"></div><div class="sk-lines">' +
        '<div class="sk-line" style="width:' + (52 + Math.random() * 30).toFixed(0) + '%"></div>' +
        '<div class="sk-line" style="width:' + (72 + Math.random() * 22).toFixed(0) + '%"></div>' +
        '<div class="sk-line" style="width:26%"></div>' +
        '</div></div>';
    }
    els.results.innerHTML = html;
    els.loadMoreWrap.hidden = true;
    els.resultMeta.innerHTML = '正在搜索「' + esc(state.q) + '」…';
  }

  function showEmpty() {
    els.results.innerHTML = '';
    els.loadMoreWrap.hidden = true;
    const sug = [state.q + ' 4K', state.q + ' 全集', state.q + ' 高清'].filter(Boolean);
    els.stateBox.innerHTML =
      '<div class="state">' +
      '<div class="state-icon"><svg viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="6.4" stroke="currentColor" stroke-width="1.7"/><path d="m15.8 15.8 4 4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></div>' +
      '<h3>没有找到相关资源</h3>' +
      '<p>试试更换关键词、缩短关键词，或切换搜索源后再试。</p>' +
      '<div class="hint-chips">' + sug.map((s) => '<button class="chip" data-kw="' + esc(s) + '">' + esc(s) + '</button>').join('') + '</div>' +
      '</div>';
  }

  function showError(msg) {
    els.results.innerHTML = '';
    els.loadMoreWrap.hidden = true;
    els.stateBox.innerHTML =
      '<div class="state">' +
      '<div class="state-icon err"><svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.6" stroke="currentColor" stroke-width="1.7"/><path d="M12 7.8v5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><circle cx="12" cy="16.1" r="1.05" fill="currentColor"/></svg></div>' +
      '<h3>搜索失败</h3>' +
      '<p>' + esc(msg) + '</p>' +
      '<div class="hint-chips"><button class="chip" id="retryBtn">重新搜索</button></div>' +
      '</div>';
    const rb = $('retryBtn');
    if (rb) rb.addEventListener('click', () => doSearch(state.q, { refresh: true }));
  }

  function showWelcome() {
    els.stateBox.innerHTML = '';
    els.results.innerHTML = '';
    els.filterbar.hidden = true;
  }

  /* ---------------- 源状态 ---------------- */
  function updateSourceStatus() {
    const d = state.data;
    if (!d || !d.sources) return;
    const ok = d.sources.filter((s) => s.ok).length;
    const all = d.sources.length;
    els.srcStatus.className = 'src-status ' + (ok === all ? 'ok' : ok > 0 ? 'partial' : 'down');
    els.srcStatusText.textContent = ok + '/' + all + ' 源在线';
  }

  async function loadHealth() {
    try {
      const r = await fetch('/api/health');
      const j = await r.json();
      state.health = j;
      // 已有搜索结果时，顶栏状态以本次搜索的实际响应为准，避免 health 结果覆盖造成不一致
      if (!state.data) {
        const ok = (j.upstreams || []).filter((u) => u.ok).length;
        const all = (j.upstreams || []).length || 1;
        els.srcStatus.className = 'src-status ' + (ok === all ? 'ok' : ok > 0 ? 'partial' : 'down');
        els.srcStatusText.textContent = ok + '/' + all + ' 源在线';
      }

      els.upstreamList.innerHTML = (j.upstreams || [])
        .map(
          (u) =>
            '<div class="upstream ' + (u.ok ? 'ok' : 'bad') + '">' +
            '<i class="dot"></i>' +
            '<span class="u-name">' + esc(u.name) + '</span>' +
            '<span class="u-info">' + (u.ok ? (u.plugin_count ? u.plugin_count + ' 插件 · ' : '') + u.ms + 'ms' : esc(u.error || '不可用')) + '</span>' +
            '</div>'
        )
        .join('') || '<p class="picker-empty">无可用搜索源</p>';

      renderPicker('plugin');
      renderPicker('channel');
    } catch (e) {
      if (!state.data) {
        els.srcStatus.className = 'src-status down';
        els.srcStatusText.textContent = '服务未连接';
      }
      els.upstreamList.innerHTML = '<p class="picker-empty">无法连接本地服务，请确认已运行 node server.js</p>';
    }
  }

  function renderPicker(kind) {
    const isPlugin = kind === 'plugin';
    const picker = isPlugin ? els.pluginPicker : els.channelPicker;
    const filterEl = isPlugin ? els.pluginFilter : els.channelFilter;
    const countEl = isPlugin ? els.pluginCount : els.channelCount;
    const all = ((state.health && (isPlugin ? state.health.plugins : state.health.channels)) || []).slice().sort();
    const selected = state.adv[isPlugin ? 'plugins' : 'channels'];
    const q = (filterEl.value || '').trim().toLowerCase();
    const list = q ? all.filter((x) => x.toLowerCase().includes(q)) : all;

    countEl.textContent = selected.length ? selected.length + '/' + all.length : all.length;

    if (!list.length) {
      picker.innerHTML = '<p class="picker-empty">' + (all.length ? '无匹配项' : '暂无数据') + '</p>';
      return;
    }
    picker.innerHTML = list
      .map((x) => '<button class="tag' + (selected.indexOf(x) >= 0 ? ' on' : '') + '" data-kind="' + kind + '" data-val="' + esc(x) + '">' + esc(x) + '</button>')
      .join('');
  }

  /* ---------------- 抽屉 ---------------- */
  function openDrawer() {
    els.drawer.hidden = false;
    els.drawerMask.hidden = false;
    if (!state.health) loadHealth();
  }
  function closeDrawer() {
    els.drawer.hidden = true;
    els.drawerMask.hidden = true;
  }

  /* ---------------- 事件绑定 ---------------- */
  function bind() {
    els.form.addEventListener('submit', (e) => {
      e.preventDefault();
      doSearch(els.input.value);
    });

    els.input.addEventListener('input', () => {
      els.clearBtn.hidden = !els.input.value;
    });
    els.clearBtn.addEventListener('click', () => {
      els.input.value = '';
      els.clearBtn.hidden = true;
      els.input.focus();
    });

    els.hotChips.addEventListener('click', (e) => {
      const b = e.target.closest('[data-kw]');
      if (b) doSearch(b.dataset.kw);
    });

    els.historyChips.addEventListener('click', (e) => {
      const rm = e.target.closest('[data-remove]');
      if (rm) {
        e.stopPropagation();
        const w = rm.dataset.remove;
        const list = getHistory().filter((x) => x !== w);
        try { localStorage.setItem(H_KEY, JSON.stringify(list)); } catch (err) {}
        renderHistory();
        return;
      }
      const b = e.target.closest('[data-kw]');
      if (b) doSearch(b.dataset.kw);
    });

    els.clearHistory.addEventListener('click', () => {
      try { localStorage.removeItem(H_KEY); } catch (e) {}
      renderHistory();
      toast('已清空搜索历史');
    });

    // 类型切换
    els.typeTabs.addEventListener('click', (e) => {
      const t = e.target.closest('[data-type]');
      if (!t) return;
      state.type = t.dataset.type;
      state.shown = PAGE_SIZE;
      els.stateBox.innerHTML = '';
      renderAll();
      const y = els.filterbar.getBoundingClientRect().top + window.scrollY - 84;
      window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
    });

    // 排序
    els.sortSel.addEventListener('change', () => {
      state.sort = els.sortSel.value;
      state.shown = PAGE_SIZE;
      renderAll();
    });

    // 展示方式：合并（同一资源多网盘收在一张卡）/ 列表（每条链接一张卡）
    els.viewSeg.addEventListener('click', (e) => {
      const s = e.target.closest('.seg');
      if (!s) return;
      [].forEach.call(els.viewSeg.children, (b) => b.classList.toggle('active', b === s));
      state.view = s.dataset.view;
      state.shown = PAGE_SIZE;
      renderAll();
    });

    // 刷新（忽略缓存）
    els.refreshBtn.addEventListener('click', () => {
      if (state.q) doSearch(state.q, { refresh: true });
    });

    // 加载更多
    els.loadMore.addEventListener('click', () => {
      state.shown += PAGE_SIZE;
      renderResults();
      renderLoadMore();
    });

    // 卡片操作
    els.results.addEventListener('click', (e) => {
      const cp = e.target.closest('[data-copy]');
      if (cp) {
        copyText(cp.dataset.copy, cp.classList.contains('pwd-pill') ? '提取码已复制' : '链接已复制');
        return;
      }
      const op = e.target.closest('[data-open]');
      if (op) {
        const url = op.dataset.open;
        if (/^(magnet|ed2k):/i.test(url)) {
          copyText(url, '磁力/电驴链接已复制');
        } else {
          window.open(url, '_blank', 'noopener');
        }
      }
    });

    // 状态框内的建议词
    els.stateBox.addEventListener('click', (e) => {
      const b = e.target.closest('[data-kw]');
      if (b) doSearch(b.dataset.kw);
    });

    // 主题
    els.themeBtn.addEventListener('click', toggleTheme);

    // 抽屉
    els.advBtn.addEventListener('click', openDrawer);
    els.drawerClose.addEventListener('click', closeDrawer);
    els.drawerMask.addEventListener('click', closeDrawer);

    els.srcSeg.addEventListener('click', (e) => {
      const s = e.target.closest('.seg');
      if (!s) return;
      [].forEach.call(els.srcSeg.children, (b) => b.classList.remove('active'));
      s.classList.add('active');
      state.adv.src = s.dataset.src;
    });

    els.pluginPicker.addEventListener('click', (e) => {
      const t = e.target.closest('[data-kind]');
      if (!t) return;
      toggleTag('plugins', t.dataset.val);
      renderPicker('plugin');
    });
    els.channelPicker.addEventListener('click', (e) => {
      const t = e.target.closest('[data-kind]');
      if (!t) return;
      toggleTag('channels', t.dataset.val);
      renderPicker('channel');
    });

    els.pluginFilter.addEventListener('input', () => renderPicker('plugin'));
    els.channelFilter.addEventListener('input', () => renderPicker('channel'));

    els.resetAdv.addEventListener('click', () => {
      state.adv = { src: 'all', plugins: [], channels: [] };
      [].forEach.call(els.srcSeg.children, (b) => b.classList.toggle('active', b.dataset.src === 'all'));
      els.pluginFilter.value = '';
      els.channelFilter.value = '';
      renderPicker('plugin');
      renderPicker('channel');
      toast('已重置高级选项');
    });

    els.applyAdv.addEventListener('click', () => {
      closeDrawer();
      if (state.q) doSearch(state.q);
      else els.input.focus();
    });

    // 快捷键
    document.addEventListener('keydown', (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || tag === 'select';
      if (e.key === '/' && !typing) {
        e.preventDefault();
        els.input.focus();
        els.input.select();
      } else if (e.key === 'Escape') {
        if (!els.drawer.hidden) return closeDrawer();
        if (typing) {
          els.input.blur();
        }
      }
    });

    // 顶栏阴影
    window.addEventListener('scroll', () => {
      els.topbar.classList.toggle('scrolled', window.scrollY > 8);
    }, { passive: true });
  }

  function toggleTag(key, val) {
    const arr = state.adv[key];
    const i = arr.indexOf(val);
    if (i >= 0) arr.splice(i, 1);
    else arr.push(val);
  }

  /* ---------------- 启动 ---------------- */
  function init() {
    initTheme();
    renderHot();
    renderWall();
    renderHistory();
    bind();
    loadHealth();

    const params = new URLSearchParams(location.search);
    const q = params.get('q');
    if (q) {
      els.input.value = q;
      els.clearBtn.hidden = false;
      doSearch(q);
    } else {
      showWelcome();
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
