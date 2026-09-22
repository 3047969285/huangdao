/**
 * 黄岛-故障信息分析助手 - HTML 看板生成脚本 v5（统一栅格 · 三类型独立看板）
 * ==========================================
 * 用途：
 *   1. 调用 chat API 获取故障分析原始返回（复用 index.js 的 callChat）
 *   2. 将 接口返回的原始 answer 一字不差地完整展示（不脱敏 / 不修改 / 不删减）
 *   3. 跳闸 / 接地 / 母线接地三套独立模板，**按输入识别出的类型只渲染对应的那一种**
 *   4. 跳闸/单线接地/母线多线三套独立模板，统一栅格卡片密度
 *   5. 配色：深蓝电力主题（主色深蓝，仅低压相警示红），苹果简约设计
 *
 * 用法：
 *   node gen_fault_html.js "<完整故障信息>"     （或读取 query.txt）
 *   可选：FAULT_SEED_FILE=<文件> 直接复用已有接口档案离线重渲染（跳过接口调用）
 *
 * 输出：
 *   output/故障信息分析看板_类型_日期.html（FAULT_OUT_DIR 可覆盖）
 */
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

function fmtDay(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 自然周（周一至周日） */
function weekBounds(d) {
  const mondayOffset = (d.getDay() + 6) % 7;
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - mondayOffset);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
  return { start, end, key: fmtDay(start) };
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

function parseOutageDate(row) {
  const year = String(row['年度'] || '').match(/20\d{2}/);
  const md = String(row['停电日期'] || '');
  const m = md.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (!year || !m) return null;
  const d = new Date(Number(year[0]), Number(m[1]) - 1, Number(m[2]));
  return Number.isNaN(d.getTime()) ? null : d;
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

/** 有停电日期的记录按自然周出范围标题，和本次日报分开 */
function weekCaption(rows) {
  const dates = rows.map(parseOutageDate).filter(Boolean);
  if (!dates.length) return '';
  const groups = new Map();
  dates.forEach((d) => {
    const w = weekBounds(d);
    if (!groups.has(w.key)) groups.set(w.key, w);
  });
  const labels = [...groups.values()].map((w) => `${fmtDay(w.start)} ~ ${fmtDay(w.end)}`);
  return `<div class="week-cap">周报区间 ${esc(labels.join('；'))} · ${dates.length} 起 · 自然周（周一至周日），不与本次日报混排</div>`;
}

// 按段名切分 query（跳闸 / 接地 / 母线接地）
function parseQuerySections(query) {
  const q = String(query || '');
  const sections = [];
  const parts = q.split(/^\s*(母线接地|接地|跳闸)\s*[：:]/m);
  for (let i = 1; i < parts.length; i += 2) {
    const type = parts[i];
    const body = String(parts[i + 1] || '').trim();
    if (body) sections.push({ type, text: body });
  }
  if (sections.length === 0 && q.trim()) {
    let type = '跳闸';
    if (/母线接地/.test(q)) type = '母线接地';
    else if (/接地/.test(q)) type = '接地';
    sections.push({ type, text: q.trim() });
  }
  return sections;
}

// 根据输入判定主故障类型（一个看板只对应一种类型的模板）
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

// 从相别值里抽取单相标识（“C相”/“C”/“C相接地” → “C相”）
function phaseLabel(s) {
  const m = /([ABCabc])\s*相?/.exec(String(s || ''));
  return m ? m[1].toUpperCase() + '相' : '?';
}


// ---------------- 统一栅格看板 v5 ----------------

/**
 * 从 query / 接口返回收集候选线路名（去重；排除母线本体；过滤「否」等非线路值）。
 * @param {string} text
 * @param {string} [extraText]
 * @param {Record<string, string>} [kv]
 * @param {{ forceScan?: boolean }} [opts]
 * @returns {string[]}
 */
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

function gCard(title, body, span) {
  const cls = span ? `g-card span-${span}` : 'g-card';
  return `<div class="${cls}"><div class="g-card-h">${esc(title)}</div><div class="g-card-b">${body || '<div class="empty">无</div>'}</div></div>`;
}

function gGrid(cards, extraClass) {
  const cls = extraClass ? `g-grid ${extraClass}` : 'g-grid';
  return `<div class="${cls}">${cards.filter(Boolean).join('')}</div>`;
}

function gSection(id, title, inner) {
  return `<section class="g-sec" id="${esc(id)}"><div class="g-sec-t">${esc(title)}</div>${inner}</section>`;
}

function kvMini(rows) {
  const items = rows.filter(([, v]) => v && String(v).trim() && v !== '—');
  if (!items.length) return '<div class="empty">无</div>';
  return `<div class="kv-mini">${items.map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div>`;
}

function numOf(v) {
  const m = /([\d.]+)/.exec(String(v));
  return m ? parseFloat(m[1]) : null;
}

function phasePct(v) {
  const n = numOf(v);
  if (n == null) return 3;
  return Math.max(3, Math.min(100, Math.round((n / 5.8) * 100)));
}

function phaseCard(label, val) {
  const n = numOf(val);
  const low = n != null && n < 2;
  return `<div class="phase-mini${low ? ' low' : ''}"><div class="pl">${esc(label)}</div><div class="phase-bar"><div class="phase-fill" style="width:${phasePct(val)}%"></div></div><div class="pv">${esc(val || '—')}</div></div>`;
}

function getAdviceBlock(answer) {
  const blocks = parseAnswerBlocks(answer);
  return blocks.find((b) => b.title === '试拉建议' || b.title.includes('试拉'));
}

function getSyncBlock(answer) {
  const blocks = parseAnswerBlocks(answer);
  return blocks.find((b) => b.title === '信息同步' || b.title.includes('信息同步'));
}

function adviceCards(answer) {
  const block = getAdviceBlock(answer);
  if (!block) return [];
  const lines = block.lines.map((l) => l.trim()).filter(Boolean);
  const cards = [];
  let idx = 0;
  lines.forEach((t) => {
    const isHead = !/^\d/.test(t) && /优先|其次|最后|协商|无穿越/.test(t);
    if (isHead) {
      cards.push(gCard('试拉策略', `<div class="narr">${esc(t)}</div>`, 12));
      return;
    }
    const m = t.match(/^(\d+)[.、\s]+(.+)$/);
    idx += 1;
    const n = m ? m[1] : String(idx);
    const body = m ? m[2] : t;
    cards.push(gCard(`优先级 ${n}`, `<div class="adv-row"><span class="adv-n">${esc(n)}</span><span>${esc(body)}</span></div>`));
  });
  return cards;
}

function syncCard(answer) {
  const block = getSyncBlock(answer);
  const lines = block ? block.lines.map((l) => l.trim()).filter(Boolean) : [];
  const text = lines.length ? lines.join('\n') : '';
  return gCard('信息同步', text ? `<div class="narr">${esc(text)}</div>` : '', 12);
}

function tripDailyCards(query, answer) {
  const kv = extractKV(query);
  const steps = [
    ['保护动作', kv['动作类型'] || '—'],
    ['跳闸前接地', kv['跳闸前接地情况'] || '—'],
    ['跳闸后复归', kv['跳闸后接地复归情况'] || '—'],
    ['损失电流', kv['损失负荷电流'] || '—'],
  ];
  const flow = steps.map(([l, v], i) => `<div class="trip-step"><div class="n">${i + 1}</div><div class="v">${esc(v)}</div><div class="l">${esc(l)}</div></div>`).join('');
  const oc = kvMini([
    ['保护装置', kv['保护装置'] || ''], ['动作类型', kv['动作类型'] || ''],
    ['动作时间', kv['动作时间'] || ''], ['动作值', kv['动作值'] || ''],
  ]);
  return [
    gCard('跳闸过程', `<div class="inner-4">${flow}</div>`, 8),
    gCard('过流动作', oc, 4),
    syncCard(answer),
  ];
}

function groundDailyCards(query, answer, withTrial) {
  const kv = extractKV(query);
  const text = String(query || '');
  const ua = kv['Ua'] || /Ua[：:]\s*([^\s，,；;]+)/.exec(text)?.[1] || '';
  const ub = kv['Ub'] || /Ub[：:]\s*([^\s，,；;]+)/.exec(text)?.[1] || '';
  const uc = kv['Uc'] || /Uc[：:]\s*([^\s，,；;]+)/.exec(text)?.[1] || '';
  const meta = kvMini([
    ['接地相别', kv['接地相别'] || '—'],
    ['接地选线', kv['是否有接地选线'] || '—'],
    ['选线线路', kv['接地选线线路名称'] || '—'],
    ['瞬时接地', kv['是否瞬时接地'] || '—'],
  ]);
  const cards = [
    gCard('Ua', phaseCard('Ua', ua)),
    gCard('Ub', phaseCard('Ub', ub)),
    gCard('Uc', phaseCard('Uc', uc)),
    gCard('接地信息', meta, 6),
    syncCard(answer),
  ];
  if (withTrial) cards.splice(4, 0, ...adviceCards(answer));
  return cards;
}

function busDailyCards(query, answer) {
  const kv = extractKV(query);
  const qRaw = String(query || '');
  const qval = (re) => (qRaw.match(re) || [])[1] || '';
  const ua = kv['Ua'] || qval(/Ua[：:]\s*([^\s，,；;（(]+)/) || '';
  const ub = kv['Ub'] || qval(/Ub[：:]\s*([^\s，,；;（(]+)/) || '';
  const uc = kv['Uc'] || qval(/Uc[：:]\s*([^\s，,；;（(]+)/) || '';
  const meta = kvMini([
    ['厂站', kv['厂站名称'] || qval(/厂站名称[：:]\s*(\S+)/) || '—'],
    ['母线', kv['母线名称'] || qval(/母线名称[：:]\s*(\S+)/) || '—'],
    ['接地相别', kv['接地相别'] || qval(/接地相别[：:]\s*(\S+)/) || '—'],
    ['接地选线', kv['是否有接地选线'] || qval(/是否有接地选线[：:]\s*(\S+)/) || '—'],
    ['选线线路', kv['接地选线线路名称'] || qval(/接地选线线路名称[：:]\s*([^\n]+)/) || '—'],
    ['瞬时接地', kv['是否瞬时接地'] || qval(/是否瞬时接地[：:]\s*(\S+)/) || '—'],
  ]);
  const lineNames = collectCandidateLines(query, answer, kv, { forceScan: true });
  const lineCards = lineNames.map((l, i) => gCard(`候选 ${i + 1}`, `<div class="line-chip">${esc(l)}</div>`));
  return [
    gCard('母线接地', meta, 6),
    gCard('Ua', phaseCard('Ua', ua)),
    gCard('Ub', phaseCard('Ub', ub)),
    gCard('Uc', phaseCard('Uc', uc)),
    ...lineCards,
    ...adviceCards(answer),
    syncCard(answer),
  ];
}

function weeklyCards(answer, mainType) {
  const cards = [];
  if (mainType === '母线接地') {
    const blocks = parseAnswerBlocks(answer);
    const lineBlocks = blocks.filter((b) => /\d+kV[\u4e00-\u9fa5A-Za-z0-9]*线/.test(b.title));
    lineBlocks.forEach((b) => {
      const items = b.lines.map((l) => l.trim()).filter(Boolean);
      const md = parseMdTable(items);
      if (!md) return;
      const maps = md.rows.map((r) => {
        const o = {};
        md.headers.forEach((h, i) => { o[h] = r[i] != null ? r[i] : ''; });
        return o;
      }).filter((r) => md.headers.some((h) => !isBlankCell(r[h])));
      if (!maps.length || maps.every((r) => md.headers.every((h) => isBlankCell(r[h])))) return;
      const body = `${weekCaption(maps)}${renderRecordCards(md.headers, maps)}`;
      cards.push(gCard(`周报 · ${b.title}`, body, 4));
    });
    if (!cards.length) cards.push(gCard('历史故障', '<div class="empty">本周报无条目</div>', 4));
    return cards;
  }
  const sections = parseAnswerSections(answer);
  const weekSecs = sections.filter((s) => /故障信息|历史故障|近三年/.test(s.title));
  weekSecs.forEach((s) => {
    const items = s.lines.map((l) => l.trim()).filter(Boolean);
    const md = parseMdTable(items);
    if (md) {
      const maps = md.rows.map((r) => {
        const o = {};
        md.headers.forEach((h, i) => { o[h] = r[i] != null ? r[i] : ''; });
        return o;
      }).filter((r) => md.headers.some((h) => !isBlankCell(r[h]) && !/^(无|—)$/.test(String(r[h]).trim())));
      if (maps.length) {
        cards.push(gCard(`周报 · ${s.title}`, `${weekCaption(maps)}${renderRecordCards(md.headers, maps)}`, 4));
        return;
      }
    }
    if (items.length === 1 && /^无$/.test(items[0])) return;
    if (items.length) cards.push(gCard(`周报 · ${s.title}`, `<div class="narr">${esc(items.join('\n'))}</div>`, 4));
  });
  if (!cards.length) cards.push(gCard('历史故障', '<div class="empty">本周报无条目</div>', 4));
  return cards;
}

function archiveCards(answer, mainType) {
  const cards = [];
  if (mainType === '母线接地') {
    const blocks = parseAnswerBlocks(answer);
    const supply = blocks.find((b) => b.title === '供电所概况' || b.title.includes('供电所概况'));
    if (supply) cards.push(gCard('供电所概况', renderRowTables(supply.lines), 6));
    const lineBlocks = blocks.filter((b) => /\d+kV[\u4e00-\u9fa5A-Za-z0-9]*线/.test(b.title));
    lineBlocks.forEach((b) => {
      const body = renderLineDetail(b.lines) || '<div class="empty">无</div>';
      cards.push(gCard(b.title, body, 6));
    });
    return cards.length ? cards : [gCard('线路档案', '<div class="empty">无</div>', 6)];
  }
  const sections = parseAnswerSections(answer);
  const archiveSecs = sections.filter((s) => !/信息同步|试拉|故障信息|历史故障/.test(s.title));
  archiveSecs.forEach((s) => {
    const body = renderRowTables(s.lines) || '<div class="empty">无</div>';
    const span = /联系人|穿越|密集/.test(s.title) ? 6 : 4;
    cards.push(gCard(s.title, body, span));
  });
  if (!cards.length) cards.push(gCard('线路档案', '<div class="empty">无</div>', 6));
  return cards;
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

// 解析 “键：值；键：值” 或中文逗号 / 双空格分隔字段（穿越林区 / 密集通道等区段行）
function semicolonKV(line) {
  return parseFieldPairs(line).filter(([, v]) => String(v || '').trim());
}

// 解析 Markdown 表格行（| a | b |），返回 { headers, rows }；非表格返回 null
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
        else {
          if (/故障/.test(s.title)) parts.push(weekCaption(maps));
          parts.push(renderRecordCards(md.headers, maps));
        }
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

// 大屏渲染：左中右三列，左右各 2 模块，中间上大块 + 下左右两块
function renderBusScreen(query, answer) {
  const kv = extractKV(query);
  const numOf = (v) => { const m = /([\d.]+)/.exec(String(v)); return m ? parseFloat(m[1]) : null; };
  const phasePct = (v) => { const n = numOf(v); if (n == null) return 3; return Math.max(3, Math.min(100, Math.round((n / 5.8) * 100))); };

  let ua = kv['Ua'] || /Ua[：:]\s*([^\s，,；;（(]+)/.exec(query)?.[1] || '';
  let ub = kv['Ub'] || /Ub[：:]\s*([^\s，,；;（(]+)/.exec(query)?.[1] || '';
  let uc = kv['Uc'] || /Uc[：:]\s*([^\s，,；;（(]+)/.exec(query)?.[1] || '';
  // 字段提取：优先 kv（多行），回退正则（单行空格分隔也可靠）——保证通用模板单/多行都展示
  const qRaw = String(query || '');
  const qval = (re) => (qRaw.match(re) || [])[1] || '';
  const station = kv['厂站名称'] || qval(/厂站名称[：:]\s*(\S+)/);
  const busName = kv['母线名称'] || qval(/母线名称[：:]\s*(\S+)/);
  const phase = kv['接地相别'] || qval(/接地相别[：:]\s*(\S+)/);
  const hasSel = kv['是否有接地选线'] || qval(/是否有接地选线[：:]\s*(\S+)/);
  const selLine = kv['接地选线线路名称'] || qval(/接地选线线路名称[：:]\s*(\S+)/);
  const instant = kv['是否瞬时接地'] || qval(/是否瞬时接地[：:]\s*(\S+)/);

  const blocks = parseAnswerBlocks(answer);
  const getBlock = (kw) => blocks.find((b) => b.title === kw) || blocks.find((b) => b.title.includes(kw));
  const lineBlocks = blocks.filter((b) => /\d+kV[\u4e00-\u9fa5A-Za-z0-9]*线/.test(b.title));
  const supplyBlock = getBlock('供电所概况');
  const adviceBlock = getBlock('试拉建议');
  const syncBlock = getBlock('信息同步');

  const emptyHtml = `<div class="empty-hint"><span class="eh-ico">∅</span>暂无数据</div>`;

  // 三相电压
  const phaseHtml = (label, val) => {
    const n = numOf(val);
    // 与定位结论一致：低压相阈值 <2kV
    const cls = n != null && n < 2 ? 'low' : 'ok';
    const vcol = cls === 'low' ? '#ff4d5e' : '#00F0FF';
    return `
      <div class="phase ${cls}">
        <div class="phase-label">${label}</div>
        <div class="phase-bar"><div class="phase-fill" style="width:${phasePct(val)}%"></div></div>
        <div class="phase-val" style="color:${vcol}">${esc(val || '—')}</div>
      </div>`;
  };
  const uaN = numOf(ua), ubN = numOf(ub), ucN = numOf(uc);
  const lowPhase = (uaN != null && uaN < 2) ? 'A相' : (ubN != null && ubN < 2) ? 'B相' : (ucN != null && ucN < 2) ? 'C相' : '';
  const lowVal = lowPhase === 'A相' ? ua : lowPhase === 'B相' ? ub : lowPhase === 'C相' ? uc : '';
  const voltNote = lowPhase
    ? `<div class="volt-note">三相电压中 <b>${lowPhase} = ${esc(lowVal)}</b> 显著低于正常相（约 5.8kV） → 疑似 <b>${esc(phaseLabel(phase))}母线接地</b></div>`
    : (ua || ub || uc) ? `<div class="volt-note ok">三相电压分布：Ua ${esc(ua)} / Ub ${esc(ub)} / Uc ${esc(uc)}（均正常）</div>` : '';
  const voltHtml = (ua || ub || uc)
    ? `<div class="volt-wrap">${phaseHtml('Ua', ua)}${phaseHtml('Ub', ub)}${phaseHtml('Uc', uc)}</div>${voltNote}`
    : emptyHtml;

  // 母线接地信息
  const metaRows = [
    ['厂站名称', station], ['母线名称', busName], ['接地相别', phase],
    ['是否有接地选线', hasSel], ['接地选线线路名称', selLine], ['是否瞬时接地', instant],
  ].filter(([, v]) => v);
  const metaHtml = metaRows.length
    ? `<div class="kv2">${metaRows.map(([k, v]) => `<div class="kv2-item"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div>`
    : emptyHtml;

  // 试拉建议
  const advLines = adviceBlock ? adviceBlock.lines.map((l) => l.trim()).filter(Boolean) : [];
  const adviceHtml = advLines.length
    ? `<div class="adv-list">${advLines.map((t) => {
        const isHead = !/^\d/.test(t) && /优先|其次|最后|协商|无穿越/.test(t);
        return `<div class="adv-item${isHead ? ' head' : ''}">${esc(t)}</div>`;
      }).join('')}</div>`
    : emptyHtml;

  // 信息同步
  const syncLines = syncBlock ? syncBlock.lines.map((l) => l.trim()).filter(Boolean) : [];
  const syncHtml = syncLines.length
    ? `<div class="narrative">${esc(syncLines.join('\n'))}</div>`
    : emptyHtml;

  // 供电所概况
  const supplyLines = supplyBlock ? supplyBlock.lines.filter((l) => l.trim()) : [];
  const supplyHtml = supplyLines.length ? renderRowTables(supplyLines) : emptyHtml;

  // 候选线路：章节标题 + query/answer 全文扫描（含「是否有接地选线：否」仍列出的线路）
  const lineNamesFromBlocks = lineBlocks.map((b) => b.title);
  const lineNames = (() => {
    const scanned = collectCandidateLines(query, answer, kv, { forceScan: true });
    const merged = [];
    lineNamesFromBlocks.concat(scanned).forEach((n) => {
      if (n && !merged.includes(n)) merged.push(n);
    });
    return merged;
  })();
  const candHtml = lineNames.length
    ? `<div class="line-tags">${lineNames.map((l, i) => {
        const isMain = /\d+kV/.test(l);
        return `<div class="line-tag ${isMain ? 'main' : 'branch'}">${esc(l)}<small>候选线路 ${i + 1}</small></div>`;
      }).join('')}</div>`
    : emptyHtml;

  // 线路详情（左上选择器切换）
  const lineDetails = lineBlocks.map((b, i) => {
    const has = b.lines.filter((l) => l.trim()).length > 0;
    return `<div class="line-detail" id="lineDetail${i}"${i === 0 ? '' : ' style="display:none"'}>${has ? renderLineDetail(b.lines) || emptyHtml : emptyHtml}</div>`;
  }).join('');
  const lineSelectHtml = lineBlocks.length
    ? `<select class="line-select" id="lineSelect">${lineBlocks.map((b, i) => `<option value="${i}">${esc(b.title)}</option>`).join('')}</select>
       <div class="panel-body line-detail-wrap">${lineDetails}</div>`
    : `<div class="panel-body">${emptyHtml}</div>`;

  const eventTime = findEventTime(`${answer}\n${query}`);
  const title = `${esc(station)} ${esc(busName)} 母线接地分析大屏`;
  const sub = `日报 · 母线接地 · 接地相别 ${esc(phase)}${eventTime ? ` · 事件时间 ${esc(eventTime)}` : ''} · 生成 ${todayTime()}`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>${title}</title>
<style>${CSS}</style>
</head>
<body class="bus-screen">
  <div class="screen">
    <div class="screen-head">
      <div class="screen-title">${title}</div>
      <div class="screen-sub">${sub}</div>
    </div>
    <div class="screen-grid">
      <!-- 左列：线路详情（上，吃满高度）+ 候选线路（按内容自适应） -->
      <div class="col">
        <div class="panel">
          <div class="panel-title">线路详情（选择线路）</div>
          ${lineSelectHtml}
        </div>
        <div class="panel">
          <div class="panel-title">候选线路（接地选线）</div>
          <div class="panel-body">${candHtml}</div>
        </div>
      </div>
      <!-- 中列：合并核心模块（母线接地信息 + 三相电压定位）+ 供电所概况（下，宽列联系人两列排布） -->
      <div class="col-mid">
        <div class="panel">
          <div class="panel-title">母线接地信息 · 三相电压定位</div>
          <div class="panel-body core-body">${metaHtml}${voltHtml}</div>
        </div>
        <div class="panel">
          <div class="panel-title">供电所概况</div>
          <div class="panel-body">${supplyHtml}</div>
        </div>
      </div>
      <!-- 右列：试拉建议（吃满高度）+ 信息同步（收尾，放在最后） -->
      <div class="col-r">
        <div class="panel">
          <div class="panel-title">试拉建议</div>
          <div class="panel-body">${adviceHtml}</div>
        </div>
        <div class="panel">
          <div class="panel-title">信息同步</div>
          <div class="panel-body">${syncHtml}</div>
        </div>
      </div>
    </div>
  </div>
  <script>
  (function(){
    // 线路选择器切换（切换后滚动位置归零）
    var sel = document.getElementById('lineSelect');
    if (sel) {
      sel.addEventListener('change', function(){
        var items = document.querySelectorAll('.line-detail');
        for (var i=0;i<items.length;i++){ items[i].style.display = 'none'; items[i].scrollTop = 0; }
        var t = document.getElementById('lineDetail' + sel.value);
        if (t) t.style.display = 'block';
      });
    }
    // 模块内容仅手动滚动（滚轮/触摸板/触摸），不做自动流转
  })();
  </script>
</body>
</html>`;
}

// ---------------- 接口档案 ----------------

// 解析接口 answer 为章节
function parseAnswerSections(answer) {
  const lines = String(answer || '').split(/\r?\n/);
  const sections = [];
  let current = null;
  for (const raw of lines) {
    const line = raw.replace(/^\s+/, '').replace(/\s+$/, '');
    if (!line.trim()) continue;
    const m = line.match(/^([一二三四五六七八九十0-9]+)[、\.]\s*(.+)$/);
    if (m) {
      // 标题若在同一行内带出内容（如“二、供电所联系人和电话：张 剑：13xxxxxxxxx”），
      // 拆出标题与这段内容，内容并入该章节正文顶部，避免被吞进标题。
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
  return `<div class="narrative">${esc(t)}</div>`;
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
  return `
      <div class="relay-group">
        <div class="relay-group-title">${esc(title)}</div>
        ${renderKvList(kv)}
        ${prose.length ? renderNarrative(prose.join('\n')) : ''}
      </div>`;
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
    if (blank) html += `<div class="text-block">无</div>`;
    else {
      if (md.headers.some((h) => /停电日期|故障原因/.test(h))) html += weekCaption(maps);
      html += renderDataTable(md.headers, maps);
    }
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
    // 分组标题行：以冒号结尾且冒号后无内容（如 “变电运维班：” “配抢值班：” “汇报领导:”）
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

// 解析接口 answer 为章节
function parseAnswerSections(answer) {
  const lines = String(answer || '').split(/\r?\n/);
  const sections = [];
  let current = null;
  for (const raw of lines) {
    const line = raw.replace(/^\s+/, '').replace(/\s+$/, '');
    if (!line.trim()) continue;
    const m = line.match(/^([一二三四五六七八九十0-9]+)[、\.]\s*(.+)$/);
    if (m) {
      // 标题若在同一行内带出内容（如“二、供电所联系人和电话：张 剑：13xxxxxxxxx”），
      // 拆出标题与这段内容，内容并入该章节正文顶部，避免被吞进标题。
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
  return `<div class="narrative">${esc(t)}</div>`;
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
  return `
      <div class="relay-group">
        <div class="relay-group-title">${esc(title)}</div>
        ${renderKvList(kv)}
        ${prose.length ? renderNarrative(prose.join('\n')) : ''}
      </div>`;
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
    if (blank) html += `<div class="text-block">无</div>`;
    else {
      if (md.headers.some((h) => /停电日期|故障原因/.test(h))) html += weekCaption(maps);
      html += renderDataTable(md.headers, maps);
    }
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
    // 分组标题行：以冒号结尾且冒号后无内容（如 “变电运维班：” “配抢值班：” “汇报领导:”）
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


// ---------------- HTML 组装（统一栅格） ----------------

const CSS = `
  :root{--bg:#050b16;--card:#0e1a30;--card2:#132038;--ink:#e8f0fc;--sub:#8ea3c0;--line:rgba(120,170,255,.14);--blue:#3b82f6;--cyan:#5ec8ff;--red:#ff5a4e;--r:14px}
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","PingFang SC","Microsoft YaHei",sans-serif;background:radial-gradient(900px 420px at 10% -8%,rgba(59,130,246,.12),transparent 55%),radial-gradient(900px 420px at 90% 0%,rgba(29,95,208,.1),transparent 55%),var(--bg);color:var(--ink);line-height:1.55;-webkit-font-smoothing:antialiased}
  .dash{max-width:1240px;margin:0 auto;padding:16px 18px 64px}
  .dash-h{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:12px 0 14px;border-bottom:1px solid var(--line);margin-bottom:14px}
  .dash-h h1{font-size:22px;font-weight:800;letter-spacing:-.3px}
  .dash-h .sub{font-size:12px;color:var(--sub);margin-top:4px}
  .dash-h .meta{display:flex;gap:8px;flex-wrap:wrap}
  .pill{font-size:12px;padding:4px 10px;border-radius:99px;background:rgba(59,130,246,.14);border:1px solid rgba(120,170,255,.28);color:#d7e8ff}
  .g-sec{margin-top:26px}
  .g-sec-t{font-size:15px;font-weight:800;color:#fff;margin-bottom:12px;padding-left:10px;border-left:3px solid var(--blue)}
  .g-grid{display:grid;grid-template-columns:repeat(12,1fr);gap:12px;align-items:stretch}
  .g-card{grid-column:span 4;background:linear-gradient(180deg,var(--card2),var(--card));border:1px solid var(--line);border-radius:var(--r);min-height:148px;display:flex;flex-direction:column;overflow:hidden}
  .g-card.span-6{grid-column:span 6}.g-card.span-8{grid-column:span 8}.g-card.span-12{grid-column:span 12}
  .g-card-h{padding:10px 14px;font-size:12.5px;font-weight:700;color:var(--cyan);border-bottom:1px solid var(--line);background:rgba(255,255,255,.03);flex-shrink:0}
  .g-card-b{padding:12px 14px;flex:1;font-size:13px;line-height:1.55;overflow:auto}
  .kpi .g-card{min-height:92px;grid-column:span 2}
  .kpi .g-card-b{display:flex;align-items:center;justify-content:center;flex-direction:column;text-align:center}
  .kpi-val{font-size:19px;font-weight:800;color:var(--cyan);word-break:break-all}
  .kpi-lbl{font-size:11px;color:var(--sub);margin-top:4px}
  .empty{color:var(--sub);font-size:13px;text-align:center;padding:18px 0}
  .kv-mini{display:grid;gap:7px}
  .kv-mini div{display:flex;justify-content:space-between;gap:10px;font-size:12.5px}
  .kv-mini span{color:var(--sub);flex-shrink:0}
  .kv-mini b{color:#fff;font-weight:650;text-align:right;word-break:break-all}
  .phase-mini{text-align:center}
  .phase-mini .pl{font-size:12px;color:var(--sub);font-weight:700}
  .phase-mini .pv{font-size:22px;font-weight:800;margin-top:6px;color:var(--cyan)}
  .phase-mini.low .pv{color:var(--red)}
  .phase-bar{height:5px;background:rgba(255,255,255,.08);border-radius:5px;margin:8px 0;overflow:hidden}
  .phase-fill{height:100%;background:linear-gradient(90deg,var(--blue),var(--cyan));border-radius:5px}
  .phase-mini.low .phase-fill{background:linear-gradient(90deg,var(--red),#ff8a5c)}
  .inner-4{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
  .trip-step{text-align:center;padding:8px 4px;background:rgba(255,255,255,.03);border:1px solid var(--line);border-radius:10px}
  .trip-step .n{width:26px;height:26px;border-radius:50%;background:var(--blue);color:#fff;display:inline-flex;align-items:center;justify-content:center;font-weight:800;font-size:12px}
  .trip-step .v{margin-top:8px;font-size:14px;font-weight:700;color:#fff;word-break:break-all}
  .trip-step .l{font-size:11px;color:var(--sub);margin-top:2px}
  .narr{white-space:pre-wrap;word-break:break-word;font-size:13px;line-height:1.65}
  .adv-row{display:flex;align-items:flex-start;gap:6px}
  .adv-n{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:var(--blue);color:#fff;font-size:11px;font-weight:800;flex-shrink:0}
  .line-chip{display:inline-block;padding:5px 12px;border-radius:8px;background:rgba(59,130,246,.12);border:1px solid rgba(120,170,255,.35);font-size:13px;font-weight:650}
  .week-cap{margin-bottom:8px;font-size:12px;color:#d7e6ff;background:rgba(59,130,246,.1);border:1px solid rgba(120,170,255,.28);border-radius:8px;padding:7px 10px}
  .ld-seg{background:rgba(8,16,32,.45);border:1px solid var(--line);border-radius:8px;padding:8px 10px;margin-bottom:7px}
  .ld-seg:last-child{margin-bottom:0}
  .ld-row{display:flex;gap:8px;font-size:12px;line-height:1.5;padding:2px 0}
  .ld-row span{color:var(--sub);flex:0 0 5.5em}
  .ld-row b{color:var(--ink);font-weight:650;word-break:break-word}
  .ld-sub{margin-bottom:10px}
  .ld-sub-title{font-size:12px;font-weight:700;color:var(--cyan);margin-bottom:6px;padding-left:8px;border-left:3px solid var(--blue)}
  .ld-none,.ld-text,.ld-value{font-size:12px;color:var(--sub)}
  .relay-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:6px}
  .relay-item{display:flex;justify-content:space-between;gap:8px;background:rgba(8,16,32,.45);border:1px solid var(--line);border-radius:8px;padding:7px 10px;font-size:12.5px}
  .relay-name{color:var(--sub)}.relay-val{color:var(--cyan);font-weight:650;text-align:right;word-break:break-all}
  .relay-group{margin-top:8px;padding:8px 10px;border:1px solid var(--line);border-left:3px solid var(--blue);border-radius:8px;background:rgba(8,16,32,.35)}
  .relay-group-title{font-size:12px;font-weight:700;color:var(--cyan);margin-bottom:6px}
  .table-wrap{overflow-x:auto}
  table.dt{width:100%;border-collapse:collapse;font-size:12px}
  table.dt th{background:rgba(59,130,246,.15);color:#fff;text-align:left;padding:7px 9px}
  table.dt td{padding:7px 9px;border-bottom:1px solid var(--line);word-break:break-word}
  details.raw{margin-top:28px;border:1px solid var(--line);border-radius:var(--r);overflow:hidden}
  details.raw summary{cursor:pointer;padding:12px 14px;font-size:13px;font-weight:700;background:rgba(255,255,255,.04)}
  details.raw pre{padding:12px 14px 16px;font-size:12px;line-height:1.7;white-space:pre-wrap;word-break:break-all;color:#c5d6ea;max-height:320px;overflow:auto}
  .foot{text-align:center;color:var(--sub);font-size:12px;margin-top:32px}
  @media(max-width:960px){.g-card,.g-card.span-6,.g-card.span-8{grid-column:span 6}.kpi .g-card{grid-column:span 4}.inner-4{grid-template-columns:repeat(2,1fr)}}
  @media(max-width:600px){.g-card,.g-card.span-6,.g-card.span-8,.kpi .g-card{grid-column:span 12}.inner-4{grid-template-columns:1fr}}
`;

function buildHtml({ query, answer }) {
  const mainType = pickMain(query);
  const eventTime = findEventTime(`${query}\n${answer}`);
  const kpiRows = buildKpiRows(query, answer, mainType);
  const kpiHtml = gGrid(kpiRows.map(([k, v]) => gCard(k, `<div class="kpi-val">${esc(v)}</div><div class="kpi-lbl">${esc(k)}</div>`)), 'kpi');

  let dailyCards;
  if (mainType === '跳闸') dailyCards = tripDailyCards(query, answer);
  else if (mainType === '母线接地') dailyCards = busDailyCards(query, answer);
  else dailyCards = groundDailyCards(query, answer, true);

  const dailyHtml = gGrid(dailyCards);
  const weeklyHtml = gGrid(weeklyCards(answer, mainType));
  const archiveHtml = gGrid(archiveCards(answer, mainType));

  const lineName = (String(answer || query).match(/(10kV|20kV|35kV|110kV)[\u4e00-\u9fa5A-Za-z0-9-]*/) || [''])[0] || '故障信息';
  const typeLabel = mainType === '接地' ? '单线接地' : mainType;
  const title = `${esc(lineName)} · ${esc(typeLabel)}`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>故障信息分析看板 · ${esc(typeLabel)}</title>
<style>${CSS}</style>
</head>
<body>
  <div class="dash">
    <header class="dash-h">
      <div><h1>${title}</h1><div class="sub">黄岛故障信息分析 · ${todayTime()}</div></div>
      <div class="meta">
        <span class="pill">${esc(typeLabel)}</span>
        <span class="pill">${esc(eventTime || '事件时间未标注')}</span>
      </div>
    </header>
    ${gSection('overview', '概览', kpiHtml)}
    ${gSection('daily', '日报', dailyHtml)}
    ${gSection('weekly', '周报', weeklyHtml)}
    ${gSection('archive', '线路档案', archiveHtml)}
    <details class="raw" id="raw">
      <summary>接口返回原文（${String(answer).length} 字）</summary>
      <pre>${answer ? esc(answer) : '（接口本次未返回数据）'}</pre>
    </details>
    <div class="foot">数据来源于智能体接口与用户提交故障信息 · 黄岛-故障信息分析助手</div>
  </div>
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

  const typeSections = parseQuerySections(query);
  let html;
  if (answer && answer.trim().length > 0) {
    html = buildHtml({ query, answer });
  } else {
    console.warn('[警告] 接口多次调用均未返回数据，仍将基于用户输入的故障信息生成看板。');
    html = buildHtml({ query, answer: '' });
  }

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
