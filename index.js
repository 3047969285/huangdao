const fs = require('fs');
const path = require('path');

// API 配置
const API_HOST = '25.40.168.143';
const API_PORT = 50008;
const BEARER_TOKEN = process.env.CHAT_API_BEARER_TOKEN;
const USER_ID = '8c61d4324a574c00a4004e55d366541e';

/** 按需加载 axios，离线 seed 渲染不强制依赖 node_modules */
function getAxios() {
  // eslint-disable-next-line global-require
  return require('axios');
}

// 运行时目录（query 等落盘文件，与脚本/样例分离）
const RUNTIME_DIR = path.resolve(__dirname, 'runtime');
const QUERY_FILE_PATH = path.join(RUNTIME_DIR, 'query.txt');

function ensureRuntimeDir() {
  if (!fs.existsSync(RUNTIME_DIR)) {
    fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  }
}

// 解析流式响应
function parseStreamEvents(dataStream) {
  const result = {
    answer: '',
    files: [],
    error: null,
    workflow_status: null,
    http_node_status: null,
    http_node_error: null,
  };

  const lines = dataStream.split('\n').filter((line) => line.startsWith('data: '));
  for (let line of lines) {
    try {
      const jsonStr = line.replace('data: ', '').trim();
      if (jsonStr === '[DONE]' || !jsonStr) continue;

      const data = JSON.parse(jsonStr);
      const event = data.event;
      const eventData = data.data || {};

      if (event === 'message') {
        const answer = eventData.answer || '';
        if (answer && !result.answer.includes(answer)) {
          result.answer += answer;
          console.log(`[回答] ${answer}`);
        }
      } else if (event === 'message_end') {
        result.files = eventData.files || [];
      } else if (event === 'workflow_finished') {
        result.workflow_status = eventData.status;
        const outputs = eventData.outputs || {};
        if (outputs.answer) result.answer = outputs.answer;
        if (outputs.url) result.files.push({ url: outputs.url });
      } else if (event === 'node_finished' && eventData.node_type === 'http-request') {
        const outputs = eventData.outputs || {};
        const status_code = outputs.status_code;
        result.http_node_status = status_code;

        if (status_code !== 200) {
          result.http_node_error = `HTTP请求失败: status=${status_code}`;
          console.error(`[HTTP节点] 失败, status_code=${status_code}`);
        } else if (outputs.body) {
          try {
            const bodyData = JSON.parse(outputs.body);
            if (bodyData.url) {
              result.files.push({ url: bodyData.url });
              console.log(`[发现下载链接] ${bodyData.url}`);
            }
          } catch (e) {
            // 忽略 JSON 解析错误
          }
        }
      } else if (event === 'node_retry' && eventData.node_type === 'http-request') {
        result.http_node_error = `HTTP重试失败: ${eventData.error}`;
        console.warn(`[HTTP重试] ${eventData.error.slice(0, 100)}`);
      }
    } catch (e) {
      // 忽略部分无效数据
    }
  }

  return result;
}

// 保存 query 到文件
function saveQueryToFile(query) {
  try {
    ensureRuntimeDir();
    fs.writeFileSync(QUERY_FILE_PATH, query, 'utf8');
    console.log(`[保存Query] 已写入 runtime/query.txt`);
    return true;
  } catch (err) {
    console.error(`[保存Query失败] ${err.message}`);
    return false;
  }
}

// 从文件读取 query
function readQueryFromFile() {
  try {
    if (fs.existsSync(QUERY_FILE_PATH)) {
      return fs.readFileSync(QUERY_FILE_PATH, 'utf8').trim();
    }
    return null;
  } catch (err) {
    console.error(`[读取Query失败] ${err.message}`);
    return null;
  }
}

// 调用 chat 接口（纯文本查询，不上传文件）
async function callChat(query) {
  if (!BEARER_TOKEN) {
    const message = '缺少环境变量 CHAT_API_BEARER_TOKEN，无法调用 Chat 接口';
    console.error(`[Chat接口失败] ${message}`);
    return { url: null, answer: '', error: message };
  }

  const url = `http://${API_HOST}:${API_PORT}/v1/chat-messages`;

  const payload = {
    inputs: {},
    query: query,
    response_mode: 'streaming',
    conversation_id: '',
    user: USER_ID,
  };

  try {
    console.log('[Chat接口] 发送流式请求...');
    console.log(`[Query] ${query.slice(0, 100)}...`);

    const res = await getAxios().post(url, payload, {
      headers: {
        Authorization: `Bearer ${BEARER_TOKEN}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      responseType: 'text',
      timeout: 300000, // 5分钟超时
    });

    console.log('[Chat接口] Content-Type:', res.headers['content-type'] || 'N/A');
    console.log('='.repeat(60));
    console.log('[流式响应开始]');
    console.log('='.repeat(60));

    const parsedResult = parseStreamEvents(res.data);

    console.log('='.repeat(60));
    console.log('[流式响应结束]');
    console.log('='.repeat(60));

    let downloadUrl = null;

    // 尝试从 files 中提取 url
    if (parsedResult.files.length > 0) {
      for (const f of parsedResult.files) {
        if (f.url) {
          downloadUrl = f.url;
          break;
        }
      }
    }

    // 尝试从 answer 中提取 url
    if (!downloadUrl && parsedResult.answer) {
      const urls = parsedResult.answer.match(/https?:\/\/[^\s"'\]\)]+/g);
      if (urls && urls.length > 0) {
        downloadUrl = urls[0];
      }
    }

    // 检查 HTTP 节点状态
    if (parsedResult.http_node_status && parsedResult.http_node_status !== 200) {
      console.warn(`[警告] 内部HTTP请求失败 (status=${parsedResult.http_node_status})`);
    }

    console.log(`[Chat接口] 返回结果: url=${!!downloadUrl}, answer长度=${parsedResult.answer.length}`);

    return {
      url: downloadUrl,
      answer: parsedResult.answer,
      workflow_status: parsedResult.workflow_status,
      http_node_status: parsedResult.http_node_status,
    };
  } catch (err) {
    console.error(`[Chat接口失败] status: ${err.response?.status || '网络错误'}`);
    console.error(`[错误内容] ${(err.response?.data || err.message).slice(0, 500)}`);
    return { url: null, answer: '', error: err.message };
  }
}

// 主流程入口
async function main(query) {
  if (!query) {
    console.error('[错误] query 不能为空');
    process.exit(1);
  }

  // 保存 query 到文件
  saveQueryToFile(query);

  console.log(`[开始处理] query长度: ${query.length}`);

  const result = await callChat(query);

  if (result) {
    console.log('\n=== 返回结果 ===');
    if (result.answer) {
      console.log('回答内容:');
      console.log(result.answer);
    }
    if (result.url) {
      console.log('\n下载链接:', result.url);
    }
    if (result.error) {
      console.error('\n错误:', result.error);
    }
    return result;
  } else {
    console.error('[错误] 调用失败');
    process.exit(1);
  }
}

// 命令行调用入口
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.log('用法: node index.js "<故障信息>"');
    process.exit(1);
  }

  const query = args.join(' ');
  main(query);
}

module.exports = { main, callChat, saveQueryToFile, readQueryFromFile };
