# 云同步（Cloudflare）· FocusLink / Foxlink

> 2026-07-26 建立。目标：电脑关机后，ChatGPT/Claude 仍能读到专注记录与统计。

## 现状架构（已上线并验证）

```text
FocusLink（本机，权威数据）
  → 本机 Foxlink MCP (127.0.0.1:8770，服务 PoyiFoxlinkMcp)
      →出站→ 云端镜像 foxlink-mcp.focuslink-poyi-6465e9.workers.dev（Workers + D1）
```

- **同步代理**：看护服务 PoyiFleetWatchdog 每 ~5 分钟跑一轮
  `cloud_sync.py`（源码：PersonalMcpGateway 仓库 `fleet/cloud_sync.py`），
  把 foxlink_get_status / foxlink_get_today_summary / foxlink_list_sessions
  的结果推到云端 `/sync/push`；上行使用独立 `SYNC_KEY` Bearer，与 MCP 连接器的
  `ACCESS_KEY` 隔离。
- **已验证**：首轮同步成功，云端 `foxlink_get_today_summary` 返回
  `state: synced` + 本机真实快照；文档不记录个人专注明细。
- **诚实语义**：云端工具返回 synced/stale/never_synced + syncedAt；
  电脑关机时数据停留在最后同步点并如实标注 stale，不假装实时。
- Worker 源码：`C:\开发\mcp开发\foxlink-cloud-mcp`（连接 URL 与密钥见 `.dev.vars`，不入 git）。

## 下一步（可选）

- "云端命令队列"（远程开始/暂停专注）：云端存命令+过期时间，本机在线时消费执行、
  回写结果；设备离线时明确返回 device_offline。协议草案见
  PersonalMcpGateway `docs/cloud-architecture.md` P4。
- 手机端 Foxlink 若上线，同样直推 `/sync/push` 即可（协议同 Watch 项目）。
