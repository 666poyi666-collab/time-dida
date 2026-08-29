# Known Issues

- GitHub 仓库仍名为 `time-dida`，与产品名不一致；远端改名需要单独确认和依赖核对。
- `foxlink-cloud-mcp` 旧仓库仍存在，待主仓库部署和观察期完成后再申请归档。
- 本机兼容 MCP 和云端 MCP 同时存在，文档与 UI 必须清楚标注两者用途。
- Cloudflare 中 `focuslink-sync` 与 `focuslink-sync-staging` 无活动路由，尚未确认是否可以删除。
- v0.12.104 当前候选的 packaged `smoke:ui` 在本机出现非稳定状态收敛失败（unpacked toggle/flip-history，portable paused）；portable `verify-startup`、mini 与 live-fallback 已通过，完整 UI smoke 仍未闭合。
- 公网 MCP task write 的代码、scope migration 和 Worker 已部署，但本轮没有可用 OAuth access token/浏览器授权态，未创建生产临时任务，不能把本地 MCP 回归当作生产闭环。
- 小米 `app.focuslink.mobile` 正式包与历史 `0.12.87` 签名不兼容；未卸载或清数据，当前仅以 `app.focuslink.mobile.v012104` 并行包回读 `0.12.104/1304`。
