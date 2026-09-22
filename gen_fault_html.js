/**
 * 黄岛-故障信息分析助手 - HTML 看板生成脚本 v4（电力VI · 苹果风 · 单类型模板）
 * ==========================================
 * 用途：
 *   1. 调用 chat API 获取故障分析原始返回（复用 index.js 的 callChat）
 *   2. 将 接口返回的原始 answer 一字不差地完整展示（不脱敏 / 不修改 / 不删减）
 *   3. 跳闸 / 接地 / 母线接地三套独立模板，**按输入识别出的类型只渲染对应的那一种**
 *   4. 单页全览 + 顶部锚点路由，一页包含所有内容
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

function todayTime() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
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

// ---------------- 三套故障模板 ----------------

/**
 * 从 query / 接口返回收集候选线路名（去重；排除母线本体；过滤「否」等非线路值）。
 * @param {string} text 主文本（通常为 query 段）
 * @param {string} [extraText] 附加文本（通常为接口 answer）
 * @param {Record<string, string>} [kv] 已解析键值
 * @param {{ forceScan?: boolean }} [opts] forceScan 为 true 时全文扫描线路名模式
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
  // 【10kV西营线】一类括号列举
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

// 模板①：跳闸 —— 事件时间线（保护动作 → 前置接地 → 复归 → 损失）
function renderTypeTrip(text, kv, escQ) {
  const device = kv['保护装置'] || '';
  const actType = kv['动作类型'] || '';
  const actTime = kv['动作时间'] || '';
  const actVal = kv['动作值'] || '';
  const overCurrent = [
    ['保护装置', device],
    ['动作类型', actType],
    ['动作时间', actTime],
    ['动作值', actVal],
  ].filter(([, v]) => v);

  const preGround = kv['跳闸前接地情况'] || '';
  const postGround = kv['跳闸后接地复归情况'] || '';
  const loss = kv['损失负荷电流'] || '';

  const step = (n, cap, val, opt) => `
      <div class="tf-step">
        <div class="tf-line"></div>
        <div class="tf-dot">${n}</div>
        <div class="tf-caption">${escQ(cap)}${val ? `<b>${escQ(val)}</b>` : ''}</div>
        ${opt || ''}
      </div>`;

  return `
      <section class="card type-card type-trip" id="type-跳闸">
        <div class="type-bar"></div>
        <div class="type-head">
          <div class="type-title"><h2>跳闸</h2><span class="type-pill">跳闸事件分析</span></div>
          <div class="type-sub">保护动作 · 跳闸前后状态 · 负荷损失</div>
        </div>

        <div class="trip-flow">
          ${step(1, '保护动作', actType || '', '')}
          ${step(2, '跳闸前接地', preGround || '—')}
          ${step(3, '跳闸后复归', postGround || '—')}
          ${step(4, '损失电流', loss || '—')}
        </div>

        ${overCurrent.length ? `
        <div class="sub-block">
          <div class="sub-title">过流动作信息</div>
          <div class="kv2">
            ${overCurrent.map(([k, v]) => `<div class="kv2-item"><span>${escQ(k)}</span><b>${escQ(v)}</b></div>`).join('')}
          </div>
        </div>` : ''}

        <div class="sub-block">
          <div class="sub-title">跳闸前后状态</div>
          <div class="kv2">
            <div class="kv2-item ${/已复归|消失|复归/.test(postGround) ? 'ok' : 'warn'}"><span>跳闸前接地情况</span><b>${escQ(preGround || '—')}</b></div>
            <div class="kv2-item ${/已复归|消失|复归/.test(postGround) ? 'ok' : 'warn'}"><span>跳闸后接地复归</span><b>${escQ(postGround || '—')}</b></div>
            <div class="kv2-item"><span>损失负荷电流</span><b>${escQ(loss || '—')}</b></div>
          </div>
        </div>

        <details class="raw-inline"><summary>该段原始输入</summary><pre>${escQ(text)}</pre></details>
      </section>`;
}

// 模板②/③：接地 & 母线接地 —— 三相电压分布 + 定位信息
function renderTypeVoltage(type, text, kv, escQ, extraText) {
  const isBus = type === '母线接地';

  let ua = kv['Ua'] || /Ua[：:]\s*([^\s，,；;]+)/.exec(text)?.[1] || '';
  let ub = kv['Ub'] || /Ub[：:]\s*([^\s，,；;]+)/.exec(text)?.[1] || '';
  let uc = kv['Uc'] || /Uc[：:]\s*([^\s，,；;]+)/.exec(text)?.[1] || '';

  const numOf = (v) => {
    const m = /([\d.]+)/.exec(String(v));
    return m ? parseFloat(m[1]) : null;
  };
  const phasePct = (v) => {
    const n = numOf(v);
    if (n == null) return 3;
    return Math.max(3, Math.min(100, Math.round((n / 5.8) * 100)));
  };

  const phaseHtml = (label, val) => {
    const n = numOf(val);
    // 与定位结论一致：低压相阈值 <2kV
    const cls = n != null && n < 2 ? 'low' : 'ok';
    const vcol = cls === 'low' ? '#ff4438' : '#6bb3ff';
    return `
      <div class="phase ${cls}">
        <div class="phase-label">${label}</div>
        <div class="phase-bar"><div class="phase-fill" style="width:${phasePct(val)}%"></div></div>
        <div class="phase-val" style="color:${vcol}">${escQ(val || '—')}</div>
      </div>`;
  };

  const sel = kv['是否有接地选线']
    || (text.match(/是否有(接地)?选线[：:]\s*(是|否|有|无)/)?.[0]?.split(/[：:]/)[1]?.trim())
    || '';
  const selLine = kv['接地选线线路名称'] || '';
  const instant = kv['是否瞬时接地'] || '';

  // 母线接地：接口返回 / 输入中可能有多个候选线路，尽可能全部收集
  const busLines = collectCandidateLines(text, extraText, kv, {
    forceScan: isBus || /是|有/.test(sel),
  });

  const metaRows = [];
  if (isBus) {
    metaRows.push(['厂站名称', kv['厂站名称'] || '']);
    metaRows.push(['母线名称', kv['母线名称'] || '']);
  }
  metaRows.push(['接地相别', kv['接地相别'] || text.match(/接地相别[：:]\s*([^\s，,；;]+)/)?.[1] || '']);
  metaRows.push(['是否有接地选线', sel]);
  // 母线看板：多条候选线路时线路清单已在下方「候选线路」区统一陈列，元信息不再重复；
  // 其它情况（含母线无选线“接地选线线路名称：否”）始终给出该字段，保证第三种模板七字段完整
  const showSelLine = isBus
    ? busLines.length > 1 ? false : !!selLine
    : sel && /是|有/.test(sel);
  if (showSelLine) metaRows.push(['接地选线线路名称', selLine]);
  metaRows.push(['是否瞬时接地', instant]);

  const lowPhase = (() => {
    const uaN = numOf(ua), ubN = numOf(ub), ucN = numOf(uc);
    if (uaN != null && uaN < 2) return 'Ua';
    if (ubN != null && ubN < 2) return 'Ub';
    if (ucN != null && ucN < 2) return 'Uc';
    return '';
  })();
  const lowVal = lowPhase === 'Ua' ? ua : lowPhase === 'Ub' ? ub : lowPhase === 'Uc' ? uc : '';
  const phLabel = phaseLabel(kv['接地相别']);
  const note = lowPhase
    ? `三相电压中 <b>${lowPhase} = ${escQ(lowVal)}</b> 显著低于正常相（约 5.8kV） → 疑似 <b>${phLabel}${escQ(isBus ? '母线' : '线路')}接地</b>`
    : '三相电压分布';

  return `
      <section class="card type-card type-${isBus ? 'bus' : 'ground'}" id="type-${type}">
        <div class="type-bar"></div>
        <div class="type-head">
          <div class="type-title"><h2>${escQ(type)}</h2><span class="type-pill">${isBus ? '母线接地定位' : '接地定位分析'}</span></div>
          <div class="type-sub">${isBus ? '母线架构 · 三相电压 · 接地选线' : '三相电压 · 接地选线 · 故障定位'}</div>
        </div>

        <div class="phase-wrap">
          ${phaseHtml('Ua', ua)}${phaseHtml('Ub', ub)}${phaseHtml('Uc', uc)}
        </div>
        <div class="phase-note${lowPhase ? ' alert' : ''}">${note}</div>

        ${metaRows.filter(([, v]) => v).length ? `
        <div class="sub-block">
          <div class="sub-title">${escQ(isBus ? '母线接地信息' : '接地信息')}</div>
          <div class="kv2">
            ${metaRows.filter(([, v]) => v).map(([k, v]) => `<div class="kv2-item"><span>${escQ(k)}</span><b>${escQ(v)}</b></div>`).join('')}
          </div>
        </div>` : ''}

        ${isBus && busLines.length ? `
        <div class="sub-block">
          <div class="sub-title">接地选线 · 候选线路（${busLines.length} 条）</div>
          <div class="line-tags">
            ${busLines.map((l, i) => {
              const isMain = /(?:10|20|35|110|220|330|500)kV/.test(l);
              return `<div class="line-tag ${isMain ? 'main' : 'branch'}">${escQ(l)}<small>候选线路 ${i + 1} · ${isMain ? '主线' : '支线'}</small></div>`;
            }).join('')}
          </div>
        </div>` : ''}

        <details class="raw-inline"><summary>该段原始输入</summary><pre>${escQ(text)}</pre></details>
      </section>`;
}

function renderTypeDetail(section, extraText) {
  const text = section.text;
  const kv = extractKV(section.text);
  const escQ = esc;
  if (section.type === '跳闸') return renderTypeTrip(text, kv, escQ);
  return renderTypeVoltage(section.type, text, kv, escQ, extraText);
}

// ---------------- 母线接地 · 大屏三列布局 ----------------

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

// 解析 “键：值；键：值” 分号分隔字段（穿越林区 / 密集通道等区段行）
function semicolonKV(line) {
  const pairs = [];
  String(line).split(/；|;/).forEach((frag) => {
    const m = frag.trim().match(/^([^：:]{1,25})[：:]\s*(.+)$/);
    if (m && m[2].trim()) pairs.push([m[1].trim(), m[2].trim()]);
  });
  return pairs;
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

  const kvRows = (pairs) => pairs.map(([k, v]) => `<div class="ld-row"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('');
  const NONE = `<div class="ld-none">无</div>`;

  const segHtml = kept
    .map((s) => {
      const items = s.body.filter((l) => l.trim());
      let body;
      if (!s.value && (!items.length || (items.length === 1 && /^无$/.test(items[0].trim())))) {
        body = NONE;
      } else {
        const parts = [];
        if (s.value) parts.push(`<div class="ld-seg">${kvRows([[s.title, s.value]])}</div>`);
        const md = parseMdTable(items);
        if (md) {
          if (md.headers.length > 4) {
            // 窄列：多列表格转成逐条记录卡片（首两列做标题）
            parts.push(
              md.rows
                .map((r) => {
                  const title = [r[0], r[1]].filter(Boolean).join(' · ');
                  const rest = md.headers
                    .slice(2)
                    .map((h, i) => [h, r[i + 2] != null ? r[i + 2] : ''])
                    .filter(([, v]) => v !== '');
                  return `<div class="ld-seg">${title ? `<div class="ld-seg-title">${esc(title)}</div>` : ''}${kvRows(rest)}</div>`;
                })
                .join('')
            );
          } else {
            parts.push(
              `<table class="dt"><thead><tr>${md.headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>` +
                md.rows.map((r) => `<tr>${md.headers.map((_, i) => `<td>${esc(r[i] != null ? r[i] : '')}</td>`).join('')}</tr>`).join('') +
                '</tbody></table>'
            );
          }
        } else {
          const segs = items.map((l) => semicolonKV(l)).filter((p) => p.length);
          if (segs.length) {
            parts.push(segs.map((pairs) => `<div class="ld-seg">${kvRows(pairs)}</div>`).join(''));
          } else if (items.length) {
            parts.push(`<div class="ld-text">${items.map((l) => esc(l)).join('<br/>')}</div>`);
          }
        }
        body = parts.length ? parts.join('') : NONE;
      }
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
    ? `<div class="adv-list">${syncLines.map((t) => `<div class="adv-item">${esc(t)}</div>`).join('')}</div>`
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

  const title = `${esc(station)} ${esc(busName)} 母线接地分析大屏`;
  const sub = `故障类型：母线接地 · 接地相别 ${esc(phase)} · 生成时间 ${todayTime()}`;

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
      let title = m[2].trim();
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

function renderRowTables(lines) {
  const records = [];
  const singles = [];
  const groups = [];
  let curGroup = null;
  const flush = () => {
    if (curGroup && curGroup.lines.length) groups.push(curGroup);
    curGroup = null;
  };

  for (const l of lines) {
    const kvs = [];
    const re = /([^：\s\t]{1,20})：([^\s：\t]*)/g;
    let mm;
    let copy = l;
    while ((mm = re.exec(copy)) !== null) kvs.push([mm[1], mm[2]]);
    // 分组标题行：以冒号结尾且冒号后无内容（如 “变电运维班：” “配抢值班：” “汇报领导:”）
    const trimmed = l.trim();
    if (/^(?!\d+[、\.]|[一二三四五六七八九十]+[、\.])[^：:]{1,20}[：:]\s*$/.test(trimmed)) {
      flush();
      curGroup = { title: trimmed.replace(/[：:]\s*$/, '').trim(), lines: [] };
      continue;
    }
    if (curGroup) { curGroup.lines.push(l); continue; }
    if (kvs.length >= 2) records.push({ raw: l, kvs });
    else singles.push(l);
  }
  flush();

  let html = '';
  if (records.length) {
    const headers = [];
    records.forEach((r) => r.kvs.forEach(([k]) => headers.includes(k) || headers.push(k)));
    const prioritize = ['杆号区段', '起始点', '所在林区', '终止点', '穿越长度kM', '通道长度公里', '隐患类型', '备注', '区段描述', '其他隐患描述'];
    headers.sort((a, b) => {
      const ia = prioritize.indexOf(a), ib = prioritize.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
    html += `<table class="dt"><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>`;
    html += records.map((r) => {
      const map = {};
      r.kvs.forEach(([k, v]) => (map[k] = v));
      return `<tr>${headers.map((h) => `<td>${esc(map[h] != null ? map[h] : '')}</td>`).join('')}</tr>`;
    }).join('');
    html += '</tbody></table>';
    html += `<details class="raw-inline"><summary>该章节接口原始行（共 ${records.length} 条）</summary><pre>${records.map((r) => esc(r.raw)).join('\n')}</pre></details>`;
  }
  if (singles.length) {
    // 散行中“键：值”形式的整齐成条目，纯文本（如“无”）仍用文本块
    const kvItems = [];
    const plain = [];
    singles.forEach((l) => {
      const m = l.trim().match(/^([^：:]{1,20})[：:]\s*(.+)$/);
      if (m) kvItems.push([m[1].trim(), m[2].trim()]);
      else plain.push(l);
    });
    if (kvItems.length) {
      html += `<div class="relay-list">${kvItems.map(([k, v]) => `<div class="relay-item"><span class="relay-name">${esc(k)}</span><b class="relay-val">${esc(v)}</b></div>`).join('')}</div>`;
    }
    if (plain.length) {
      html += `<div class="text-block">${plain.map((l) => esc(l)).join('<br/>')}</div>`;
    }
  }
  if (groups.length) {
    html += groups.map((g) => `
      <div class="relay-group">
        <div class="relay-group-title">${esc(g.title)}</div>
        <div class="relay-list">
          ${g.lines.map((l) => {
            const m = l.trim().match(/^([^：:]{1,20})[：:]\s*(.+)$/);
            return m
              ? `<div class="relay-item"><span class="relay-name">${esc(m[1].trim())}</span><b class="relay-val">${esc(m[2].trim())}</b></div>`
              : `<div class="relay-item relay-full">${esc(l)}</div>`;
          }).join('')}
        </div>
      </div>`).join('');
  }
  return html;
}

// ---------------- HTML 组装（苹果风） ----------------

const CSS = `
  :root{
    --bg:#060d1a; --card:#0d1830; --card2:#122240; --ink:#eaf1fd; --sub:#8aa2c0;
    --line:rgba(140,180,255,.16);
    --blue:#3b82f6; --deep:#1d5fd0; --red:#ff5a4e;
    --e-blue:#6bb3ff; --e-deep:#8ec2ff; --e-red:#ff8a80;
    --sh1:0 10px 30px rgba(0,0,0,.45),0 26px 60px rgba(0,0,0,.30);
    --r:20px;
  }
  * { box-sizing:border-box; margin:0; padding:0; }
  html { scroll-behavior:smooth; }
  body { font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","PingFang SC","Microsoft YaHei","Segoe UI",sans-serif; color:var(--ink); line-height:1.55; -webkit-font-smoothing:antialiased; background:
    radial-gradient(1100px 520px at 8% -6%, rgba(59,130,246,.16), transparent 60%),
    radial-gradient(1100px 560px at 94% -10%, rgba(29,95,208,.14), transparent 60%),
    radial-gradient(1000px 500px at 50% 0%, rgba(110,160,255,.08), transparent 55%),
    #04070d; }
  /* 顶部磨砂栏 + 深蓝渐变线 */
  .topbar { position:sticky; top:0; z-index:50; background:rgba(9,15,29,.74); -webkit-backdrop-filter:saturate(180%) blur(20px); backdrop-filter:saturate(180%) blur(20px); border-bottom:1px solid rgba(140,180,255,.12); }
  .topbar::after { content:""; display:block; height:3px; background:linear-gradient(90deg,#1d5fd0,#3b82f6,#6bb3ff); }
  .topbar-in { max-width:1180px; margin:0 auto; display:flex; align-items:center; gap:26px; padding:13px 22px; flex-wrap:wrap; }
  .brand { color:#fff; font-size:16px; font-weight:700; background:linear-gradient(90deg,var(--e-blue),#9cc6ff); -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent; white-space:nowrap; }
  .brand small { display:block; font-size:11px; color:var(--sub); font-weight:400; -webkit-text-fill-color:var(--sub); }
  nav { display:flex; gap:4px; flex-wrap:wrap; }
  nav a { color:var(--sub); text-decoration:none; font-size:13px; padding:7px 14px; border-radius:20px; transition:.15s; white-space:nowrap; }
  nav a:hover { background:linear-gradient(90deg,rgba(59,130,246,.20),rgba(150,190,255,.14)); color:#fff; }
  .wrap { max-width:1180px; margin:0 auto; padding:36px 22px 90px; }
  /* 顶部标题（深蓝渐变横幅 hero） */
  .hero { margin-top:6px; padding:38px 32px 30px; border-radius:24px; color:#fff; background:
    radial-gradient(900px 460px at 85% 120%, rgba(120,170,255,.30), transparent 60%),
    radial-gradient(700px 420px at 10% 0%, rgba(74,130,240,.28), transparent 55%),
    linear-gradient(120deg,#041a3e 0%,#0d3f96 45%,#1d5fd0 82%,#0b2c66 100%); box-shadow:0 18px 60px rgba(0,0,0,.55); position:relative; overflow:hidden; border:1px solid rgba(140,180,255,.20); }
  .hero::after { content:""; position:absolute; left:0; right:0; bottom:0; height:4px; background:linear-gradient(90deg,#1d5fd0,#6bb3ff,#9cc6ff); }
  .hero h1 { font-size:32px; font-weight:800; letter-spacing:-.4px; text-shadow:0 2px 14px rgba(0,0,0,.35); }
  .hero .meta { margin-top:14px; display:flex; gap:10px 26px; flex-wrap:wrap; font-size:13px; color:rgba(255,255,255,.92); }
  .hero .meta span { background:rgba(255,255,255,.12); border:1px solid rgba(255,255,255,.24); padding:4px 12px; border-radius:99px; backdrop-filter:blur(4px); }
  .hero .meta b { color:#fff; font-weight:700; }
  /* 分区标题（蓝色竖条） */
  .sec { padding-top:38px; }
  .sec-title { font-size:22px; font-weight:800; letter-spacing:-.2px; scroll-margin-top:96px; padding-left:14px; position:relative; color:#fff; }
  .sec-title::before { content:""; position:absolute; left:0; top:4px; bottom:4px; width:5px; border-radius:5px; background:linear-gradient(180deg,var(--e-blue),var(--deep)); }
  .sec-note { font-size:13px; color:var(--sub); margin:6px 0 6px; }
  /* KPI（深蓝数字卡，统一配色） */
  .kpi-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:14px; margin-top:22px; }
  .kpi { background:linear-gradient(180deg,var(--card2),var(--card)); border-radius:var(--r); padding:16px 18px 18px; box-shadow:var(--sh1); border:1px solid var(--line); border-top:4px solid var(--blue); position:relative; overflow:hidden; }
  .kpi::after { content:""; position:absolute; right:-30px; top:-30px; width:80px; height:80px; border-radius:50%; background:var(--blue); opacity:.14; }
  .kpi .kpi-value { color:var(--e-blue); }
  .kpi-value { font-size:21px; font-weight:800; letter-spacing:-.3px; }
  .kpi-label { font-size:12.5px; color:var(--sub); margin-top:4px; }
  /* 通用卡片 */
  .card { background:linear-gradient(180deg,var(--card2),var(--card)); border-radius:var(--r); box-shadow:var(--sh1); overflow:hidden; scroll-margin-top:96px; margin-top:16px; border:1px solid var(--line); }
  .card-head { display:flex; align-items:center; gap:12px; padding:16px 22px; border-bottom:1px solid var(--line); background:linear-gradient(180deg,rgba(25,42,70,.9),rgba(12,22,42,.85)); }
  .card-badge { background:linear-gradient(135deg,var(--deep),var(--e-blue)); color:#fff; font-size:12px; font-weight:700; border-radius:99px; padding:3px 11px; min-width:32px; text-align:center; box-shadow:0 3px 10px rgba(59,130,246,.35); }
  .card-head h2 { font-size:16px; font-weight:700; color:#fff; }
  .card-body { padding:6px 22px 20px; }
  .text-block { background:rgba(19,35,60,.55); border:1px solid var(--line); border-radius:14px; padding:14px 16px; margin-top:12px; color:var(--ink); }
  /* 接口档案内的分组面板（如变电运维班 / 配抢值班 / 汇报领导） */
  .relay-group { margin-top:12px; background:linear-gradient(180deg,rgba(18,34,64,.65),rgba(10,18,36,.55)); border:1px solid var(--line); border-left:4px solid var(--blue); border-radius:14px; padding:12px 14px 14px; }
  .relay-group + .relay-group { margin-top:10px; }
  .relay-group-title { display:inline-flex; align-items:center; gap:7px; font-size:13px; font-weight:750; color:var(--e-blue); background:linear-gradient(90deg,rgba(59,130,246,.20),rgba(59,130,246,.05)); padding:4px 13px; border-radius:99px; margin-bottom:10px; }
  .relay-group-title::before { content:""; width:8px; height:8px; border-radius:50%; background:linear-gradient(135deg,var(--e-blue),var(--deep)); }
  .relay-list { display:grid; grid-template-columns:repeat(auto-fill,minmax(205px,1fr)); gap:8px; }
  .relay-item { display:flex; align-items:flex-start; justify-content:space-between; gap:10px; background:rgba(9,16,32,.6); border:1px solid var(--line); border-radius:10px; padding:8px 12px; }
  .relay-name { font-size:13px; color:var(--sub); white-space:nowrap; flex-shrink:0; }
  .relay-val { font-size:14.5px; font-weight:750; color:var(--e-blue); font-variant-numeric:tabular-nums; word-break:break-all; text-align:right; }
  .relay-item.relay-full { grid-column:1 / -1; color:var(--ink); font-size:13px; }
  /* 类型卡模板（深蓝主题，三类型同色统一） */
  .type-card { position:relative; margin-top:30px; padding:0 26px 26px; }
  .type-bar { height:6px; width:72px; border-radius:6px; margin:26px 0 12px; background:linear-gradient(90deg,var(--deep),var(--e-blue)); box-shadow:0 3px 12px rgba(59,130,246,.4); }
  .type-head { padding-right:0; }
  .type-title { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
  .type-title h2 { font-size:24px; font-weight:800; letter-spacing:-.3px; color:#fff; }
  .type-pill { font-size:12px; font-weight:700; color:#fff; padding:4px 14px; border-radius:99px; letter-spacing:1px; box-shadow:0 3px 10px rgba(0,0,0,.4); background:linear-gradient(135deg,var(--deep),var(--e-blue)); }
  .type-sub { font-size:13px; color:var(--sub); margin-top:4px; }
  .sub-block { margin-top:22px; }
  .sub-title { font-size:14px; font-weight:750; margin-bottom:10px; padding-left:10px; border-left:4px solid var(--blue); color:#fff; }
  /* 跳闸模板：时间线（统一可视化面板，与三相电压卡同型） */
  .trip-flow { display:flex; align-items:flex-start; margin:22px 0 6px; background:linear-gradient(180deg,rgba(18,34,64,.7),rgba(10,18,36,.6)); border:1px solid var(--line); border-radius:18px; padding:22px 18px 14px; box-shadow:0 8px 20px rgba(0,0,0,.35); }
  .tf-step { flex:1 1 150px; position:relative; padding-right:20px; }
  .tf-dot { width:28px; height:28px; border-radius:50%; color:#fff; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:13px; position:relative; z-index:2; box-shadow:0 0 0 5px rgba(59,130,246,.22); background:linear-gradient(135deg,var(--deep),var(--e-blue)); }
  .tf-line { position:absolute; top:13.5px; left:28px; right:20px; height:2.5px; border-radius:3px; background:linear-gradient(90deg,var(--blue),rgba(59,130,246,.16)); }
  .tf-caption { margin-top:12px; font-size:13px; color:var(--sub); }
  .tf-caption b { display:block; color:#fff; font-size:16px; font-weight:700; margin-top:2px; }
  .kv-table { margin-top:6px; }
  /* 表格 */
  table.dt { width:100%; border-collapse:collapse; font-size:13.5px; margin:6px 0 4px; }
  table.dt th { color:#fff; background:linear-gradient(135deg,#1c2c48,#2a4068); font-weight:650; font-size:12.5px; text-align:left; padding:9px 12px; border:none; white-space:nowrap; }
  table.dt td { padding:11px 12px; border-bottom:1px solid var(--line); vertical-align:top; word-break:break-all; color:var(--ink); }
  table.dt tbody tr:nth-child(even) td { background:rgba(19,35,60,.4); }
  table.dt tbody tr:last-child td { border-bottom:none; }
  /* kv 卡片 */
  .kv2 { display:grid; grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); gap:12px; }
  .kv2-item { background:linear-gradient(180deg,rgba(18,34,64,.6),rgba(12,24,46,.5)); border:1px solid var(--line); border-left:4px solid var(--blue); border-radius:14px; padding:13px 16px; }
  .kv2-item span { display:block; font-size:12px; color:var(--sub); }
  .kv2-item b { display:inline-block; font-size:15px; font-weight:700; margin-top:2px; word-break:break-all; color:var(--ink); }
  .kv2-item.ok { border-left-color:var(--blue); } .kv2-item.ok b { color:var(--e-blue); }
  .kv2-item.warn { border-left-color:var(--red); } .kv2-item.warn b { color:var(--e-red); }
  /* 三相电压模板（深蓝渐变基准条） */
  .phase-wrap { display:grid; grid-template-columns:repeat(3,1fr); gap:14px; margin:22px 0 4px; }
  .phase { background:linear-gradient(180deg,rgba(18,34,64,.7),rgba(10,18,36,.6)); border:1px solid var(--line); border-radius:18px; padding:18px 18px 16px; text-align:center; box-shadow:0 8px 20px rgba(0,0,0,.35); }
  .phase-label { font-size:13px; color:var(--sub); font-weight:700; letter-spacing:1px; }
  .phase-bar { height:7px; border-radius:7px; margin:14px 0 10px; overflow:hidden; background:rgba(140,180,255,.14); }
  .phase-fill { height:100%; border-radius:7px; }
  .phase.ok .phase-fill { background:linear-gradient(90deg,var(--deep),var(--e-blue)); box-shadow:0 2px 10px rgba(59,130,246,.45); }
  .phase.low .phase-fill { background:linear-gradient(90deg,var(--red),#ff8a5c); box-shadow:0 2px 10px rgba(255,90,78,.45); }
  .phase-val { font-size:26px; font-weight:800; letter-spacing:-.5px; }
  .phase-note { font-size:13px; color:var(--ink); margin:16px 2px 0; background:rgba(59,130,246,.07); border:1px solid rgba(120,170,255,.30); border-left:4px solid var(--blue); border-radius:14px; padding:12px 16px; }
  .phase-note.alert { background:rgba(255,90,78,.09); border-color:rgba(255,90,78,.36); border-left-color:var(--red); }
  .phase-note b { color:#fff; font-weight:700; }
  /* 多线路标签（母线接地，深蓝统一底色 + 字色区分主线/支线） */
  .line-tags { display:flex; flex-wrap:wrap; gap:10px; margin-top:6px; }
  .line-tag { border-radius:12px; padding:9px 14px; font-size:14px; font-weight:700; }
  .line-tag.main { background:linear-gradient(135deg,rgba(59,130,246,.26),rgba(12,24,46,.6)); border:1px solid rgba(130,175,255,.75); color:#cfe0ff; box-shadow:0 4px 14px rgba(59,130,246,.16); }
  .line-tag.branch { background:linear-gradient(135deg,rgba(140,180,255,.12),rgba(12,24,46,.45)); border:1px dashed rgba(140,180,255,.55); color:#a9c6ff; box-shadow:0 4px 12px rgba(90,140,255,.1); }
  .line-tag small { display:block; font-size:11px; font-weight:500; color:var(--sub); }
  /* 原始输入折叠 */
  details.raw-inline { margin-top:14px; }
  details.raw-inline summary { cursor:pointer; font-size:12.5px; color:var(--e-blue); }
  details.raw-inline pre { background:rgba(9,16,32,.6); border:1px dashed var(--blue); border-radius:12px; padding:12px 14px; font-size:12.5px; line-height:1.7; white-space:pre-wrap; word-break:break-all; margin-top:8px; max-height:260px; overflow:auto; color:var(--ink); }
  /* 原始全文折叠 */
  details.rawbox { margin-top:36px; background:var(--card); border:1px solid var(--line); border-radius:var(--r); box-shadow:var(--sh1); overflow:hidden; scroll-margin-top:96px; }
  details.rawbox summary { cursor:pointer; padding:16px 22px; font-size:14px; font-weight:700; color:#fff; background:linear-gradient(180deg,#16253f,#0e1a2e); }
  .rawbox pre { padding:4px 22px 22px; font-size:13px; line-height:1.75; font-family:"SF Mono","Consolas","PingFang SC",monospace; white-space:pre-wrap; word-break:break-all; color:#c7d6ea; }
  .foot { text-align:center; color:var(--sub); font-size:12px; margin-top:38px; }
  @media (max-width:820px){
    .phase-wrap { grid-template-columns:1fr; }
    .kpi-grid { grid-template-columns:repeat(2,1fr); }
    .trip-flow { flex-direction:column; gap:8px; }
    .tf-line { display:none; }
  }
  /* ===== 母线接地 · 青色科技风大屏（占满屏幕 · 自适应 · 仅手动滚动） ===== */
  /* 大屏局部配色变量（作用域仅限 body.bus-screen，不影响跳闸/接地模板） */
  body.bus-screen {
    --b-cyan:#00F0FF; --b-blue:#1E90FF; --b-ink:#FFFFFF; --b-ink2:#E0E6ED;
    --b-dim:#8FA3BF; --b-bord:rgba(0,240,255,.2); --b-mod:rgba(13,27,62,.6);
    background:
      radial-gradient(1200px 600px at 50% -10%, rgba(0,240,255,.10), transparent 60%),
      radial-gradient(900px 520px at 0% 100%, rgba(30,144,255,.12), transparent 60%),
      radial-gradient(900px 520px at 100% 100%, rgba(0,240,255,.08), transparent 60%),
      #0B1221;
    height:100vh; overflow:hidden;
  }
  /* 占满屏幕 + 不同分辨率自适应（侧列宽度随屏宽缩放、标题字号 clamp） */
  .screen { height:100vh; max-width:none; margin:0; padding:14px 18px 16px; display:flex; flex-direction:column; }
  .screen-head { flex:none; text-align:center; padding:6px 0 12px; }
  .screen-title { font-size:clamp(22px,2.3vw,34px); font-weight:800; letter-spacing:6px; background:linear-gradient(90deg,#00F0FF,#1E90FF); -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent; filter:drop-shadow(0 0 18px rgba(0,240,255,.28)); }
  .screen-sub { margin-top:6px; font-size:12.5px; color:var(--b-dim); letter-spacing:2px; }
  /* 按内容量分配版面：左右列各 30%（供电所概况/试拉建议+信息同步），中间 40%（合并核心 + 线路详情） */
  .screen-grid { flex:1; min-height:0; display:grid; grid-template-columns:clamp(300px,30%,540px) minmax(0,1fr) clamp(300px,30%,540px); grid-template-rows:minmax(0,1fr); gap:14px; }
  /* 左列：线路详情（吃满高度）+ 候选线路（按内容自适应） */
  .col { display:grid; grid-template-rows:minmax(0,1fr) auto; gap:14px; min-height:0; }
  /* 中列：合并核心模块（上）+ 供电所概况（下，宽列联系人两列排布） */
  .col-mid { display:grid; grid-template-rows:minmax(0,0.7fr) minmax(0,1.3fr); gap:14px; min-height:0; }
  /* 右列：试拉建议（吃满高度）+ 信息同步（收尾，放最后，按内容自适应） */
  .col-r { display:grid; grid-template-rows:minmax(0,1fr) auto; gap:14px; min-height:0; }
  /* 模块：半透明深蓝玻璃质感 + 青色细边 + 四角科技感直角装饰 */
  .panel { background:var(--b-mod); backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px); border:1px solid var(--b-bord); border-radius:6px; box-shadow:0 10px 30px rgba(0,0,0,.4); padding:12px 14px 14px; display:flex; flex-direction:column; min-height:0; overflow:hidden; position:relative; }
  .panel::before { content:""; position:absolute; top:-1px; left:50%; transform:translateX(-50%); width:48%; height:2px; background:linear-gradient(90deg,transparent,#00F0FF,#1E90FF,transparent); }
  .panel::after { content:""; position:absolute; inset:0; pointer-events:none; border-radius:6px; background:
    linear-gradient(var(--b-cyan),var(--b-cyan)) top left / 16px 2px,
    linear-gradient(var(--b-cyan),var(--b-cyan)) top left / 2px 16px,
    linear-gradient(var(--b-cyan),var(--b-cyan)) top right / 16px 2px,
    linear-gradient(var(--b-cyan),var(--b-cyan)) top right / 2px 16px,
    linear-gradient(var(--b-cyan),var(--b-cyan)) bottom left / 16px 2px,
    linear-gradient(var(--b-cyan),var(--b-cyan)) bottom left / 2px 16px,
    linear-gradient(var(--b-cyan),var(--b-cyan)) bottom right / 16px 2px,
    linear-gradient(var(--b-cyan),var(--b-cyan)) bottom right / 2px 16px;
    background-repeat:no-repeat; }
  /* 模块标题：左侧 3px 青色竖条、靠左 */
  .panel-title { font-size:15px; font-weight:700; color:#fff; text-align:left; letter-spacing:2px; display:flex; align-items:center; gap:9px; margin-bottom:10px; flex-shrink:0; }
  .panel-title::before { content:""; width:3px; height:16px; background:var(--b-cyan); box-shadow:0 0 8px var(--b-cyan); flex-shrink:0; }
  .panel-body { flex:1; min-height:0; overflow-y:auto; overflow-x:hidden; padding-right:5px; scrollbar-width:none; -ms-overflow-style:none; }
  .panel-body::-webkit-scrollbar { display:none; }  /* 隐藏滚动条，保留滚轮/触摸板滚动 */
  /* 空数据提示 */
  .empty-hint { height:100%; min-height:120px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px; color:var(--b-dim); font-size:13px; letter-spacing:1px; }
  .empty-hint .eh-ico { font-size:26px; color:rgba(0,240,255,.45); line-height:1; }
  /* 线路选择器（半透明 + 青色边） */
  .line-select { width:100%; background:rgba(13,27,62,.6); color:#eaffff; border:1px solid rgba(0,240,255,.4); border-radius:8px; padding:8px 12px; font-size:14px; font-weight:600; outline:none; cursor:pointer; margin-bottom:10px; flex-shrink:0; }
  .line-select:focus { border-color:var(--b-cyan); box-shadow:0 0 0 2px rgba(0,240,255,.2); }
  .line-select option { background:#0B1221; color:#eaffff; }
  /* 线路详情：容器不滚、每条线路各自内滚（固定高度模块） */
  .line-detail-wrap { overflow:hidden; display:flex; flex-direction:column; padding-right:0; }
  .line-detail { flex:1; min-height:0; overflow-y:auto; overflow-x:hidden; padding-right:5px; scrollbar-width:none; -ms-overflow-style:none; }
  .line-detail::-webkit-scrollbar { display:none; }
  /* 线路详情子小节 */
  .ld-sub { margin-bottom:12px; }
  .ld-sub:last-child { margin-bottom:0; }
  .ld-sub-title { font-size:12.5px; font-weight:700; color:var(--b-cyan); line-height:1.45; margin-bottom:7px; padding-left:8px; border-left:3px solid var(--b-cyan); }
  .ld-none { font-size:12.5px; color:var(--b-dim); padding:0 2px 0 11px; }
  .ld-seg { background:rgba(8,16,32,.55); border:1px solid var(--b-bord); border-radius:8px; padding:8px 11px; margin-bottom:7px; }
  .ld-seg:last-child { margin-bottom:0; }
  .ld-seg-title { font-size:13px; font-weight:700; color:#cfefff; margin-bottom:5px; }
  .ld-row { display:flex; gap:9px; font-size:12px; line-height:1.6; padding:1.5px 0; }
  .ld-row span { color:var(--b-dim); flex-shrink:0; min-width:60px; }
  .ld-row b { color:var(--b-ink2); font-weight:650; word-break:break-all; }
  .ld-text { font-size:12px; color:var(--b-dim); line-height:1.6; padding:0 2px 0 11px; word-break:break-all; }
  /* 中上核心模块（母线接地信息 + 三相电压定位）：两块内容纵向堆叠，整体溢出时内滚 */
  .core-body { display:flex; flex-direction:column; gap:13px; }
  .core-body .volt-wrap { flex:0 0 auto; }
  .core-body .volt-note { margin-top:0; }
  .volt-wrap { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; flex:1; align-content:center; margin-top:2px; }
  .volt-note { margin-top:12px; font-size:13px; color:var(--b-ink2); background:rgba(255,77,94,.08); border:1px solid rgba(255,77,94,.36); border-left:4px solid #ff4d5e; border-radius:8px; padding:10px 14px; }
  .volt-note b { color:#fff; }
  .volt-note.ok { background:rgba(0,240,255,.06); border-color:rgba(0,240,255,.3); border-left-color:var(--b-cyan); }
  /* 试拉建议 / 信息同步 文本条目 */
  .adv-list { display:flex; flex-direction:column; gap:7px; }
  .adv-item { background:rgba(8,16,32,.55); border:1px solid var(--b-bord); border-left:3px solid var(--b-blue); border-radius:8px; padding:8px 11px; font-size:12.5px; color:var(--b-ink2); line-height:1.55; }
  .adv-item b { color:var(--b-cyan); font-weight:700; }
  .adv-item.head { background:rgba(0,240,255,.1); border-left-color:var(--b-cyan); color:#eaffff; font-weight:650; }
  /* 三相电压（青色主色，低压相红警示） */
  .bus-screen .phase { background:rgba(13,27,62,.5); border:1px solid var(--b-bord); border-radius:10px; box-shadow:none; }
  .bus-screen .phase-label { color:var(--b-dim); }
  .bus-screen .phase-bar { background:rgba(0,240,255,.12); }
  .bus-screen .phase.ok .phase-fill { background:linear-gradient(90deg,#1E90FF,#00F0FF); box-shadow:0 2px 10px rgba(0,240,255,.5); }
  .bus-screen .phase.low .phase-fill { background:linear-gradient(90deg,#ff4d5e,#ff8a5c); box-shadow:0 2px 10px rgba(255,77,94,.5); }
  /* kv 卡（母线接地信息） */
  .bus-screen .kv2-item { background:rgba(13,27,62,.5); border:1px solid var(--b-bord); border-left:3px solid var(--b-cyan); border-radius:8px; }
  .bus-screen .kv2-item span { color:var(--b-dim); }
  .bus-screen .kv2-item b { color:#fff; }
  /* 供电所概况分组 */
  .bus-screen .relay-group { background:rgba(13,27,62,.5); border:1px solid var(--b-bord); border-left:3px solid var(--b-cyan); border-radius:8px; }
  .bus-screen .relay-group-title { color:var(--b-cyan); background:linear-gradient(90deg,rgba(0,240,255,.16),rgba(0,240,255,.03)); }
  .bus-screen .relay-group-title::before { background:linear-gradient(135deg,#00F0FF,#1E90FF); }
  .bus-screen .relay-item { background:rgba(8,16,32,.55); border:1px solid var(--b-bord); border-radius:8px; }
  .bus-screen .relay-name { color:var(--b-dim); }
  .bus-screen .relay-val { color:#00F0FF; }
  .bus-screen .relay-item.relay-full { color:var(--b-ink2); }
  /* 候选线路标签 */
  .bus-screen .line-tag.main { background:linear-gradient(135deg,rgba(0,240,255,.18),rgba(13,27,62,.6)); border:1px solid rgba(0,240,255,.75); color:#cfefff; }
  .bus-screen .line-tag.branch { background:linear-gradient(135deg,rgba(30,144,255,.14),rgba(13,27,62,.5)); border:1px dashed rgba(0,240,255,.5); color:#9fd8ff; }
  /* 表格（如出现） */
  .bus-screen table.dt th { background:linear-gradient(135deg,rgba(0,240,255,.16),rgba(30,144,255,.16)); color:#fff; }
  .bus-screen table.dt td { color:var(--b-ink2); border-bottom:1px solid var(--b-bord); }
  .bus-screen table.dt tbody tr:nth-child(even) td { background:rgba(0,240,255,.04); }
  /* ===== 模块内容展示优化（仅视觉层，不改动任何数据，保证原样返回） ===== */
  /* 数值统一等宽：kV/电话/长度/编号 在大屏上竖直对齐，更易读 */
  body.bus-screen .panel-body { font-variant-numeric:tabular-nums; }
  body.bus-screen .phase-val, body.bus-screen .ld-row b, body.bus-screen .adv-item { font-variant-numeric:tabular-nums; }
  /* 三相电压做成紧凑短带（内容少，不应占大块高度） */
  body.bus-screen .phase { padding:11px 13px 12px; }
  body.bus-screen .phase-bar { margin:9px 0 7px; height:6px; }
  body.bus-screen .phase-val { font-size:22px; }
  body.bus-screen .volt-note { margin-top:10px; padding:8px 12px; font-size:12.5px; }
  /* 母线接地信息：自适应单/双列，标签左·值右，键值更清晰 */
  body.bus-screen .kv2 { grid-template-columns:repeat(auto-fit,minmax(210px,1fr)); gap:9px; }
  body.bus-screen .kv2-item { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:9px 13px; }
  body.bus-screen .kv2-item span { display:block; flex-shrink:0; }
  body.bus-screen .kv2-item b { display:block; text-align:right; word-break:break-all; }
  /* 供电所概况：列表更紧凑，姓名左·电话右等宽，远读清晰 */
  body.bus-screen .relay-list { gap:6px; }
  body.bus-screen .relay-item { padding:7px 11px; align-items:center; gap:12px; }
  body.bus-screen .relay-name { font-size:13px; }
  body.bus-screen .relay-val { font-size:13px; margin-left:auto; text-align:right; word-break:break-all; }
  body.bus-screen .relay-group { padding:10px 12px 12px; }
  body.bus-screen .relay-group + .relay-group { margin-top:8px; }
  body.bus-screen .relay-group-title { margin-bottom:8px; padding:3px 12px; font-size:13px; }
  /* 供电所概况（中列宽列）：列宽足够时联系人/值班表两列排布，窄屏自动回落单列 */
  body.bus-screen .col-mid .relay-list { grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); }
  /* 线路详情：小节标题 / 键值行字号略增，大屏远读 */
  body.bus-screen .ld-sub-title { font-size:13px; }
  body.bus-screen .ld-row { font-size:12.5px; }
  /* 试拉建议 / 信息同步：条目字号略增 */
  body.bus-screen .adv-item { font-size:13px; }
  /* 候选线路：竖向列表，线路名左·序号右，更整齐 */
  body.bus-screen .line-tags { flex-direction:column; align-items:stretch; gap:9px; }
  body.bus-screen .line-tag { display:flex; align-items:center; justify-content:space-between; gap:10px; }
  /* 窄屏回退：堆叠为单列、允许页面滚动 */
  @media (max-width:1120px){
    body.bus-screen { height:auto; min-height:100vh; overflow:auto; }
    .screen { height:auto; min-height:100vh; }
    .screen-grid { grid-template-columns:1fr; grid-template-rows:none; }
    .col, .col-mid, .col-r { grid-template-rows:none; }
    .panel { min-height:240px; }
  }
`;

function buildHtml({ query, answer, typeSections }) {
  // 主类型：按输入识别，一个看板只渲染对应的一种模板
  const mainType = pickMain(query);
  // 母线接地：走大屏三列布局
  if (mainType === '母线接地') return renderBusScreen(query, answer);
  const mainSection =
    typeSections.find((s) => s.type === mainType) || { type: mainType, text: String(query).trim() };
  const typeCards = mainSection.text ? renderTypeDetail(mainSection, answer) : '';

  // 接口返回档案完整展示
  const answerSections = parseAnswerSections(answer);
  let answerBlocks = '';
  if (answerSections.length > 0) {
    answerBlocks = answerSections
      .map((s, i) => {
        // 用户要求：首段标题统一为“供电所名称和变电运维班”
        let title = s.title;
        if (/^供电所名称/.test(title)) title = '供电所名称和变电运维班';
        return `
      <section class="card">
        <div class="card-head"><span class="card-badge">${esc(String(i + 1).padStart(2, '0'))}</span><h2>${esc(title)}</h2></div>
        <div class="card-body">${renderRowTables(s.lines)}</div>
      </section>`;
      })
      .join('');
  } else {
    const emptyNotice = answer
      ? ''
      : `<div class="text-block" style="border:1px solid rgba(255,200,100,.35);background:rgba(255,180,60,.08);color:#f0d08a;">接口本次调用未返回数据（上游工作流偶发空返回，已自动重试）。以下“接口返回”区域留空，故障针对性分析已根据您提交的故障信息完整列出。</div>`;
    answerBlocks = `<section class="card"><div class="card-head"><span class="card-badge">01</span><h2>接口返回全文</h2></div><div class="card-body">${emptyNotice || `<div class="text-block">${esc(answer)}</div>`}</div></section>`;
  }

  // KPI 提取（优先从接口返回 answer，缺失时回退到用户提交的 fault 文本）
  const src = answer || query;
  const kpiLine = (src.match(/(10kV|20kV|35kV|110kV)/) || [''])[0] || '—';
  const kpiStation = ((src.match(/([\u4e00-\u9fa5]{2,8})站/) || ['', ''])[1] ? (src.match(/([\u4e00-\u9fa5]{2,8})站/)[1] + '站') : '—');
  let kpiLoss = (src.match(/损失[\s\S]{0,6}电流[^0-9]{0,6}([0-9.\-]+)\s*A?/) || ['', '—'])[1] || '—';
  if (/^[\d.\-]+$/.test(kpiLoss)) kpiLoss += ' A';
  const kpiPre = (src.match(/跳闸前[^，,]{0,10}(有接地|无接地|有|无)/) || ['', '—'])[1] || '—';
  const kpiType = mainType;

  const kpiCards = [
    ['故障类型', kpiType],
    ['厂站名称', kpiStation === '站' ? '—' : kpiStation],
    ['电压等级', kpiLine],
    ['损失电流', kpiLoss],
    ['跳闸前接地', kpiPre],
  ]
    .map(
      ([k, v]) => `
    <div class="kpi">
      <div class="kpi-value">${esc(v)}</div>
      <div class="kpi-label">${esc(k)}</div>
    </div>`
    )
    .join('');

  const navItems = [
    ['overview', '总览'],
    [`type-${mainType}`, mainType],
    ['answer', '接口返回'],
    ['raw', '原始全文'],
  ];

  const lineName =
    (String(answer || query).match(/([\u4e00-\u9fa5A-Za-z0-9]{0,20})?10kV[a-zA-Z0-9\u4e00-\u9fa5-]*/) || [''])[0] ||
    '故障信息';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>故障信息分析看板 · 黄岛</title>
<style>${CSS}</style>
</head>
<body>
  <div class="topbar">
    <div class="topbar-in">
      <div class="brand">故障信息分析看板<small>黄岛区 · 智能体接口实时数据</small></div>
      <nav>
        ${navItems.map(([id, label]) => `<a href="#${id}">${esc(label)}</a>`).join('')}
      </nav>
    </div>
  </div>

  <div class="wrap">
    <div class="hero" id="overview">
      <h1>${esc(lineName)} · 故障分析看板</h1>
      <div class="meta">
        <span><b>数据来源：</b>接口实时返回原文</span>
        <span><b>生成时间：</b>${todayTime()}</span>
        <span><b>故障类型：</b>${mainType}</span>
      </div>
    </div>

    <div class="kpi-grid">${kpiCards}</div>

    <div class="sec">
      <div class="sec-title" id="types">故障针对性分析</div>
      <div class="sec-note">已按输入识别为「${mainType}」，展示对应专属模板</div>
      ${typeCards}
    </div>

    <div class="sec">
      <div class="sec-title" id="answer">接口返回完整档案</div>
      <div class="sec-note">智能体接口返回内容，完整展示、未作修改</div>
      ${answerBlocks}
    </div>

    <details class="rawbox" id="raw" open>
      <summary>接口返回原始全文（一字未改，共 ${String(answer).length} 字）</summary>
      <pre>${answer ? esc(answer) : '（接口本次未返回数据）'}</pre>
    </details>

    <div class="foot">数据全部来源于智能体接口返回原文与用户提交故障信息，展示时未脱敏、未修改、未删减 · 黄岛-故障信息分析助手</div>
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
    html = buildHtml({ query, answer, typeSections });
  } else {
    console.warn('[警告] 接口多次调用均未返回数据，仍将基于用户输入的故障信息生成看板。');
    html = buildHtml({ query, answer: '', typeSections });
  }

  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
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
