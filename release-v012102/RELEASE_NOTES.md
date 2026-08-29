# FocusLink v0.12.102

> 发布日期：2026-08-25
>
> 对应提交：`ebf8eb4`
>
> 发布类型：本地候选，未创建 GitHub Release
>
> 验证状态：源码、Cloud MCP、桌面/移动视觉、Electron、Android 构建与 Windows 安装通过；小米 ADB offline，未宣称三端完成

## 主要变化

- 配对码输入自动聚焦，支持带空格/换行粘贴，输入完整后自动兑换。
- owner 设备可查看并删除已配对设备；撤销后远端凭据立即失效。
- PC、华为平板与移动 Web 共用任务、Dashboard、配对、同步状态和颜色语义。

## 验证

- 根 Vitest 120 文件 / 890 项，Cloud MCP 105 项，cross-device 56 项，npm audit 0。
- 桌面 13 张、移动 360/412/640/760/915x412 明暗截图，Electron selftest/task/DB/crash、UI/mini/live smoke 通过。
- Windows 安装器静默覆盖后回读 `0.12.102`；华为 staging 回读 `0.12.102/1302`；小米 `192.168.1.5:5555` 当前 ADB offline。

## 已知限制

- 首台设备仍需完成管理员恢复授权；普通配对设备不会获得 `devices:manage`。
- 小米本轮只要求安装回读，但设备当前 offline，因此安装动作尚未发生。

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-0.12.102-x64.exe` | `1DFBAE21736721BF048E3320500A2B483A496D2B271320F23834CDD9DA6F9E38` |
| `FocusLink-0.12.102-x64-portable.exe` | `797054EA92F04221C64D03E133D53CA847C985A4D611F29928AEF585FCA40401` |
