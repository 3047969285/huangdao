/** 黄岛故障看板 v11：培小e满屏三栏 + ECharts 撑满面板。FAULT_SEED_FILE 可离线重渲染。 */
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

// ---------------- 监测大屏 v10（培小e满屏三栏壳） ----------------

const KPI_COLORS = ['#2f9bff', '#33d17a', '#37c8e8', '#a96bf2', '#ff9f43', '#f7c948'];

function ringGauge(label, value, maxVal) {
  const n = numOf(value);
  const pct = n == null ? 0 : Math.max(0, Math.min(100, Math.round((n / (maxVal || 10)) * 100)));
  const low = n != null && n < 2;
  const r = 36;
  const c = 2 * Math.PI * r;
  const dash = (pct / 100) * c;
  const col = low ? '#ff6b6b' : '#2f9bff';
  return `<div class="ring-box${low ? ' low' : ''}"><svg viewBox="0 0 88 88" class="ring-svg"><circle cx="44" cy="44" r="${r}" class="ring-track"/><circle cx="44" cy="44" r="${r}" class="ring-arc" stroke="${col}" stroke-dasharray="${dash.toFixed(1)} ${(c - dash).toFixed(1)}" transform="rotate(-90 44 44)"/></svg><div class="ring-center"><b style="color:${col}">${esc(value || '—')}</b><span>${esc(label)}</span></div></div>`;
}

function hBarRow(label, val, max) {
  const n = numOf(val);
  const pct = n == null ? 8 : Math.max(8, Math.min(100, Math.round((n / (max || 1)) * 100)));
  const short = String(label || '').length > 24 ? String(label).slice(0, 22) + '…' : label;
  return `<div class="hbar"><span class="hb-lbl" title="${esc(label)}">${esc(short)}</span><div class="hb-track"><div class="hb-fill" style="width:${pct}%"></div></div><span class="hb-val">${esc(val)}</span></div>`;
}

function compactList(pairs) {
  if (!pairs.length) return '<div class="empty">无</div>';
  return `<div class="clist fill-y">${pairs.map(([k, v]) => `<div class="cl-row"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div>`;
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
  const bars = records.map((r) => {
    const lbl = r['杆号区段'] || r['起始点'] || r['区段描述'] || '区段';
    const val = r['穿越长度kM'] || r['通道长度公里'] || '—';
    const disp = String(val).includes('km') ? val : `${val}km`;
    return hBarRow(lbl, disp, maxLen);
  }).join('');
  return `<div class="bars-wrap fill-y">${bars}</div>`;
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

const chartInits = [];
let chartSeq = 0;

function resetCharts() {
  chartInits.length = 0;
  chartSeq = 0;
}

function nextChartId(prefix) {
  chartSeq += 1;
  return `${prefix || 'c'}_${chartSeq}`;
}

function findSection(answer, re) {
  const s = parseAnswerSections(answer).find((x) => re.test(x.title));
  return s || { title: '—', lines: [] };
}

function findBlock(answer, re) {
  const b = parseAnswerBlocks(answer).find((x) => re.test(x.title));
  return b || { title: '—', lines: [] };
}

function shortLbl(s, n) {
  const t = String(s || '').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function padBarSeries(cats, vals, minRows) {
  const c = cats.slice();
  const v = vals.slice();
  while (c.length < minRows) {
    c.push('');
    v.push(0);
  }
  return { cats: c, vals: v };
}

function extractForestBarData(lines) {
  const cats = [];
  const vals = [];
  lines.forEach((l) => {
    const pairs = parseFieldPairs(l);
    if (pairs.length >= 2) {
      const m = pairsToMap(pairs);
      const lbl = m['杆号区段'] || m['起始点'] || m['区段描述'] || '区段';
      const raw = m['穿越长度kM'] || m['通道长度公里'] || '0';
      cats.push(shortLbl(lbl, 14));
      vals.push(numOf(raw) || 0.1);
      return;
    }
    const t = String(l || '').trim();
    if (t && !/^无$/.test(t)) {
      cats.push(shortLbl(t, 14));
      vals.push(0.2);
    }
  });
  if (!cats.length) return padBarSeries(['暂无数据'], [0], 5);
  return padBarSeries(cats, vals, Math.max(5, cats.length));
}

function extractTrialBarData(lines) {
  const cats = [];
  const vals = [];
  lines.forEach((l) => {
    const t = String(l || '').trim();
    if (!t || /优先|其次|最后|协商|无穿越/.test(t)) return;
    const m = t.match(/^(\d+)[.、\s]+(.+)$/);
    const body = m ? m[2] : t;
    const km = (body.match(/([\d.]+)\s*(?:km|kM|公里)/i) || [])[1];
    cats.push(shortLbl(body, 18));
    vals.push(km ? parseFloat(km) : Math.max(0.3, 4 - (parseInt(m && m[1], 10) || 1) * 0.6));
  });
  if (!cats.length) return padBarSeries(['暂无试拉建议'], [0], 5);
  return padBarSeries(cats, vals, Math.max(5, cats.length));
}

function buildHBarOption(cats, vals, color) {
  const { cats: yc, vals: vd } = padBarSeries(cats, vals, Math.max(5, cats.length));
  const cols = ['#ff6b6b', '#ff9f43', '#f7c948', '#37c8e8', '#2f9bff', '#a96bf2', '#67e0a3'];
  return {
    grid: { left: 4, right: 40, top: 6, bottom: 4, containLabel: true },
    xAxis: { type: 'value', show: false },
    yAxis: {
      type: 'category', inverse: true, data: yc, boundaryGap: true,
      axisLine: { lineStyle: { color: 'rgba(64,158,255,.35)' } },
      axisLabel: { color: '#a9cbe4', fontSize: 10.5 },
      axisTick: { show: false },
    },
    series: [{
      type: 'bar', data: vd, barWidth: 12, barMaxWidth: 26, barCategoryGap: '38%',
      label: { show: true, position: 'right', color: '#7fd4ff', fontSize: 10, formatter: (p) => (p.value ? `${p.value}km` : '') },
      itemStyle: {
        borderRadius: 5,
        color: color || ((p) => cols[p.dataIndex % cols.length]),
      },
    }],
  };
}

function buildTripLeftOption(query) {
  const kv = extractKV(query);
  const cats = ['保护动作', '跳闸前接地', '跳闸后复归', '损失电流', '保护装置', '动作类型'];
  const vals = [
    numOf(kv['动作类型']) || 8,
    /有/.test(kv['跳闸前接地情况'] || '') ? 7 : 3,
    /复归|消失/.test(kv['跳闸后接地复归情况'] || '') ? 6 : 4,
    numOf(kv['损失负荷电流']) || 1,
    5,
    6,
  ];
  return buildHBarOption(cats, vals, '#2f9bff');
}

function buildGroundLeftOption(query) {
  const kv = extractKV(query);
  const text = String(query || '');
  const ua = numOf(kv['Ua'] || /Ua[：:]\s*([^\s，,；;（(]+)/.exec(text)?.[1]) || 0;
  const ub = numOf(kv['Ub'] || /Ub[：:]\s*([^\s，,；;（(]+)/.exec(text)?.[1]) || 10;
  const uc = numOf(kv['Uc'] || /Uc[：:]\s*([^\s，,；;（(]+)/.exec(text)?.[1]) || 10;
  const cats = ['Ua', 'Ub', 'Uc', '接地相别', '接地选线', '瞬时接地'];
  const vals = [ua, ub, uc, 5, /有|是/.test(kv['是否有接地选线'] || '') ? 7 : 2, /是/.test(kv['是否瞬时接地'] || '') ? 6 : 3];
  return buildHBarOption(cats, vals, '#37c8e8');
}

function buildBusLeftOption(query) {
  const kv = extractKV(query);
  const cats = ['厂站', '母线', '接地相别', '接地选线', '选线线路', '瞬时接地'];
  const vals = [8, 9, 6, /有|是/.test(kv['是否有接地选线'] || '') ? 7 : 3, 5, /是/.test(kv['是否瞬时接地'] || '') ? 4 : 2];
  return buildHBarOption(cats, vals, '#33d17a');
}

function buildArchiveTableHtml(answer, skipRe) {
  const rows = [];
  parseAnswerSections(answer).forEach((s) => {
    if (skipRe && skipRe.test(s.title)) return;
    if (/信息同步|穿越|密集|试拉/.test(s.title)) return;
    if (/联系人/.test(s.title)) {
      s.lines.forEach((l) => {
        const pairs = parseFieldPairs(l);
        if (pairs.length >= 2) {
          const m = pairsToMap(pairs);
          Object.keys(m).forEach((k) => rows.push([k, m[k], s.title]));
        }
      });
      return;
    }
    s.lines.forEach((l) => {
      const t = String(l || '').trim();
      if (!t || /^无$/.test(t)) return;
      const pairs = parseFieldPairs(t);
      if (pairs.length === 1) rows.push([pairs[0][0], pairs[0][1], s.title]);
      else if (pairs.length >= 2) {
        const m = pairsToMap(pairs);
        Object.keys(m).forEach((k) => rows.push([k, m[k], s.title]));
      } else rows.push([s.title, t, '档案']);
    });
  });
  if (!rows.length) return '<div class="empty">无</div>';
  const body = rows.map((r) => `<tr><td>${esc(r[2])}</td><td class="nm">${esc(r[0])}</td><td>${esc(r[1])}</td></tr>`).join('');
  return `<table><thead><tr><th>板块</th><th>项目</th><th>内容</th></tr></thead><tbody>${body}</tbody></table>`;
}

function mkChartPanel(title, option, opts) {
  const id = nextChartId('c');
  chartInits.push({ id, option });
  const em = opts && opts.em ? `<em>${esc(opts.em)}</em>` : '';
  const flex = opts && opts.flex ? ` style="flex:${opts.flex}"` : '';
  return `<div class="panel"${flex}><div class="pt"><i></i><b>${esc(title)}</b>${em}</div><div class="pc"><div class="chart" id="${id}"></div></div></div>`;
}

function mkTablePanel(title, tableHtml, opts) {
  const em = opts && opts.em ? `<em>${esc(opts.em)}</em>` : '';
  const flex = opts && opts.flex ? ` style="flex:${opts.flex}"` : '';
  return `<div class="panel"${flex}><div class="pt"><i></i><b>${esc(title)}</b>${em}</div><div class="pc"><div class="tbl">${tableHtml}</div></div></div>`;
}

function mkNavPanel(title, innerHtml, opts) {
  const em = opts && opts.em ? `<em>${esc(opts.em)}</em>` : '';
  const flex = opts && opts.flex ? ` style="flex:${opts.flex}"` : '';
  return `<div class="panel"${flex}><div class="pt"><i></i><b>${esc(title)}</b>${em}</div><div class="pc"><div class="tbl nav-tbl">${innerHtml}</div></div></div>`;
}

function buildPageLayout(query, answer, mainType) {
  const forest = findSection(answer, /穿越/);
  const dense = findSection(answer, /密集/);
  const trial = findSection(answer, /试拉/);
  let leftTitle = '故障概况';
  let leftOpt = buildHBarOption(['暂无'], [0], '#2f9bff');
  if (mainType === '跳闸') {
    leftTitle = '跳闸概况';
    leftOpt = buildTripLeftOption(query);
  } else if (mainType === '接地') {
    leftTitle = '接地概况';
    leftOpt = buildGroundLeftOption(query);
  } else {
    leftTitle = '母线概况';
    leftOpt = buildBusLeftOption(query);
  }
  const center = [];
  if (forest.lines.length || /穿越/.test(forest.title)) {
    const d = extractForestBarData(forest.lines);
    center.push({ title: forest.title, option: buildHBarOption(d.cats, d.vals), flex: center.length ? '1.25' : '1' });
  }
  if (dense.lines.length || /密集/.test(dense.title)) {
    const d = extractForestBarData(dense.lines);
    center.push({ title: dense.title, option: buildHBarOption(d.cats, d.vals, '#5ee7a0'), flex: '1.35' });
  }
  if (trial.lines.length || /试拉/.test(trial.title)) {
    const d = extractTrialBarData(trial.lines);
    center.push({ title: trial.title, option: buildHBarOption(d.cats, d.vals, '#ff9f43'), flex: center.length > 1 ? '1.35' : '1.25' });
  }
  if (!center.length) center.push({ title: '区段分析', option: buildHBarOption(['暂无'], [0]), flex: '1' });
  if (center.length === 1) center[0].flex = '1';
  else if (center.length === 2) { center[0].flex = '1.25'; center[1].flex = '1.35'; }
  else if (center.length >= 3) { center[0].flex = '1.2'; center[1].flex = '1.2'; center[2].flex = '1.2'; }
  const tableHtml = buildArchiveTableHtml(answer, mainType === '跳闸' ? /试拉/ : null);
  const sync = findSection(answer, /信息同步/);
  return { leftTitle, leftOpt, center, tableHtml, sync };
}

function renderThreeColumnsFromLayout(layout) {
  const left = mkChartPanel(layout.leftTitle, layout.leftOpt, { flex: '1' });
  const mid = layout.center.map((p) => mkChartPanel(p.title, p.option, { flex: p.flex })).join('');
  const right = mkTablePanel('线路档案', layout.tableHtml, { flex: '1', em: '明细' });
  return `<div class="main"><div class="col col-left">${left}</div><div class="col col-mid">${mid}</div><div class="col col-right">${right}</div></div>`;
}

function renderBusContentColsFromLayout(layout) {
  const mid = layout.center.map((p) => mkChartPanel(p.title, p.option, { flex: p.flex })).join('');
  const right = mkTablePanel('线路档案', layout.tableHtml, { flex: '1', em: '明细' });
  return `<div class="content-cols"><div class="col col-mid">${mid}</div><div class="col col-right">${right}</div></div>`;
}

function buildChartBootScript() {
  if (!chartInits.length) return '';
  const payload = chartInits.map((c) => `mk("${c.id}",${JSON.stringify(c.option)});`).join('');
  return `<script src="https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js"></script><script>
function mk(id,opt){var el=document.getElementById(id);if(!el||typeof echarts==="undefined")return;var c=echarts.init(el);c.setOption(opt);addEventListener("resize",function(){c.resize();});}
${payload}
setTimeout(function(){document.querySelectorAll(".chart").forEach(function(el){var c=echarts.getInstanceByDom(el);if(c)c.resize();});},120);
</script>`;
}

function buildBusLineLayout(query, answer, lineLines, trialLines) {
  const subs = parseLineSubs(lineLines);
  const center = [];
  subs.forEach((sub) => {
    if (/穿越|密集/.test(sub.title)) {
      const src = sub.body.length ? sub.body : (sub.value ? [sub.value] : []);
      const d = extractForestBarData(src);
      center.push({
        title: sub.title,
        option: buildHBarOption(d.cats, d.vals, /穿越/.test(sub.title) ? '#2f9bff' : '#5ee7a0'),
        flex: '1.25',
      });
    }
  });
  if (trialLines && trialLines.length) {
    const d = extractTrialBarData(trialLines);
    center.push({ title: '试拉建议', option: buildHBarOption(d.cats, d.vals, '#ff9f43'), flex: '1.35' });
  }
  if (!center.length) center.push({ title: '区段分析', option: buildHBarOption(['暂无'], [0]), flex: '1' });
  if (center.length === 1) center[0].flex = '1';
  else if (center.length === 2) { center[0].flex = '1.25'; center[1].flex = '1.35'; }
  const rows = [];
  subs.forEach((sub) => {
    if (/穿越|密集/.test(sub.title)) return;
    if (sub.value) rows.push([sub.title, sub.title, sub.value]);
    sub.body.forEach((l) => {
      const t = String(l || '').trim();
      if (!t || /^无$/.test(t)) return;
      const pairs = parseFieldPairs(t);
      if (pairs.length === 1) rows.push([sub.title, pairs[0][0], pairs[0][1]]);
      else if (pairs.length >= 2) {
        const m = pairsToMap(pairs);
        Object.keys(m).forEach((k) => rows.push([sub.title, k, m[k]]));
      } else rows.push([sub.title, sub.title, t]);
    });
  });
  const tableHtml = rows.length
    ? `<table><thead><tr><th>板块</th><th>项目</th><th>内容</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(r[0])}</td><td class="nm">${esc(r[1])}</td><td>${esc(r[2])}</td></tr>`).join('')}</tbody></table>`
    : '<div class="empty">无</div>';
  return {
    leftTitle: '母线概况',
    leftOpt: buildBusLeftOption(query),
    center,
    tableHtml,
    sync: findBlock(answer, /信息同步/),
  };
}

function buildTickerHtml(answer, syncPanel) {
  let text = '';
  if (syncPanel && syncPanel.raw) text = syncPanel.raw;
  else {
    const s = parseAnswerSections(answer).find((x) => /信息同步/.test(x.title));
    if (s) text = s.lines.join(' ').trim();
    if (!text) {
      const b = parseAnswerBlocks(answer).find((x) => /信息同步/.test(x.title));
      if (b) text = b.lines.join(' ').trim();
    }
  }
  if (!text) text = '黄岛故障信息分析监测平台';
  return `<div class="ticker"><div class="tl">信息同步</div><div class="tv"><span>${esc(text)}</span></div></div>`;
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
      pages.push({ name: t, panels, lines: b.lines });
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

const LINE_PICK_SCRIPT = `<script>(function(){var btns=document.querySelectorAll(".line-pick"),pages=document.querySelectorAll(".line-page");btns.forEach(function(b){b.addEventListener("click",function(){var i=b.getAttribute("data-i");btns.forEach(function(x){x.classList.remove("active");});pages.forEach(function(p){p.classList.remove("active");});b.classList.add("active");var pg=document.querySelector('.line-page[data-i="'+i+'"]');if(pg){pg.classList.add("active");pg.querySelectorAll(".chart").forEach(function(el){var c=typeof echarts!=="undefined"?echarts.getInstanceByDom(el):null;if(c)c.resize();});}});});})();</script>`;

const CLOCK_SCRIPT = `<script>(function(){function tick(){var n=new Date(),p=function(s){return String(s).padStart(2,"0")};var el=document.getElementById("clk"),dt=document.getElementById("dt");if(el)el.textContent=p(n.getHours())+":"+p(n.getMinutes())+":"+p(n.getSeconds());if(dt)dt.textContent=n.getFullYear()+"-"+p(n.getMonth()+1)+"-"+p(n.getDate());}tick();setInterval(tick,1000);})();</script>`;

function buildKpiStrip(query, answer, mainType) {
  const rows = buildKpiRows(query, answer, mainType);
  return `<div class="kpis">${rows.map(([k, v], i) => {
    const c = KPI_COLORS[i % KPI_COLORS.length];
    return `<div class="kpi" style="--kc:${c};--kg:${c}55"><div class="kv">${esc(v || '—')}</div><div class="kl">${esc(k)}</div></div>`;
  }).join('')}</div>`;
}

function buildTripFlow(query) {
  const kv = extractKV(query);
  const steps = [['保护动作', kv['动作类型'] || '—'], ['跳闸前接地', kv['跳闸前接地情况'] || '—'], ['跳闸后复归', kv['跳闸后接地复归情况'] || '—'], ['损失电流', kv['损失负荷电流'] || '—']];
  return `<div class="flow-v fill-y">${steps.map(([l, v], i) => `<div class="flow-step"><div class="fs-n">${i + 1}</div><div class="fs-body"><div class="fs-v">${esc(v)}</div><div class="fs-l">${esc(l)}</div></div></div>`).join('')}</div>`;
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
  return `<div class="ring-row fill-y">${ringGauge('Ua', ua, 10)}${ringGauge('Ub', ub, 10)}${ringGauge('Uc', uc, 10)}</div>`;
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
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:100%;height:100%;overflow:hidden;font-family:"Microsoft YaHei","PingFang SC",sans-serif;background:#03121f;color:#cfe6f7;position:relative}
  .bg{position:fixed;inset:0;z-index:0;background:
    radial-gradient(ellipse at 50% -10%,rgba(24,90,150,.35),transparent 55%),
    radial-gradient(ellipse at 15% 100%,rgba(16,70,120,.25),transparent 50%),
    radial-gradient(ellipse at 85% 100%,rgba(16,70,120,.25),transparent 50%)}
  .bg::after{content:"";position:absolute;inset:0;background-image:linear-gradient(rgba(64,158,255,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(64,158,255,.05) 1px,transparent 1px);background-size:46px 46px}
  .wrap{position:relative;z-index:1;min-height:100%;height:100%;display:flex;flex-direction:column;padding:0 18px 10px}
  .hd{flex:0 0 auto;display:grid;grid-template-columns:210px 1fr 210px;align-items:center;padding:16px 0 6px}
  .hd-center{text-align:center;min-width:0}
  .hd h1{font-size:clamp(20px,2.2vw,32px);letter-spacing:6px;font-weight:700;color:#fff;text-shadow:0 0 18px rgba(45,140,255,.8),0 0 40px rgba(45,140,255,.4)}
  .hd .deco{height:12px;margin:6px auto 0;max-width:1400px;background:radial-gradient(ellipse at 50% 0,rgba(64,170,255,.55),transparent 70%);position:relative}
  .hd .deco::before{content:"";position:absolute;left:0;right:0;top:5px;height:2px;background:linear-gradient(90deg,transparent,#2f9bff 30%,#7fd4ff 50%,#2f9bff 70%,transparent);box-shadow:0 0 12px #2f9bff}
  .hd .badge{display:inline-block;border:1px solid rgba(64,158,255,.45);color:#7fc3ff;border-radius:3px;font-size:11px;padding:2px 10px;margin:6px 4px 0;letter-spacing:1px;background:rgba(20,60,100,.25)}
  .hd .clock{text-align:right;font-size:12px;color:#7fb6dd;line-height:1.7;justify-self:end;padding-right:8px}
  .hd .clock b{font-size:18px;color:#eaf6ff;font-family:Consolas,monospace;letter-spacing:1px}
  .hd .logo{display:flex;align-items:center;gap:8px;justify-self:start;padding-left:14px}
  .hd .logo .mark{width:34px;height:34px;border-radius:50%;border:2px solid #2f9bff;display:flex;align-items:center;justify-content:center;color:#7fd4ff;font-size:11px;font-weight:700;box-shadow:0 0 12px rgba(47,155,255,.6)}
  .hd .logo span{font-size:12px;color:#8db8dc;letter-spacing:2px;line-height:1.5;text-align:left}
  .kpis{flex:0 0 auto;display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin:10px 0}
  .kpi{position:relative;background:linear-gradient(180deg,rgba(14,44,76,.85),rgba(8,26,46,.85));border:1px solid rgba(64,158,255,.28);padding:12px 4px 10px;text-align:center;clip-path:polygon(10px 0,100% 0,100% calc(100% - 10px),calc(100% - 10px) 100%,0 100%,0 10px)}
  .kpi::before{content:"";position:absolute;top:0;left:12%;right:12%;height:2px;background:linear-gradient(90deg,transparent,var(--kc,#2f9bff),transparent)}
  .kv{font-size:clamp(18px,1.8vw,28px);font-weight:700;color:var(--kc,#2f9bff);text-shadow:0 0 14px var(--kg,rgba(47,155,255,.5));font-family:"DIN Alternate",Consolas,"Microsoft YaHei",monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .kl{font-size:11px;color:#7ea6c8;margin-top:5px;letter-spacing:0}
  .main{flex:1;min-height:0;display:grid;grid-template-columns:23% 1fr 26%;gap:12px}
  .main.bus-main{grid-template-columns:23% 1fr}
  .content-wrap{min-height:0;min-width:0;height:100%;display:flex;flex-direction:column}
  .col{display:flex;flex-direction:column;gap:12px;min-height:0;min-width:0;height:100%}
  .line-stage{flex:1;min-height:0;position:relative;height:100%}
  .line-page{display:none;position:absolute;inset:0}
  .line-page.active{display:block}
  .content-cols{position:absolute;inset:0;display:grid;grid-template-columns:1fr 34%;gap:12px;height:100%}
  .panel{flex:1;min-height:0;min-width:0;display:flex;flex-direction:column;background:linear-gradient(180deg,rgba(10,34,58,.9),rgba(6,20,38,.92));border:1px solid rgba(64,158,255,.22);position:relative}
  .panel::before,.panel::after{content:"";position:absolute;width:14px;height:14px;border-color:#3fa2ff;border-style:solid;z-index:2;pointer-events:none}
  .panel::before{top:-1px;left:-1px;border-width:2px 0 0 2px}
  .panel::after{bottom:-1px;right:-1px;border-width:0 2px 2px 0}
  .pt{flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid rgba(64,158,255,.18);background:linear-gradient(90deg,rgba(47,155,255,.16),transparent 65%)}
  .pt i{width:4px;height:14px;background:linear-gradient(#7fd4ff,#2f9bff);box-shadow:0 0 8px #2f9bff}
  .pt b{font-size:13.5px;color:#dff0ff;letter-spacing:2px;font-weight:600}
  .pt em{margin-left:auto;font-style:normal;font-size:10.5px;color:#5d89ad;letter-spacing:1px}
  .pc{flex:1;min-height:0;position:relative}
  .chart{position:absolute;inset:0}
  .tbl{position:absolute;inset:0;overflow:auto;padding:0 8px 8px;font-size:11px;line-height:1.45}
  .tbl::-webkit-scrollbar{width:4px}.tbl::-webkit-scrollbar-thumb{background:rgba(64,158,255,.35)}
  .nav-tbl{padding:8px 6px}
  table{width:100%;border-collapse:collapse}
  th{position:sticky;top:0;background:#0d2c4a;color:#7fc3ff;padding:6px 4px;font-weight:600;letter-spacing:1px;border-bottom:1px solid rgba(64,158,255,.35);z-index:1}
  td{padding:5px 4px;text-align:center;color:#a9cbe4;border-bottom:1px dashed rgba(64,158,255,.12)}
  tr:nth-child(even) td{background:rgba(20,60,100,.15)}
  td.nm{color:#eaf6ff;font-weight:600}
  .fill-y{min-height:100%;height:100%;display:flex;flex-direction:column}
  .line-nav-inner{display:flex;flex-direction:column;gap:10px;height:100%;padding:2px}
  .line-pick{position:relative;flex:1;min-height:52px;display:flex;align-items:center;width:100%;text-align:left;padding:14px 12px;font-size:14px;font-weight:600;line-height:1.4;color:#7ea6c8;cursor:pointer;background:linear-gradient(180deg,rgba(14,44,76,.85),rgba(8,26,46,.85));border:1px solid rgba(64,158,255,.28);clip-path:polygon(10px 0,100% 0,100% calc(100% - 10px),calc(100% - 10px) 100%,0 100%,0 10px)}
  .line-pick::before{content:"";position:absolute;top:0;left:10%;right:10%;height:2px;background:linear-gradient(90deg,transparent,rgba(64,158,255,.35),transparent)}
  .line-pick.active{color:#7fd4ff;border-color:rgba(64,158,255,.55);box-shadow:0 0 14px rgba(47,155,255,.45);background:linear-gradient(180deg,rgba(20,60,100,.9),rgba(12,36,62,.9))}
  .line-pick.active::before{background:linear-gradient(90deg,transparent,#2f9bff,transparent)}
  .bars-wrap{flex:1;display:flex;flex-direction:column;justify-content:space-evenly;min-height:100%}
  .empty{color:#5d89ad;display:flex;align-items:center;justify-content:center;min-height:100%;font-size:13px}
  .narr{white-space:pre-wrap;word-break:break-word;font-size:13px;line-height:1.65;color:#a9cbe4}
  .sync-txt{font-size:13px;color:#9fc4de}
  .clist{gap:0;justify-content:space-evenly}
  .clist .cl-row{flex:1;display:flex;align-items:center}
  .cl-row{display:flex;justify-content:space-between;gap:10px;padding:6px 8px;background:rgba(20,60,100,.15);border-bottom:1px dashed rgba(64,158,255,.12);font-size:13px}
  .cl-row span{color:#7ea6c8;flex-shrink:0}
  .cl-row b{color:#eaf6ff;font-weight:600;text-align:right;word-break:break-all}
  .flow-v{justify-content:space-evenly;gap:8px}
  .flow-step{flex:1;display:grid;grid-template-columns:36px 1fr;gap:10px;align-items:center;padding:10px;background:rgba(20,60,100,.2);border:1px solid rgba(64,158,255,.22)}
  .fs-n{width:32px;height:32px;border-radius:50%;background:linear-gradient(#7fd4ff,#2f9bff);color:#03121f;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px;box-shadow:0 0 10px rgba(47,155,255,.5)}
  .fs-v{font-size:15px;font-weight:700;color:#eaf6ff}
  .fs-l{font-size:11px;color:#7ea6c8;margin-top:2px}
  .merge-seg{margin-bottom:12px;padding-bottom:10px;border-bottom:1px dashed rgba(64,158,255,.15)}
  .merge-seg:last-child{border-bottom:none;margin-bottom:0;padding-bottom:0}
  .merge-h{font-size:12px;font-weight:700;color:#7fd4ff;margin-bottom:8px;letter-spacing:1px}
  .ticker{flex:0 0 auto;border:1px solid rgba(64,158,255,.22);background:rgba(8,26,46,.9);display:flex;align-items:center;overflow:hidden;height:34px}
  .ticker .tl{flex:0 0 auto;padding:0 14px;height:100%;display:flex;align-items:center;background:linear-gradient(90deg,#134a7c,#0d2c4a);color:#7fd4ff;font-size:12px;letter-spacing:2px;border-right:1px solid rgba(64,158,255,.35)}
  .ticker .tv{flex:1;white-space:nowrap;overflow:hidden}
  .ticker .tv span{display:inline-block;padding-left:100%;font-size:12px;color:#9fc4de;animation:mv 38s linear infinite}
  @keyframes mv{to{transform:translateX(-100%)}}
  .ring-row{justify-content:space-evenly;align-items:center;gap:10px}
  .ring-box{position:relative;width:96px;height:96px}
  .ring-svg{width:96px;height:96px}
  .ring-track{fill:none;stroke:rgba(64,158,255,.15);stroke-width:8}
  .ring-arc{fill:none;stroke-width:8;stroke-linecap:round;filter:drop-shadow(0 0 4px currentColor)}
  .ring-center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
  .ring-center b{font-size:16px;font-weight:800}
  .ring-center span{font-size:11px;color:#7ea6c8;margin-top:2px}
  .hbar{display:grid;grid-template-columns:1.1fr 2fr auto;gap:8px;align-items:center;margin-bottom:0;font-size:12px;flex:1}
  .hb-lbl{color:#7ea6c8;line-height:1.35}
  .hb-track{height:9px;background:rgba(64,158,255,.12);border-radius:4px;overflow:hidden}
  .hb-fill{height:100%;background:linear-gradient(90deg,#1565c0,#4fc3f7);border-radius:4px;box-shadow:0 0 6px rgba(79,195,247,.4)}
  .hb-val{color:#7fd4ff;font-weight:700;font-size:11px;white-space:nowrap}
  .trial-head{font-size:12px;color:#7fd4ff;margin-bottom:8px}
  .trial-row{display:grid;grid-template-columns:26px 1fr;gap:8px;align-items:start;margin-bottom:8px}
  .trial-n{width:24px;height:24px;border-radius:50%;background:linear-gradient(#7fd4ff,#2f9bff);color:#03121f;font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center}
  .trial-bar{grid-column:2;height:8px;background:rgba(64,158,255,.12);border-radius:4px;overflow:hidden}
  .trial-fill{height:100%;background:linear-gradient(90deg,#1565c0,#4fc3f7)}
  .trial-txt{grid-column:2;font-size:12px;color:#a9cbe4;line-height:1.45;margin-top:4px}
  .ld-seg{background:rgba(20,60,100,.15);border:1px solid rgba(64,158,255,.15);padding:8px 10px;margin-bottom:6px}
  .ld-row{display:flex;gap:8px;font-size:13px;padding:4px 0;border-bottom:1px dashed rgba(64,158,255,.1)}
  .ld-row span{color:#7ea6c8;flex:0 0 8em}
  .ld-row b{color:#eaf6ff;font-weight:600;word-break:break-word}
  .ld-value.big{font-size:16px;font-weight:700;color:#eaf6ff;padding:8px 0}
  .ld-none,.ld-text{font-size:13px;color:#7ea6c8}
  .relay-list{display:grid;grid-template-columns:repeat(2,1fr);gap:6px}
  .relay-item{display:flex;justify-content:space-between;gap:8px;background:rgba(20,60,100,.15);border:1px solid rgba(64,158,255,.15);padding:6px 10px;font-size:12px}
  .relay-name{color:#7ea6c8}.relay-val{color:#7fd4ff;font-weight:600;text-align:right}
  .relay-group{margin-top:8px;padding:8px 10px;border:1px solid rgba(64,158,255,.15);border-left:2px solid #2f9bff}
  .relay-group-title{font-size:12px;font-weight:700;color:#7fd4ff;margin-bottom:6px}
  table.dt{width:100%;border-collapse:collapse;font-size:12px}
  table.dt th{background:#0d2c4a;color:#7fc3ff;padding:6px 8px;font-weight:600;border-bottom:1px solid rgba(64,158,255,.35)}
  table.dt td{padding:6px 8px;color:#a9cbe4;border-bottom:1px dashed rgba(64,158,255,.12);word-break:break-word}
  tr:nth-child(even) td{background:rgba(20,60,100,.15)}
`;

function buildBodyHtml(query, answer, mainType) {
  if (mainType === '母线接地') {
    const pages = collectBusPages(query, answer);
    const syncSec = parseAnswerBlocks(answer).find((b) => /信息同步/.test(b.title));
    const sync = syncSec ? { raw: syncSec.lines.join(' ').trim() } : null;
    const trialBlock = parseAnswerBlocks(answer).find((b) => /试拉/.test(b.title));
    const trialLines = trialBlock ? trialBlock.lines : [];
    if (!pages.length) {
      const empty = buildPageLayout(query, answer, mainType);
      return { main: renderThreeColumnsFromLayout(empty), ticker: buildTickerHtml(answer, sync) };
    }
    const nav = pages.map((pg, i) =>
      `<button type="button" class="line-pick${i === 0 ? ' active' : ''}" data-i="${i}">${esc(pg.name)}</button>`
    ).join('');
    const stage = pages.map((pg, i) => {
      const layout = buildBusLineLayout(query, answer, pg.lines, trialLines);
      return `<div class="line-page${i === 0 ? ' active' : ''}" data-i="${i}">${renderBusContentColsFromLayout(layout)}</div>`;
    }).join('');
    const main = `<div class="main bus-main">
      <div class="col col-nav">${mkNavPanel('线路选择', `<div class="line-nav-inner">${nav}</div>`, { em: `${pages.length}条`, flex: '1' })}</div>
      <div class="content-wrap"><div class="line-stage">${stage}</div></div>
    </div>`;
    return { main, ticker: buildTickerHtml(answer, sync) };
  }
  const layout = buildPageLayout(query, answer, mainType);
  return { main: renderThreeColumnsFromLayout(layout), ticker: buildTickerHtml(answer, layout.sync) };
}

function buildHtml({ query, answer }) {
  resetCharts();
  const mainType = pickMain(query);
  const eventTime = findEventTime(`${query}\n${answer}`);
  const typeLabel = mainType === '接地' ? '单线接地' : mainType;
  const lineName = (String(answer || query).match(/(10kV|20kV|35kV|110kV)[\u4e00-\u9fa5A-Za-z0-9-]*/) || [''])[0] || '故障线路';
  const title = mainType === '母线接地'
    ? `${esc(extractKV(query)['厂站名称'] || '大珠山站')} ${esc(extractKV(query)['母线名称'] || '')} 母线接地监测大屏`
    : `${esc(lineName)} ${esc(typeLabel)}监测大屏`;
  const now = todayTime();
  const clk = now.split(' ')[1] || '';
  const dt = now.split(' ')[0] || '';
  const kpiHtml = buildKpiStrip(query, answer, mainType);
  const { main: mainHtml, ticker: tickerHtml } = buildBodyHtml(query, answer, mainType);
  const script = buildChartBootScript() + (mainType === '母线接地' ? LINE_PICK_SCRIPT : '') + CLOCK_SCRIPT;
  const badge = eventTime ? `<div class="badge">事件 ${esc(eventTime)}</div>` : '';
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title}</title>
<style>${CSS}</style>
</head>
<body>
<div class="bg"></div>
<div class="wrap">
  <div class="hd">
    <div class="logo"><div class="mark">HD</div><span>黄岛<br>故障信息分析</span></div>
    <div class="hd-center">
      <h1>${title}</h1>
      <div class="deco"></div>
      ${badge}
    </div>
    <div class="clock"><b id="clk">${esc(clk)}</b><br><span id="dt">${esc(dt)}</span></div>
  </div>
  ${kpiHtml}
  ${mainHtml}
  ${tickerHtml}
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
