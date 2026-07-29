# FocusLink v0.12.70

- 发布类型：本地安装候选
- 验证状态：自动化、生产部署、四端安装、跨设备实机闭环与云端 MCP 已通过；物理关机验收未执行
- 对应源码：`1fadcf9`

## 主要变化

- Cloudflare Account Durable Object 成为电脑、手机和平板的唯一同步 authority；Electron 不再运行 ADB reverse、自动 Android 配对或本机回环同步中继。
- correction payload、correctionId 与 opId 固定为稳定值；重复 correction 不再制造 revision conflict，历史缺陷只精确关闭可确认的合成冲突。
- 手机和平板打开且在线时直接读写云端 live；离线完成账本保存在本机并在联网后补传，云端已有其他 live 时保留明确 fork conflict。
- ChatGPT 的 FocusLink MCP 直接读取 Account DO 的已校正记录与 live，返回 task、segments、pauses、暂停时长和结束时间；OAuth 继续只授予 `focuslink:read`。
- 移除独立 staging 产品身份和验收阶段；本版本所有剩余验证直接针对生产云端执行。

## 验证摘要

- format、typecheck、lint、89 个测试文件共 590 项测试、依赖审计、38 项跨设备合同测试、桌面与云端构建、Android 单测/lint、Electron 回归均通过。
- Account DO、cloud MCP 与 OAuth 已部署；DO 冷启动不再重复扫描全部 schema，live 完成同时写 v1 与 v2，并补迁移历史 v1-only 账本。ChatGPT 在本机 FocusLink 关闭、两个 Foxlink 服务为 `Stopped + Disabled` 且 8770/8878 无监听时，实际调用 status、today summary 和 records 成功；三项 authority source 均为 `focuslink-account-do`、freshness 为 `fresh`，返回 `live=idle`、revision 62 和当天 2 条完整记录。验收后两个独立 Foxlink 服务已恢复 `Running + Automatic`。
- 安装矩阵：Windows、小米手机、华为平板和 OPPO 手表均实际安装并回读 `0.12.70 / 1270`；小米 instrumentation 18 项通过。
- 跨设备闭环：Windows FocusLink 关闭时，小米发起、华为暂停、小米继续、华为结束；华为发起、小米观察并结束。两端均看到同一两条账本：小米记录为 2 segments、1 pause（暂停 5分27.987秒），华为记录为 1 segment、0 pauses。Windows 启动并连续同步后两条记录各出现一次，既有 correction outbox/open conflict 基线不增长。

## 未完成验收

- 物理关闭整台 Windows 后的实机验收未执行；当前完成的是 FocusLink 桌面进程关闭条件下的手机/平板闭环与云端 MCP 隔离读取。
- 未创建 tag 或 GitHub Release。

## SHA256

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-0.12.70-x64.exe` | `F94AE5E0D873A8D67BF29A08168D22C870B4B632EECCB201B9DC872683266148` |
| `FocusLink-0.12.70-x64-portable.exe` | `2B44BDFE4F30662051058676B224B4F181412DC947B2864444A9540DFF564D5C` |
