# FocusLink 项目地图

FocusLink 是一个产品。仓库名 `time-dida`、桌面应用目录、Cloudflare Worker 和云端 MCP 都是它的组成部分，不是多个产品。

```text
FocusLink/
├── FocusLink/                 主应用、业务服务和同步
│   ├── cloud/                 产品云端能力
│   │   └── mcp/              远程 MCP 与 D1 投影
│   └── mcp/                  旧本机兼容 MCP（迁移期）
├── release-*                 历史发布制品
└── docs/                     产品级说明与长期日志
```

云端 MCP Worker 仍使用现有 `foxlink-mcp` 生产身份，避免用户连接和数据迁移中断；代码事实来源改为本主仓库。
