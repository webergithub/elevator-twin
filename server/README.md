# elevator-api

电梯数字孪生的可选后台服务（PR-BE-1/2/5）。**零 npm 依赖**：node:http + node:sqlite，需 Node ≥ 22。

## 设计原则
**P-1 降级可用**：本服务是增量能力。前端在后台不可达时全部功能照常，仅隐藏保存/分享入口。任何时候都不要让前端启动依赖它。

## 本地运行
```bash
ELV_DB=./dev.db ELV_PORT=3699 node server.js
curl localhost:3699/elevator-api/health
```

## 端点
| 方法 路径 | 说明 |
|---|---|
| GET /elevator-api/health | 状态、版本、库大小、运行数 |
| POST /elevator-api/runs | 归档一次运行（**必须带 cfg.seed**，P-3 可复现） |
| GET /elevator-api/runs?limit=50 | 运行列表（含 KPI 摘要） |
| GET /elevator-api/runs/:id | 单次运行 + 逐乘客账本 |
| POST /elevator-api/scenarios | 保存命名场景，返回短链 id |
| GET /elevator-api/scenarios/:id | 取回场景配置 |

## 自我保护（P-5）
单请求 ≤1MB（超限返回 413）、单 IP 写 ≤30/分钟（超限 429）、账本 ≤3000 行、库软上限 500MB（超出 health 报 degraded）。

## 部署
见《后台服务规划 v1.0》附录 B。要点：PM2 name `elevator-api`，nginx 反代前缀 **`/elevator-api/`**（`/api/` 已被 invite-api 占用），端口 3610。
