---
name: huangdao-fault-info-analysis
description: 黄岛跳闸/接地/母线接地故障分析、监测大屏生成、i国网信息同步推送。
---

# 黄岛-故障信息分析助手

识别跳闸 / 单线接地 / 母线多线，调 chat 接口生成 **1920×1080 监测大屏**（深藏青底、发光描边、**一标题一面板**）；可选推送 i国网「信息同步」。

## 目录

| 路径 | 用途 |
|------|------|
| `index.js` | chat 流式调用 |
| `gen_fault_html.js` | 生成看板 HTML |
| `send_iguowang.js` | i国网推送（先展示后发送） |
| `samples/*_seed.txt` | 三类离线档案 |
| `samples/query_*.example.txt` | 三类输入示例 |
| `runtime/query.txt` | 最近故障原文 |
| `runtime/push_msg.txt` | 待推送信息同步 |
| `output/*.html` | 看板产物 |

## 命令

```bash
node index.js "<故障信息>"
node gen_fault_html.js "<故障信息>"
node send_iguowang.js "<故障信息>"          # → runtime/push_msg.txt
node send_iguowang.js --send [--userid id]  # 用户确认后发送
```

离线重渲染：

```bash
FAULT_SEED_FILE=./samples/trip_seed.txt node gen_fault_html.js "$(cat ./samples/query_trip.example.txt)"
FAULT_SEED_FILE=./samples/ground_trial_seed.txt node gen_fault_html.js "$(cat ./samples/query_ground_trial.example.txt)"
FAULT_SEED_FILE=./samples/bus_seed.txt node gen_fault_html.js "$(cat ./samples/query_bus_multi.example.txt)"
```

## 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `NODE_PATH` | — | 含 axios 的 node_modules |
| `FAULT_SEED_FILE` | — | 离线 answer，跳过接口 |
| `FAULT_OUT_DIR` | `output/` | 看板输出目录 |
| `FAULT_MAX_ATTEMPTS` | `4` | 接口空返回重试次数 |

## 三种看板

| 类型 | 示例输入 | 试拉 |
|------|----------|------|
| 跳闸 | `query_trip.example.txt` + `trip_seed.txt` | 无 |
| 单线接地 | `query_ground_trial.example.txt` + `ground_trial_seed.txt` | 有 |
| 母线多线 | `query_bus_multi.example.txt` + `bus_seed.txt` | 有 |

识别：行首 `跳闸：` / `接地：` / `母线接地：`；否则关键词回退。输出 `output/故障信息分析看板_<类型>_yyyyMMdd.html`。

## 硬闸

1. `--send` 前必须先展示并确认 `runtime/push_msg.txt`
2. 推送只发「信息同步」段
3. 接口空返回重试后仍空，则仅用用户输入出看板
