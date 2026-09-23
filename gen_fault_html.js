/** 黄岛故障看板 v7：跳闸/接地/母线统一满屏模板（1920×1080，一标题一面板）。FAULT_SEED_FILE 可离线重渲染。 */
const fs = require('fs');
const path = require('path');
const biz = require('./index.js'); // 复用 API 调用逻辑

/**
 * 解析看板输出目录。
 * 优先级：FAULT_OUT_DIR → 本技能下 output/（嵌入 .sgcode/skills 时为工作区/output）。
 * @returns {string} 绝对路径
 */
function resolveOutDir() {
  if (process.env.FAULT_OUT_DIR) {
    return path.resolve(process.env.FAULT_OUT_DIR);
  }
  const parts = path.normalize(__dirname).split(path.sep).filter(Boolean);
  const skillsIdx = parts.lastIndexOf('skills');
  const sgcodeIdx = parts.lastIndexOf('.sgcode');
  // .../.sgcode/skills/<skillName> → <workspace>/output
  if (sgcodeIdx >= 0 && skillsIdx === sgcodeIdx + 1 && skillsIdx === parts.length - 2) {
    return path.resolve(__dirname, '..', '..', '..', 'output');
  }
  return path.join(__dirname, 'output');
}

const WORKSPACE_DIR = resolveOutDir();

function ensureOutDir() {
  if (!fs.existsSync(WORKSPACE_DIR)) {
    fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
  }
}

// ---------------- 工具函数 ----------------

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function todayTime() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function todayCompact() {
  const d = new Date();
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
}

/**
 * 本次事件时间。优先「信息同步」里的时间戳，其次任意日期时间，再次动作时间。
 * @param {string} text
 * @returns {string}
 */
function findEventTime(text) {
  const src = String(text || '');
  const sync = src.split(/信息同步/).slice(1).join('\n');
  const fromSync = sync.match(/20\d{2}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?/);
  if (fromSync) return fromSync[0];
  const any = src.match(/20\d{2}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?/);
  if (any) return any[0];
  const act = src.match(/动作时间[：:]\s*([^\n]+)/);
  return act ? act[1].trim() : '';
}

/** 小时:分钟 或「日期 + 小时」不是字段名，避免把通报正文拆成键值 */
function isTimeFragment(key, value) {
  if (/^\d{1,2}$/.test(key) && /^\d{2}(\D|$)/.test(String(value || ''))) return true;
  if (/^\d{4}-\d{2}-\d{2}(?:\s+\d{1,2})?$/.test(key)) return true;
  return false;
}

/**
 * 把一行里的「键：值」拆开。分隔符是中文逗号、分号或两个以上空格。
 * 值内部的逗号（区段描述）保留；时间里的冒号不当作新字段。
 * @param {string} line
 * @returns {Array<[string, string]>}
 */
function parseFieldPairs(line) {
  const src = String(line || '').trim();
  if (!src || src.startsWith('|')) return [];
  const re = /([^\s：:，,；;|][^：:]{0,30}?)[：:]([\s\S]*?)(?=(?:[，,；;]\s*|\s{2,})(?=[^\s：:，,；;|][^：:]{0,30}?[：:])|$)/g;
  const pairs = [];
  let m;
  while ((m = re.exec(src)) !== null) {
    const k = m[1].trim();
    const v = m[2].replace(/[，,；;]+\s*$/, '').trim();
    if (!k || isTimeFragment(k, v)) continue;
    pairs.push([k, v]);
  }
  return pairs;
}

const FIELD_ORDER = [
  '线路名称', '变电站名称', '年度', '停电日期', '停电时间', '送电日期', '送电时间', '故障原因',
  '杆号区段', '起始点', '终止点', '所在林区', '穿越长度kM', '通道长度公里', '隐患类型',
  '备注', '其他隐患描述', '区段描述',
];

function orderHeaders(keys) {
  return keys.slice().sort((a, b) => {
    const ia = FIELD_ORDER.indexOf(a);
    const ib = FIELD_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
}

function pairsToMap(pairs) {
  const map = {};
  pairs.forEach(([k, v]) => {
    if (!(k in map)) map[k] = v;
  });
  return map;
}

function isBlankCell(v) {
  return !String(v || '').trim() || /^(无|—|-|\/)$/.test(String(v).trim());
}

/** 窄栏（母线大屏线路详情）用逐条卡片，避免多列表格把列挤没 */
function renderRecordCards(headers, rows) {
  const cols = orderHeaders(headers).filter((h) => rows.some((r) => !isBlankCell(r[h])));
  const use = cols.length ? cols : orderHeaders(headers);
  if (!use.length || !rows.length) return '';
  return rows.map((r) => {
    const body = use.map((h) => `<div class="ld-row"><span>${esc(h)}</span><b>${esc(r[h] != null ? r[h] : '—')}</b></div>`).join('');
    return `<div class="ld-seg">${body}</div>`;
  }).join('');
}

function renderDataTable(headers, rows) {
  const cols = orderHeaders(headers).filter((h) => rows.some((r) => !isBlankCell(r[h])));
  const use = cols.length ? cols : orderHeaders(headers);
  if (!use.length || !rows.length) return '';
  const head = use.map((h) => `<th>${esc(h)}</th>`).join('');
  const body = rows
    .map((r) => `<tr>${use.map((h) => `<td>${esc(r[h] != null ? r[h] : '')}</td>`).join('')}</tr>`)
    .join('');
  return `<div class="table-wrap"><table class="dt"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function pickMain(query) {
  const q = String(query || '').trim();
  // 优先识别行首“跳闸：/接地：/母线接地：”段落头（避免正文里“跳闸前接地”等干扰）
  const head = q.match(/^\s*(母线接地|接地|跳闸)\s*[：:]/m);
  if (head) return head[1];
  if (/母线接地/.test(q)) return '母线接地';
  if (/接地/.test(q)) return '接地';
  return '跳闸';
}

// 解析一段 kv（支持 “键：值” 与 “键：值  键2：值2” 多空行）
function extractKV(text) {
  const kv = {};
  const lines = String(text || '').split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim().replace(/\u00a0/g, ' ');
    if (!line) continue;
    if (/^(母线接地|接地|跳闸)\s*[：:]?$/.test(line)) continue;
    const m = line.match(/^([^：:：\t]{1,20})[：:]\s*(.+)$/);
    if (m) {
      const key = m[1].trim();
      const val = m[2].trim();
      if (key && !(key in kv)) kv[key] = val;
      continue;
    }
    const parts = line.split(/ {2,}|\t+/).filter(Boolean);
    for (const p of parts) {
      const mm = p.match(/^([^：:：\t]{1,20})[：:]\s*(.+)$/);
      if (mm) kv[mm[1].trim()] = mm[2].trim();
    }
  }
  return kv;
}

function numOf(v) {
  const m = /([\d.]+)/.exec(String(v));
  return m ? parseFloat(m[1]) : null;
}

// ---------------- 监测大屏 v7（统一满屏模板） ----------------

function ringGauge(label, value, maxVal) {
  const n = numOf(value);
  const pct = n == null ? 0 : Math.max(0, Math.min(100, Math.round((n / (maxVal || 10)) * 100)));
  const low = n != null && n < 2;
  const r = 36;
  const c = 2 * Math.PI * r;
  const dash = (pct / 100) * c;
  const col = low ? '#ff4d6a' : '#00e5ff';
  return `<div class="ring-box${low ? ' low' : ''}"><svg viewBox="0 0 88 88" class="ring-svg"><circle cx="44" cy="44" r="${r}" class="ring-track"/><circle cx="44" cy="44" r="${r}" class="ring-arc" stroke="${col}" stroke-dasharray="${dash.toFixed(1)} ${(c - dash).toFixed(1)}" transform="rotate(-90 44 44)"/></svg><div class="ring-center"><b style="color:${col}">${esc(value || '—')}</b><span>${esc(label)}</span></div></div>`;
}

function statChip(label, value) {
  return `<div class="stat-chip"><div class="sc-val">${esc(value || '—')}</div><div class="sc-lbl">${esc(label)}</div></div>`;
}

function hBarRow(label, val, max) {
  const n = numOf(val);
  const pct = n == null ? 8 : Math.max(8, Math.min(100, Math.round((n / (max || 1)) * 100)));
  const short = String(label || '').length > 24 ? String(label).slice(0, 22) + '…' : label;
  return `<div class="hbar"><span class="hb-lbl" title="${esc(label)}">${esc(short)}</span><div class="hb-track"><div class="hb-fill" style="width:${pct}%"></div></div><span class="hb-val">${esc(val)}</span></div>`;
}

function compactList(pairs) {
  if (!pairs.length) return '<div class="empty">无</div>';
  return `<div class="clist">${pairs.map(([k, v]) => `<div class="cl-row"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div>`;
}

function renderTrialList(lines) {
  const items = lines.map((l) => l.trim()).filter(Boolean);
  if (!items.length) return '<div class="empty">无</div>';
  let html = '';
  items.forEach((t) => {
    const isHead = !/^\d/.test(t) && /优先|其次|最后|协商|无穿越/.test(t);
    if (isHead) { html += `<div class="trial-head">${esc(t)}</div>`; return; }
    const m = t.match(/^(\d+)[.、\s]+(.+)$/);
    const n = m ? m[1] : '';
    const body = m ? m[2] : t;
    const pct = m ? Math.max(20, 100 - (parseInt(n, 10) - 1) * 16) : 50;
    html += `<div class="trial-row"><span class="trial-n">${esc(n || '·')}</span><div class="trial-bar"><div class="trial-fill" style="width:${pct}%"></div></div><span class="trial-txt">${esc(body)}</span></div>`;
  });
  return html;
}

function renderForestBars(lines) {
  const records = [];
  lines.forEach((l) => { const pairs = parseFieldPairs(l); if (pairs.length >= 2) records.push(pairsToMap(pairs)); });
  if (!records.length) {
    const t = lines.map((l) => l.trim()).filter(Boolean);
    if (t.length === 1 && /^无$/.test(t[0])) return '<div class="empty">无</div>';
    return t.length ? `<div class="narr">${esc(t.join('\n'))}</div>` : '<div class="empty">无</div>';
  }
  const maxLen = Math.max(...records.map((r) => numOf(r['穿越长度kM'] || r['通道长度公里']) || 0.1), 0.5);
  return records.map((r) => {
    const lbl = r['杆号区段'] || r['起始点'] || r['区段描述'] || '区段';
    const val = r['穿越长度kM'] || r['通道长度公里'] || '—';
    const disp = String(val).includes('km') ? val : `${val}km`;
    return hBarRow(lbl, disp, maxLen);
  }).join('');
}

function renderSectionBody(title, lines) {
  const pure = lines.map((l) => String(l || '').trim()).filter(Boolean);
  if (!pure.length) return '<div class="empty">无</div>';
  if (/试拉/.test(title)) return renderTrialList(pure);
  if (/信息同步/.test(title)) return `<div class="narr sync-txt">${esc(pure.join('\n'))}</div>`;
  if (/穿越林区|密集通道/.test(title)) return renderForestBars(pure);
  if (/联系人|概况/.test(title)) return renderRowTables(pure);
  if (/故障信息/.test(title)) {
    const md = parseMdTable(pure);
    if (md) {
      const maps = md.rows.map((r) => { const o = {}; md.headers.forEach((h, i) => { o[h] = r[i] != null ? r[i] : ''; }); return o; });
      if (maps.every((r) => md.headers.every((h) => isBlankCell(r[h])))) return '<div class="empty">无</div>';
      return renderRecordCards(md.headers, maps);
    }
    if (pure.length === 1 && /^无$/.test(pure[0])) return '<div class="empty">无</div>';
  }
  if (pure.length === 1 && /^无$/.test(pure[0])) return '<div class="empty">无</div>';
  const pairs = [];
  pure.forEach((l) => { const ps = parseFieldPairs(l); if (ps.length === 1) pairs.push(ps[0]); });
  if (pairs.length) return compactList(pairs);
  const tbl = renderRowTables(pure);
  return tbl || `<div class="narr">${esc(pure.join('\n'))}</div>`;
}

function renderBlockBody(block) {
  if (/\d+kV[\u4e00-\u9fa5A-Za-z0-9]*线/.test(block.title)) {
    const body = renderLineDetail(block.lines);
    return body || renderSectionBody(block.title, block.lines);
  }
  return renderSectionBody(block.title, block.lines);
}

function panelSpan(title) {
  if (/信息同步|跳闸过程/.test(title)) return { c: 4, r: 1 };
  if (/穿越|密集|试拉|联系人|概况/.test(title)) return { c: 2, r: 2 };
  if (/电压|接地信息|过流|母线接地/.test(title)) return { c: 2, r: 1 };
  return { c: 2, r: 1 };
}

function mkPanel(title, body, col, row) {
  const sp = col ? { c: col, r: row || 1 } : panelSpan(title);
  return `<div class="panel" style="grid-column:span ${sp.c};grid-row:span ${sp.r}"><div class="panel-h"><i></i>${esc(title)}</div><div class="panel-b">${body || '<div class="empty">无</div>'}</div></div>`;
}

function renderPageGrid(panels) {
  return `<div class="page-grid">${panels.map((p) => mkPanel(p.title, p.body, p.c, p.r)).join('')}</div>`;
}

function parseLineSubs(lines) {
  const subs = [];
  let cur = null;
  for (const raw of lines) {
    const line = raw.replace(/^\s+/, '').replace(/\s+$/, '');
    if (!line) continue;
    const m = line.match(/^(\d+)\s*[、\.]\s*(.+)$/);
    if (m) {
      const t = m[2].trim();
      const tm = t.match(/^(.+?)[：:]\s*(\S.*)$/);
      cur = { title: tm ? tm[1].trim() : t.replace(/[：:]\s*$/, ''), value: tm ? tm[2].trim() : '', body: [] };
      subs.push(cur);
      continue;
    }
    if (cur) cur.body.push(line);
  }
  return subs.filter((s) => !/供电所联系人/.test(s.title));
}

function renderSubBody(sub) {
  const NONE = '<div class="empty">无</div>';
  const items = sub.body.map((l) => l.trim()).filter(Boolean);
  const onlyNone = !sub.value && (!items.length || (items.length === 1 && /^无$/.test(items[0])));
  if (onlyNone) return NONE;
  if (/穿越|密集/.test(sub.title)) {
    const src = items.length ? items : (sub.value ? [sub.value] : []);
    return renderForestBars(src);
  }
  if (sub.value && !items.length) return `<div class="ld-value big">${esc(sub.value)}</div>`;
  const parts = [];
  if (sub.value) parts.push(`<div class="ld-value big">${esc(sub.value)}</div>`);
  const md = parseMdTable(items);
  if (md) {
    const maps = md.rows.map((r) => { const o = {}; md.headers.forEach((h, i) => { o[h] = r[i] != null ? r[i] : ''; }); return o; });
    if (maps.every((r) => md.headers.every((h) => isBlankCell(r[h])))) parts.push(NONE);
    else parts.push(renderRecordCards(md.headers, maps));
  } else {
    const records = [];
    const rest = [];
    items.forEach((l) => {
      const pairs = parseFieldPairs(l).filter(([, v]) => String(v || '').trim());
      if (pairs.length >= 2) records.push(pairs);
      else rest.push({ line: l, pairs });
    });
    if (records.length) {
      const headers = [];
      records.forEach((ps) => ps.forEach(([k]) => headers.includes(k) || headers.push(k)));
      parts.push(renderRecordCards(headers, records.map(pairsToMap)));
    }
    rest.forEach(({ line, pairs }) => {
      if (/^无$/.test(line)) parts.push(NONE);
      else if (pairs.length === 1) parts.push(`<div class="ld-row"><span>${esc(pairs[0][0])}</span><b>${esc(pairs[0][1])}</b></div>`);
      else parts.push(`<div class="ld-text">${esc(line)}</div>`);
    });
  }
  return parts.length ? parts.join('') : NONE;
}

function collectTripPanels(query, answer) {
  const panels = [
    { title: '跳闸过程', body: buildTripFlow(query) },
    { title: '过流动作', body: buildOcPanel(query) },
  ];
  parseAnswerSections(answer).forEach((s) => {
    if (/试拉/.test(s.title)) return;
    panels.push({ title: s.title, body: renderSectionBody(s.title, s.lines) });
  });
  return panels;
}

function collectGroundPanels(query, answer) {
  const panels = [
    { title: '三相电压', body: buildVoltPanel(query) },
    { title: '接地信息', body: buildGroundInfo(query) },
  ];
  parseAnswerSections(answer).forEach((s) => {
    panels.push({ title: s.title, body: renderSectionBody(s.title, s.lines) });
  });
  return panels;
}

function collectBusPages(query, answer) {
  const pages = [];
  let trial = null;
  let sync = null;
  parseAnswerBlocks(answer).forEach((b) => {
    const t = b.title.replace(/^([一二三四五六七八九十]+)\s*[、\.]\s*/, '');
    if (/\d+kV[\u4e00-\u9fa5A-Za-z0-9-]*线/.test(t)) {
      const panels = [
        { title: '母线接地信息', body: buildBusMeta(query) },
        { title: '三相电压定位', body: buildVoltPanel(query) },
      ];
      parseLineSubs(b.lines).forEach((sub) => panels.push({ title: sub.title, body: renderSubBody(sub) }));
      pages.push({ name: t, panels });
      return;
    }
    if (/试拉/.test(t)) trial = { title: t, body: renderSectionBody(t, b.lines) };
    else if (/信息同步/.test(t)) sync = { title: t, body: renderSectionBody(t, b.lines) };
  });
  if (trial || sync) {
    pages.forEach((pg) => {
      if (trial) pg.panels.push(trial);
      if (sync) pg.panels.push(sync);
    });
  }
  return pages;
}

const LINE_PICK_SCRIPT = `<script>(function(){var btns=document.querySelectorAll(".line-pick"),pages=document.querySelectorAll(".line-page");btns.forEach(function(b){b.addEventListener("click",function(){var i=b.getAttribute("data-i");btns.forEach(function(x){x.classList.remove("active");});pages.forEach(function(p){p.classList.remove("active");});b.classList.add("active");var pg=document.querySelector('.line-page[data-i="'+i+'"]');if(pg){pg.classList.add("active");var g=pg.querySelector(".page-grid");if(g)g.scrollTop=0;}});});})();</script>`;

function buildKpiStrip(query, answer, mainType) {
  const rows = buildKpiRows(query, answer, mainType);
  return `<div class="kpi-strip">${rows.map(([k, v]) => statChip(k, v)).join('')}</div>`;
}

function buildTripFlow(query) {
  const kv = extractKV(query);
  const steps = [['保护动作', kv['动作类型'] || '—'], ['跳闸前接地', kv['跳闸前接地情况'] || '—'], ['跳闸后复归', kv['跳闸后接地复归情况'] || '—'], ['损失电流', kv['损失负荷电流'] || '—']];
  return `<div class="flow-4">${steps.map(([l, v], i) => `<div class="flow-step"><div class="fs-n">${i + 1}</div><div class="fs-v">${esc(v)}</div><div class="fs-l">${esc(l)}</div></div>`).join('')}</div>`;
}

function buildOcPanel(query) {
  const kv = extractKV(query);
  return compactList([['保护装置', kv['保护装置'] || '—'], ['动作类型', kv['动作类型'] || '—'], ['动作时间', kv['动作时间'] || '—'], ['动作值', kv['动作值'] || '—']]);
}

function buildVoltPanel(query) {
  const kv = extractKV(query);
  const text = String(query || '');
  const ua = kv['Ua'] || /Ua[：:]\s*([^\s，,；;（(]+)/.exec(text)?.[1] || '';
  const ub = kv['Ub'] || /Ub[：:]\s*([^\s，,；;（(]+)/.exec(text)?.[1] || '';
  const uc = kv['Uc'] || /Uc[：:]\s*([^\s，,；;（(]+)/.exec(text)?.[1] || '';
  return `<div class="ring-row">${ringGauge('Ua', ua, 10)}${ringGauge('Ub', ub, 10)}${ringGauge('Uc', uc, 10)}</div>`;
}

function buildGroundInfo(query) {
  const kv = extractKV(query);
  return compactList([['接地相别', kv['接地相别'] || '—'], ['接地选线', kv['是否有接地选线'] || '—'], ['选线线路', kv['接地选线线路名称'] || '—'], ['瞬时接地', kv['是否瞬时接地'] || '—']]);
}

function buildBusMeta(query) {
  const kv = extractKV(query);
  const text = String(query || '');
  const qval = (re) => (text.match(re) || [])[1] || '';
  return compactList([
    ['厂站', kv['厂站名称'] || qval(/厂站名称[：:]\s*(\S+)/) || '—'], ['母线', kv['母线名称'] || qval(/母线名称[：:]\s*(\S+)/) || '—'],
    ['接地相别', kv['接地相别'] || qval(/接地相别[：:]\s*(\S+)/) || '—'], ['接地选线', kv['是否有接地选线'] || qval(/是否有接地选线[：:]\s*(\S+)/) || '—'],
    ['选线线路', kv['接地选线线路名称'] || qval(/接地选线线路名称[：:]\s*([^\n]+)/) || '—'], ['瞬时接地', kv['是否瞬时接地'] || qval(/是否瞬时接地[：:]\s*(\S+)/) || '—'],
  ]);
}

function collectCandidateLines(text, extraText, kv, opts) {
  const forceScan = !!(opts && opts.forceScan);
  const set = [];
  const norm = (s) =>
    String(s || '').replace(/^\s*[一二三四五六七八九十0-9]+\s*[、.．)）\]\s]+/, '').trim();
  const push = (s) => {
    const t = norm(s);
    if (!t || t.length < 2) return;
    if (/^(否|无|是|有)$/.test(t)) return;
    if (/母线/.test(t)) return;
    if (!set.includes(t)) set.push(t);
  };
  const kvArr = [
    kv && kv['接地选线线路名称'],
    (String(text) + '\n' + String(extraText || '')).match(/接地选线线路名称[：:]\s*([^\n]+)/)?.[1],
  ];
  kvArr.filter(Boolean).forEach((v) => String(v).split(/[\r\n，,、;；\s]+/).forEach(push));
  const bracketRe = /【\s*((?:10|20|35|110)kV[\u4e00-\u9fa5A-Za-z0-9-]*(?:支线|专线|线))\s*】/g;
  [text, extraText].forEach((src) => {
    let bm;
    while ((bm = bracketRe.exec(String(src || ''))) !== null) push(bm[1]);
  });
  if (forceScan) {
    const re = /(?:10|20|35|110)kV[\u4e00-\u9fa5A-Za-z0-9-]*(?:支线|专线|线)|[\u4e00-\u9fa5]{2,8}(?:支线|专线)/g;
    [text, extraText].forEach((src) => {
      let m;
      while ((m = re.exec(String(src || ''))) !== null) push(m[0]);
    });
  }
  return set;
}

function buildKpiRows(query, answer, mainType) {
  const src = `${query}\n${answer}`;
  const qkv = extractKV(query);
  const eventTime = findEventTime(src);
  const kpiLine = (src.match(/(10kV|20kV|35kV|110kV)[^\s，,]*/) || [''])[0] || '—';
  const kpiStation = ((src.match(/([\u4e00-\u9fa5]{2,8})站/) || ['', ''])[1] ? (src.match(/([\u4e00-\u9fa5]{2,8})站/)[1] + '站') : '—');
  if (mainType === '跳闸') {
    let loss = (src.match(/损失[\s\S]{0,8}电流[^0-9]{0,6}([0-9.\-]+)\s*A?/) || ['', '—'])[1] || '—';
    if (/^[\d.\-]+$/.test(loss)) loss += ' A';
    return [
      ['类型', mainType], ['厂站', kpiStation === '站' ? '—' : kpiStation], ['线路', kpiLine],
      ['事件时间', eventTime || qkv['动作时间'] || '—'], ['损失电流', loss],
      ['跳闸前接地', (src.match(/跳闸前[^，,]{0,10}(有接地|无接地|有|无)/) || ['', '—'])[1] || '—'],
    ];
  }
  if (mainType === '母线接地') {
    return [
      ['类型', mainType], ['厂站', qkv['厂站名称'] || kpiStation], ['母线', qkv['母线名称'] || '—'],
      ['接地相别', qkv['接地相别'] || '—'], ['事件时间', eventTime || '—'],
      ['候选线路', String(collectCandidateLines(query, answer, qkv, { forceScan: true }).length || '—')],
    ];
  }
  return [
    ['类型', '单线接地'], ['厂站', qkv['厂站名称'] || kpiStation], ['线路', kpiLine],
    ['接地相别', qkv['接地相别'] || '—'], ['事件时间', eventTime || '—'],
    ['Ua/Ub/Uc', `${qkv['Ua'] || '—'} / ${qkv['Ub'] || '—'} / ${qkv['Uc'] || '—'}`],
  ];
}

// 按“供电所概况 / 一、线路 / 试拉建议 / 信息同步”标题切分接口 answer
function parseAnswerBlocks(answer) {
  const lines = String(answer || '').split(/\r?\n/);
  const blocks = [];
  let cur = null;
  for (const raw of lines) {
    const line = raw.replace(/^\s+/, '').replace(/\s+$/, '');
    const m1 = line.match(/^([一二三四五六七八九十]+)\s*[、\.]\s*(.+)$/);
    const m2 = line.match(/^(供电所概况|试拉建议|信息同步)\s*[：:]?\s*$/);
    if (m1) { cur = { title: m1[2].trim(), lines: [] }; blocks.push(cur); continue; }
    if (m2) { cur = { title: m2[1], lines: [] }; blocks.push(cur); continue; }
    if (cur) cur.lines.push(line);
  }
  return blocks;
}

function parseMdTable(lines) {
  const tbl = lines.filter((l) => /^\|.*\|/.test(l.trim()));
  if (tbl.length < 2) return null;
  const split = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
  const headers = split(tbl[0]);
  const rows = tbl.slice(1).filter((l) => !/^[\s|:\-]+$/.test(l.trim())).map(split);
  if (!rows.length) return null;
  return { headers, rows };
}

// 大屏左上「线路详情」：按 “1./2./...” 子小节切分，区段字段按 ； 拆成键值行
function renderLineDetail(lines) {
  const subs = [];
  let cur = null;
  for (const raw of lines) {
    const line = raw.replace(/^\s+/, '').replace(/\s+$/, '');
    if (!line) continue;
    const m = line.match(/^(\d+)\s*[、\.]\s*(.+)$/);
    if (m) {
      const t = m[2].trim();
      const tm = t.match(/^(.+?)[：:]\s*(\S.*)$/);
      cur = {
        title: tm ? tm[1].trim() : t.replace(/[：:]\s*$/, ''),
        value: tm ? tm[2].trim() : '',
        body: [],
      };
      subs.push(cur);
      continue;
    }
    if (cur) cur.body.push(line);
  }
  // 「供电所联系人和电话」已在「供电所概况」模块完整展示，线路详情中跳过，避免两处重复
  const kept = subs.filter((s) => !/供电所联系人/.test(s.title));
  if (!kept.length) return '';

  const NONE = `<div class="ld-none">无</div>`;
  const mapsFromMd = (md) => md.rows.map((r) => {
    const o = {};
    md.headers.forEach((h, i) => { o[h] = r[i] != null ? r[i] : ''; });
    return o;
  });

  const segHtml = kept
    .map((s) => {
      const items = s.body.map((l) => l.trim()).filter(Boolean);
      const onlyNone = !s.value && (!items.length || (items.length === 1 && /^无$/.test(items[0])));
      if (onlyNone) {
        return `<div class="ld-sub"><div class="ld-sub-title">${esc(s.title)}</div>${NONE}</div>`;
      }
      const parts = [];
      if (s.value) parts.push(`<div class="ld-value">${esc(s.value)}</div>`);
      const md = parseMdTable(items);
      if (md) {
        const maps = mapsFromMd(md);
        const blank = maps.every((r) => md.headers.every((h) => isBlankCell(r[h])));
        if (blank) parts.push(NONE);
        else parts.push(renderRecordCards(md.headers, maps));
      } else {
        const records = [];
        const rest = [];
        items.forEach((l) => {
          const pairs = parseFieldPairs(l).filter(([, v]) => String(v || '').trim());
          if (pairs.length >= 2) records.push(pairs);
          else rest.push({ line: l, pairs });
        });
        if (records.length) {
          const headers = [];
          records.forEach((ps) => ps.forEach(([k]) => headers.includes(k) || headers.push(k)));
          parts.push(renderRecordCards(headers, records.map(pairsToMap)));
        }
        rest.forEach(({ line, pairs }) => {
          if (/^无$/.test(line)) parts.push(NONE);
          else if (pairs.length === 1) {
            parts.push(`<div class="ld-row"><span>${esc(pairs[0][0])}</span><b>${esc(pairs[0][1])}</b></div>`);
          } else parts.push(`<div class="ld-text">${esc(line)}</div>`);
        });
      }
      const body = parts.length ? parts.join('') : NONE;
      return `<div class="ld-sub"><div class="ld-sub-title">${esc(s.title)}</div>${body}</div>`;
    })
    .join('');

  return `<div class="ld-wrap">${segHtml}</div>`;
}

function parseAnswerSections(answer) {
  const lines = String(answer || '').split(/\r?\n/);
  const sections = [];
  let current = null;
  for (const raw of lines) {
    const line = raw.replace(/^\s+/, '').replace(/\s+$/, '');
    if (!line.trim()) continue;
    const m = line.match(/^([一二三四五六七八九十0-9]+)[、\.]\s*(.+)$/);
    if (m) {
      let title = m[2].trim().replace(/[：:]\s*$/, '');
      let extra = '';
      const tm = title.match(/^(.+?)[：:]\s*(\S.*)$/);
      if (tm) { title = tm[1].trim(); extra = tm[2]; }
      current = { title, lines: extra ? [extra] : [] };
      sections.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  return sections;
}

function renderKvList(pairs) {
  if (!pairs.length) return '';
  return `<div class="relay-list">${pairs.map(([k, v]) => `<div class="relay-item"><span class="relay-name">${esc(k)}</span><b class="relay-val">${esc(v)}</b></div>`).join('')}</div>`;
}

function renderNarrative(text) {
  const t = String(text || '').trim();
  if (!t) return '';
  return `<div class="narr">${esc(t)}</div>`;
}

function renderGroupBlock(title, lines) {
  const kv = [];
  const prose = [];
  lines.forEach((l) => {
    const pairs = parseFieldPairs(l);
    if (pairs.length === 1) kv.push(pairs[0]);
    else if (pairs.length >= 2) kv.push(...pairs.filter(([, v]) => String(v || '').trim()));
    else if (l.trim()) prose.push(l.trim());
  });
  return `<div class="relay-group"><div class="relay-group-title">${esc(title)}</div>${renderKvList(kv)}${prose.length ? renderNarrative(prose.join('\n')) : ''}</div>`;
}

function renderRowTables(lines) {
  const pure = lines.map((l) => String(l || '')).filter((l) => l.trim());
  const md = parseMdTable(pure);
  const rest = md ? pure.filter((l) => !/^\s*\|/.test(l)) : pure.slice();
  let html = '';
  if (md) {
    const maps = md.rows.map((r) => {
      const o = {};
      md.headers.forEach((h, i) => { o[h] = r[i] != null ? r[i] : ''; });
      return o;
    });
    const blank = maps.every((r) => md.headers.every((h) => isBlankCell(r[h])));
    if (blank) html += '<div class="empty">无</div>';
    else html += renderDataTable(md.headers, maps);
  }
  const records = [];
  const singles = [];
  const narratives = [];
  const groups = [];
  let curGroup = null;
  const flush = () => {
    if (curGroup && curGroup.lines.length) groups.push(curGroup);
    curGroup = null;
  };
  for (const l of rest) {
    const trimmed = l.trim();
    if (/^(?!\d+[、\.]|[一二三四五六七八九十]+[、\.])[^：:]{1,20}[：:]\s*$/.test(trimmed)) {
      flush();
      curGroup = { title: trimmed.replace(/[：:]\s*$/, '').trim(), lines: [] };
      continue;
    }
    if (curGroup) { curGroup.lines.push(trimmed); continue; }
    const pairs = parseFieldPairs(trimmed);
    if (pairs.length >= 2) records.push(pairs);
    else if (pairs.length === 1) singles.push(pairs[0]);
    else narratives.push(trimmed);
  }
  flush();
  if (records.length) {
    const headers = [];
    records.forEach((ps) => ps.forEach(([k]) => headers.includes(k) || headers.push(k)));
    html += renderDataTable(headers, records.map(pairsToMap));
  }
  if (singles.length) html += renderKvList(singles);
  if (narratives.length) html += renderNarrative(narratives.join('\n'));
  if (groups.length) html += groups.map((g) => renderGroupBlock(g.title, g.lines)).join('');
  return html;
}

// ---------------- HTML 组装（监测大屏） ----------------

const CSS = `
  :root{--bg:#06101f;--panel:#0a1628;--ink:#e6f4ff;--sub:#7a9ec4;--cyan:#00e5ff;--line:rgba(0,229,255,.35);--glow:rgba(0,229,255,.15);--red:#ff4d6a;--r:6px}
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:1920px;height:1080px;overflow:hidden;font-family:"PingFang SC","Microsoft YaHei",sans-serif;background:radial-gradient(ellipse 80% 50% at 50% -10%,rgba(0,100,180,.25),transparent),linear-gradient(180deg,#040a14 0%,#06101f 40%,#050d18 100%);color:var(--ink);-webkit-font-smoothing:antialiased}
  .screen{width:1920px;height:1080px;display:flex;flex-direction:column;padding:10px 14px 12px;gap:8px}
  .screen-head{position:relative;text-align:center;padding:6px 0 4px;flex-shrink:0}
  .screen-head::before,.screen-head::after{content:"";position:absolute;top:50%;width:28%;height:1px;background:linear-gradient(90deg,transparent,var(--cyan),transparent)}
  .screen-head::before{left:2%}.screen-head::after{right:2%}
  .screen-title{font-size:26px;font-weight:800;letter-spacing:3px;color:#fff;text-shadow:0 0 20px var(--glow)}
  .screen-sub{font-size:12px;color:var(--sub);margin-top:3px}
  .screen-sub .time-keep{white-space:nowrap}
  .kpi-strip{display:grid;grid-template-columns:repeat(6,1fr);gap:6px;flex-shrink:0}
  .stat-chip{background:var(--panel);border:1px solid var(--line);border-radius:var(--r);padding:6px 8px;text-align:center}
  .sc-val{font-size:15px;font-weight:800;color:var(--cyan);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .sc-lbl{font-size:10px;color:var(--sub);margin-top:2px}
  .screen-body{flex:1;min-height:0;display:flex;gap:10px}
  .screen-body.solo .line-stage{flex:1}
  .line-nav{width:188px;flex-shrink:0;display:flex;flex-direction:column;gap:8px;padding-top:4px}
  .line-nav-label{font-size:12px;color:var(--sub);padding:0 4px 4px;border-bottom:1px solid rgba(0,229,255,.2)}
  .line-pick{width:100%;text-align:left;padding:14px 12px;font-size:15px;font-weight:700;color:var(--sub);background:rgba(0,229,255,.05);border:1px solid rgba(0,229,255,.28);border-radius:var(--r);cursor:pointer;line-height:1.3}
  .line-pick.active{color:#001018;background:linear-gradient(135deg,#0088cc,var(--cyan));border-color:var(--cyan);box-shadow:0 0 14px var(--glow)}
  .line-stage{flex:1;min-width:0;min-height:0;position:relative}
  .line-page{display:none;position:absolute;inset:0;flex-direction:column}
  .line-page.active{display:flex}
  .page-grid{flex:1;min-height:0;display:grid;grid-template-columns:repeat(4,1fr);grid-auto-rows:minmax(0,1fr);gap:10px;overflow:auto}
  .panel{background:linear-gradient(135deg,rgba(10,22,40,.95),rgba(6,16,31,.98));border:1px solid var(--line);border-radius:var(--r);box-shadow:0 0 14px var(--glow);display:flex;flex-direction:column;min-height:0;overflow:hidden}
  .panel-h{flex-shrink:0;padding:10px 14px;font-size:15px;font-weight:700;color:var(--cyan);border-bottom:1px solid rgba(0,229,255,.2);display:flex;align-items:center;gap:8px;background:rgba(0,229,255,.04)}
  .panel-h i{display:inline-block;width:3px;height:16px;background:var(--cyan);box-shadow:0 0 6px var(--cyan)}
  .panel-b{flex:1;min-height:0;padding:12px 14px;font-size:14px;line-height:1.55;overflow:auto}
  .empty{color:var(--sub);text-align:center;padding:20px 0;font-size:14px}
  .narr{white-space:pre-wrap;word-break:break-word;font-size:14px;line-height:1.65}
  .sync-txt{font-size:14px;color:#d0e8ff}
  .clist{display:flex;flex-direction:column;gap:6px}
  .cl-row{display:flex;justify-content:space-between;gap:10px;padding:6px 8px;background:rgba(0,229,255,.04);border-radius:4px;font-size:14px}
  .cl-row span{color:var(--sub);flex-shrink:0}
  .cl-row b{color:#fff;font-weight:600;text-align:right;word-break:break-all}
  .flow-4{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;height:100%;align-content:center}
  .flow-step{text-align:center;padding:12px 8px;background:rgba(0,229,255,.05);border:1px solid rgba(0,229,255,.2);border-radius:var(--r)}
  .fs-n{width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#0088cc,var(--cyan));color:#001018;display:inline-flex;align-items:center;justify-content:center;font-weight:800;font-size:14px}
  .fs-v{margin-top:10px;font-size:16px;font-weight:700;color:#fff}
  .fs-l{font-size:11px;color:var(--sub);margin-top:3px}
  .ring-row{display:flex;justify-content:space-around;align-items:center;height:100%;gap:10px}
  .ring-box{position:relative;width:96px;height:96px}
  .ring-svg{width:96px;height:96px}
  .ring-track{fill:none;stroke:rgba(0,229,255,.12);stroke-width:8}
  .ring-arc{fill:none;stroke-width:8;stroke-linecap:round;filter:drop-shadow(0 0 4px currentColor)}
  .ring-center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
  .ring-center b{font-size:16px;font-weight:800}
  .ring-center span{font-size:11px;color:var(--sub);margin-top:2px}
  .hbar{display:grid;grid-template-columns:1.1fr 2fr auto;gap:8px;align-items:center;margin-bottom:8px;font-size:13px}
  .hb-lbl{color:var(--sub);line-height:1.35}
  .hb-track{height:10px;background:rgba(0,229,255,.1);border-radius:5px;overflow:hidden}
  .hb-fill{height:100%;background:linear-gradient(90deg,#0066aa,var(--cyan));border-radius:5px}
  .hb-val{color:var(--cyan);font-weight:700;font-size:12px;white-space:nowrap}
  .trial-head{font-size:13px;color:var(--cyan);margin-bottom:8px}
  .trial-row{display:grid;grid-template-columns:26px 1fr;gap:8px;align-items:start;margin-bottom:8px}
  .trial-n{width:24px;height:24px;border-radius:50%;background:var(--cyan);color:#001018;font-size:12px;font-weight:800;display:flex;align-items:center;justify-content:center}
  .trial-bar{grid-column:2;height:8px;background:rgba(0,229,255,.1);border-radius:4px;overflow:hidden}
  .trial-fill{height:100%;background:linear-gradient(90deg,#0066aa,var(--cyan))}
  .trial-txt{grid-column:2;font-size:13px;color:#c8dff5;line-height:1.45;margin-top:4px}
  .ld-seg{background:rgba(0,229,255,.04);border:1px solid rgba(0,229,255,.15);border-radius:4px;padding:8px 10px;margin-bottom:6px}
  .ld-row{display:flex;gap:8px;font-size:14px;padding:4px 0}
  .ld-row span{color:var(--sub);flex:0 0 8em}
  .ld-row b{color:var(--ink);font-weight:600;word-break:break-word}
  .ld-value.big{font-size:16px;font-weight:700;color:#fff;padding:8px 0}
  .ld-none,.ld-text{font-size:14px;color:var(--sub)}
  .relay-list{display:grid;grid-template-columns:repeat(2,1fr);gap:6px}
  .relay-item{display:flex;justify-content:space-between;gap:8px;background:rgba(0,229,255,.04);border:1px solid rgba(0,229,255,.12);border-radius:4px;padding:6px 10px;font-size:13px}
  .relay-name{color:var(--sub)}.relay-val{color:var(--cyan);font-weight:600;text-align:right}
  .relay-group{margin-top:8px;padding:8px 10px;border:1px solid rgba(0,229,255,.15);border-left:2px solid var(--cyan);border-radius:4px}
  .relay-group-title{font-size:13px;font-weight:700;color:var(--cyan);margin-bottom:6px}
  table.dt{width:100%;border-collapse:collapse;font-size:13px}
  table.dt th{background:rgba(0,229,255,.12);color:#fff;text-align:left;padding:6px 8px}
  table.dt td{padding:6px 8px;border-bottom:1px solid rgba(0,229,255,.1);word-break:break-word}
`;

function buildBodyHtml(query, answer, mainType) {
  if (mainType === '母线接地') {
    const pages = collectBusPages(query, answer);
    if (!pages.length) {
      return `<div class="screen-body solo"><div class="line-stage"><div class="line-page active">${renderPageGrid([])}</div></div></div>`;
    }
    const nav = pages.map((pg, i) =>
      `<button type="button" class="line-pick${i === 0 ? ' active' : ''}" data-i="${i}">${esc(pg.name)}</button>`
    ).join('');
    const stage = pages.map((pg, i) =>
      `<div class="line-page${i === 0 ? ' active' : ''}" data-i="${i}">${renderPageGrid(pg.panels)}</div>`
    ).join('');
    return `<div class="screen-body bus-mode"><nav class="line-nav"><div class="line-nav-label">线路选择</div>${nav}</nav><div class="line-stage">${stage}</div></div>`;
  }
  let panels;
  if (mainType === '跳闸') panels = collectTripPanels(query, answer);
  else panels = collectGroundPanels(query, answer);
  const syncIdx = panels.findIndex((p) => /信息同步/.test(p.title));
  if (syncIdx >= 0) {
    const [sync] = panels.splice(syncIdx, 1);
    panels.push(sync);
  }
  return `<div class="screen-body solo"><div class="line-stage"><div class="line-page active">${renderPageGrid(panels)}</div></div></div>`;
}

function buildHtml({ query, answer }) {
  const mainType = pickMain(query);
  const eventTime = findEventTime(`${query}\n${answer}`);
  const typeLabel = mainType === '接地' ? '单线接地' : mainType;
  const lineName = (String(answer || query).match(/(10kV|20kV|35kV|110kV)[\u4e00-\u9fa5A-Za-z0-9-]*/) || [''])[0] || '故障线路';
  const title = mainType === '母线接地'
    ? `${esc(extractKV(query)['厂站名称'] || '大珠山站')} ${esc(extractKV(query)['母线名称'] || '')} 母线接地监测大屏`
    : `${esc(lineName)} ${esc(typeLabel)}监测大屏`;
  const timeHtml = eventTime ? `<span class="time-keep">事件时间 ${esc(eventTime)}</span> · ` : '';
  const kpiHtml = buildKpiStrip(query, answer, mainType);
  const bodyHtml = buildBodyHtml(query, answer, mainType);
  const script = mainType === '母线接地' ? LINE_PICK_SCRIPT : '';
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=1920,height=1080"/>
<title>${title}</title>
<style>${CSS}</style>
</head>
<body>
  <div class="screen">
    <header class="screen-head">
      <div class="screen-title">${title}</div>
      <div class="screen-sub">${timeHtml}黄岛故障信息分析 · ${todayTime()}</div>
    </header>
    ${kpiHtml}
    ${bodyHtml}
  </div>${script}
</body>
</html>`;
}

// ---------------- 主流程 ----------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const args = process.argv.slice(2);
  let query = args.join(' ');
  if (!query) query = biz.readQueryFromFile();
  if (!query) {
    console.error('[错误] 缺少故障信息。用法: node gen_fault_html.js "<故障信息>"');
    process.exit(1);
  }

  // 可选：离线重渲染（FAULT_SEED_FILE 指向已保存的接口档案文件，跳过接口调用）
  let answer = '';
  const seedFile = process.env.FAULT_SEED_FILE;
  if (seedFile && fs.existsSync(seedFile)) {
    const seed = fs.readFileSync(seedFile, 'utf8').trim();
    if (seed) {
      answer = seed;
      console.log('[种子] 已载入离线 answer 文件，跳过接口调用');
    }
  }

  if (!answer) {
    // 内部重试：接口偶发空返回，最多尝试 maxAttempts 次（可用环境变量 FAULT_MAX_ATTEMPTS 覆盖）
    const maxAttempts = Math.max(1, parseInt(process.env.FAULT_MAX_ATTEMPTS || '4', 10) || 1);
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      console.log(`[开始] 调用接口获取原始数据... (第 ${attempt} 次)`);
      const apiResult = await biz.callChat(query);
      answer = (apiResult && apiResult.answer) || '';
      if (answer && answer.trim().length > 0) break;
      if (attempt < maxAttempts) {
        console.warn(`[重试] 第 ${attempt} 次返回为空，5 秒后重试...`);
        await sleep(5000);
      }
    }
  }

  if (!answer.trim()) console.warn('[警告] 接口未返回数据，将仅基于用户输入生成看板。');
  const html = buildHtml({ query, answer });

  const date = todayCompact();
  const mainType = pickMain(query);
  const fileName = `故障信息分析看板_${mainType}_${date}.html`;
  ensureOutDir();
  const outPath = path.join(WORKSPACE_DIR, fileName);
  fs.writeFileSync(outPath, html, 'utf8');

  console.log('='.repeat(60));
  console.log(`[完成] 已生成看板: ${fileName}`);
  console.log(`[路径] ${outPath}`);
  console.log(`[故障类型] ${mainType}`);
  console.log(`[接口返回] ${answer.length} 字`);
  console.log('='.repeat(60));
  console.log('\n===== 接口返回原始全文 =====');
  console.log(answer);
  console.log('============================= END');
}

main().catch((e) => {
  console.error('[错误]', e.message);
  process.exit(1);
});
