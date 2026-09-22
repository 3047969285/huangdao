/**
 * 黄岛-故障信息分析助手 · i国网「信息同步」推送脚本
 *
 * 功能：把接口返回的「信息同步」内容推送到个人手机端 i国网。
 * 流程（发送前先展示 → 用户修改 → 再发送）：
 *   1) 准备/展示: node send_iguowang.js "<完整故障信息>"   [--seed <档案文件>]
 *      - 调用 chat 接口取得 answer，提取「信息同步」段，保存到 runtime/push_msg.txt 并展示；
 *      - 不带参数时自动复用 runtime/query.txt；--seed 指定离线档案可跳过接口调用
 *   2) 用户按需修改 runtime/push_msg.txt
 *   3) 发送:      node send_iguowang.js --send [--userid <id>]
 *      - 读取 runtime/push_msg.txt，POST 到 i国网 SendMessage 接口
 *
 * userid 解析优先级：--userid 参数 > ~/.claude、~/.sgcode 下 CLAUDE.md/USER.md 中 [0-9A-F]{32}
 *                  > workspace 路径中的 32 位 id
 *                  > 报错提示手动指定
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const biz = require('./index');

const IGUOWANG_API = 'http://szts.sd.sgcc.com.cn/api/proxy/api/IGuoWang/SendMessage';
const RUNTIME_DIR = path.join(__dirname, 'runtime');
const PUSH_FILE = path.join(RUNTIME_DIR, 'push_msg.txt');

function ensureRuntimeDir() {
  if (!fs.existsSync(RUNTIME_DIR)) {
    fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  }
}

function getAxios() {
  // eslint-disable-next-line global-require
  return require('axios');
}

/** 从接口返回中提取「信息同步」段（含标记行，一直取到文本末尾） */
function extractInfoSync(answer) {
  const text = String(answer || '');
  const idx = text.search(/信息同步/);
  if (idx < 0) return '';
  return text.slice(idx).trim();
}

/** userid 解析：--userid > CLAUDE.md/USER.md > workspace 路径 > null */
function resolveUserId(argv) {
  if (argv.userid) return argv.userid;
  const candidates = [
    path.join(os.homedir(), '.claude', 'CLAUDE.md'),
    path.join(os.homedir(), '.claude', 'USER.md'),
    path.join(os.homedir(), '.sgcode', 'CLAUDE.md'),
    path.join(os.homedir(), '.sgcode', 'USER.md'),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const m = fs.readFileSync(file, 'utf8').match(/[0-9A-Fa-f]{32}/);
    if (m) return m[0];
  }
  const m = String(process.cwd() + ' ' + __dirname).match(/[0-9a-fA-F]{32}/);
  return m ? m[0] : null;
}

/** 发送 i国网消息 */
async function sendMessage(userid, message) {
  const resp = await getAxios().post(
    IGUOWANG_API,
    { userid, message },
    { headers: { 'Content-Type': 'application/json' }, timeout: 15000 }
  );
  return resp.data;
}

/** 下载答案（复用 index.js 的 callChat，内置空返回重试） */
async function fetchAnswer(query, seedFile) {
  if (seedFile && fs.existsSync(seedFile)) {
    const seed = fs.readFileSync(seedFile, 'utf8').trim();
    if (seed) {
      console.log('[种子] 已载入离线档案，跳过接口调用');
      return seed;
    }
  }
  const maxAttempts = Math.max(1, parseInt(process.env.FAULT_MAX_ATTEMPTS || '4', 10) || 1);
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`[开始] 调用接口获取原始返回... (第 ${attempt} 次)`);
    const apiResult = await biz.callChat(query);
    const answer = (apiResult && apiResult.answer) || '';
    if (answer && answer.trim().length > 0) return answer;
    if (attempt < maxAttempts) {
      console.warn(`[重试] 第 ${attempt} 次返回为空，5 秒后重试...`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  return '';
}

async function main() {
  const rawArgs = process.argv.slice(2);
  const isSend = rawArgs.includes('--send');
  const argv = { userid: null, seed: null };
  const queryArgs = [];
  for (let i = 0; i < rawArgs.length; i++) {
    const a = rawArgs[i];
    if (a === '--send') continue;
    if (a === '--seed' || a === '--userid') { argv[a.slice(2)] = rawArgs[i + 1]; i++; continue; }
    queryArgs.push(a);
  }

  // ============ 发送模式 ============
  if (isSend) {
    if (!fs.existsSync(PUSH_FILE)) {
      console.error('[错误] 未找到 runtime/push_msg.txt，请先运行准备模式： node send_iguowang.js "<故障信息>"');
      process.exit(1);
    }
    const message = fs.readFileSync(PUSH_FILE, 'utf8').trim();
    if (!message) {
      console.error('[错误] runtime/push_msg.txt 内容为空');
      process.exit(1);
    }
    const userid = resolveUserId(argv);
    if (!userid) {
      console.error('[错误] 无法解析 userid，请用参数指定： node send_iguowang.js --send --userid <id>');
      process.exit(1);
    }
    console.log('[发送] 接收人 userid:', userid);
    console.log('[发送] 消息内容（' + message.length + ' 字）：');
    console.log('--- 内容开始 ---');
    console.log(message);
    console.log('--- 内容结束 ---');
    try {
      const result = await sendMessage(userid, message);
      const ok = result && result.isSuccess;
      console.log(ok ? '[成功] i国网消息发送成功' : '[失败] 接口返回: ' + JSON.stringify(result));
      if (!ok) process.exit(1);
    } catch (e) {
      console.error('[失败] 发送异常:', e.message);
      process.exit(1);
    }
    return;
  }

  // ============ 准备 / 展示模式 ============
  let query = queryArgs.join(' ');
  if (!query) query = biz.readQueryFromFile();
  if (!query) {
    console.error('[错误] 缺少故障信息。用法: node send_iguowang.js "<故障信息>" （或复用 runtime/query.txt）');
    process.exit(1);
  }

  const answer = await fetchAnswer(query, argv.seed);
  const syncText = extractInfoSync(answer);
  if (!syncText) {
    console.error('[提示] 接口返回中未找到「信息同步」段落，无法提取待推送内容。');
    console.error('接口返回原文如下：\n' + answer);
    process.exit(1);
  }

  ensureRuntimeDir();
  fs.writeFileSync(PUSH_FILE, syncText, 'utf8');
  console.log('='.repeat(60));
  console.log('[信息同步] 已提取，保存到 runtime/push_msg.txt（' + syncText.length + ' 字）');
  console.log('[信息同步] 以下为待推送内容，请按需修改 runtime/push_msg.txt：');
  console.log('='.repeat(60));
  console.log(syncText);
  console.log('='.repeat(60));
  console.log('[下一步] 修改完成并确认后运行： node send_iguowang.js --send');
}

main().catch((e) => {
  console.error('[错误]', e.message);
  process.exit(1);
});
