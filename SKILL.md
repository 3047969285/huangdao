---
name: huangdao-fault-info-analysis
description: Use when 用户提交黄岛地区跳闸、接地或母线接地故障信息，需要调用分析接口、生成故障看板，或确认后推送 i国网信息同步时。
---

# 黄岛-故障信息分析助手

自动识别跳闸 / 单线接地 / 母线多线，调 chat 接口取分析结果，生成 HTML 看板；可选先展示再推送 i国网「信息同步」。接口地址与凭据封装在脚本内，无需改配置。

## 目录结构

```
黄岛-故障信息分析助手/
  SKILL.md                 # 本说明
  index.js                 # chat 流式调用
  gen_fault_html.js        # 生成 HTML 看板（监测大屏 v6 · 1920×1080）
  send_iguowang.js         # i国网信息同步（先展示后发送）
  samples/                 # 离线样例（seed / 示例输入）
  runtime/                 # 运行时落盘（query、push_msg）
  output/                  # 生成的看板 HTML
```

| 路径 | 用途 |
|------|------|
| `samples/trip_seed.txt` | 跳闸离线档案（不带试拉） |
| `samples/ground_trial_seed.txt` | 单线接地带试拉离线档案 |
| `samples/bus_seed.txt` | 母线多线离线档案 |
| `samples/query_*.example.txt` | 三类输入示例 |
| `runtime/query.txt` | 最近一次故障原文（脚本自动写） |
| `runtime/push_msg.txt` | 待推送「信息同步」（可改后再发） |
| `output/*.html` | 看板产物 |

## 何时用 / 不用

- **用**：用户给出可识别的故障文本，要看板或信息同步推送
- **不用**：纯闲聊；已有档案只改样式时用 `FAULT_SEED_FILE` 离线重渲染

## 硬闸

1. 推送前必须先展示 `runtime/push_msg.txt`，用户确认后才能 `--send`
2. 对话只报产物路径与结论摘要，完整档案落在 HTML/txt
3. 接口空返回：默认重试 4 次（`FAULT_MAX_ATTEMPTS`）；仍空则基于用户原文出看板

## 工作流

在本技能目录执行：

| 步骤 | 命令 |
|------|------|
| 1 调接口 | `node index.js "<完整故障信息>"` |
| 2 生成看板 | `node gen_fault_html.js "<完整故障信息>"` |
| 3 展示推送稿 | `node send_iguowang.js "<完整故障信息>"` |
| 4 确认发送 | `node send_iguowang.js --send [--userid <id>]` |

无参数时可复用 `runtime/query.txt`。

### 环境变量

| 变量 | 说明 |
|------|------|
| `NODE_PATH` | 指向含 `axios` 的 `node_modules` |
| `FAULT_MAX_ATTEMPTS` | 空返回重试次数，默认 `4` |
| `FAULT_SEED_FILE` | 离线档案路径 |
| `FAULT_OUT_DIR` | 看板输出目录；默认 `output/` |

```bash
export NODE_PATH="<工作区>/node_modules"
export FAULT_SEED_FILE="./samples/trip_seed.txt"
node gen_fault_html.js "$(cat ./samples/query_trip.example.txt)"
```

看板文件：`output/故障信息分析看板_<主类型>_yyyyMMdd.html`

## 主类型与模板（监测大屏 v6）

识别：优先行首 `跳闸：` / `接地：` / `母线接地：`；否则关键词回退。**三种输入各一套独立看板**，深藏青底、顶栏标题、发光描边面板，**1920×1080 一屏铺满、无长页滚动**。接口返回按标题分段，**一个标题一块面板**；数字用环/条图，列表用紧凑行。

| 类型 | 输入示例 | 日报面板 | 档案面板（接口标题） | 试拉 |
|------|----------|----------|----------------------|------|
| 跳闸（不带试拉） | `query_trip.example.txt` | 跳闸过程、过流动作 | 供电所名称～信息同步（一至七） | 无 |
| 单线接地（带试拉） | `query_ground_trial.example.txt` | 三相电压、接地信息 | 一至八（含试拉建议） | 有 |
| 母线多线 | `query_bus_multi.example.txt` | 母线接地信息、三相电压、候选线路 | 供电所概况、各线路、试拉建议、信息同步 | 有 |

顶栏 KPI 条 + 6 列网格面板；时间字段不被冒号拆碎；不含地图。

## 标准输入字段

| 类型 | 字段 |
|------|------|
| 跳闸 | 厂站、线路、过流动作（装置/类型/时间/值）、跳闸前接地、跳闸后复归、损失负荷电流 |
| 接地 | 相别、Ua/Ub/Uc、是否有接地选线、选线线路名、是否瞬时接地 |
| 母线接地 | 厂站、母线名称、相别、Ua/Ub/Uc、是否有接地选线、选线线路名、是否瞬时接地 |

## 流式事件（index.js）

- `message` → 增量 `data.answer`
- `workflow_finished` → `outputs.answer` / `url`
- `node_finished`（http-request）→ `body.url`
- `message_end` → `data.files`

## i国网推送

1. `node send_iguowang.js "<故障>"` → `runtime/push_msg.txt`
2. 用户编辑确认
3. `node send_iguowang.js --send [--userid <id>]`

userid：`--userid` > `~/.claude` / `~/.sgcode` 文档中 32 位 hex > 路径中的 32 位 id。可用 `--seed samples/bus_seed.txt` 离线提取。

## 常见失误

| 失误 | 处理 |
|------|------|
| 找不到 axios | 设 `NODE_PATH` |
| 找不到 query / push_msg | 看 `runtime/`，不是根目录 |
| seed 路径写旧名 | 用 `samples/xxx_seed.txt` |
| 直接 `--send` | 先展示并确认 |
| 跳闸看板出现试拉 | 检查输入是否为 `跳闸：`，试拉仅接地/母线 |
