# FocusLink v0.12.69

- 发布类型：本地安装候选
- 验证状态：自动化通过；本版本未完成独立的三端 PC-off 实机验收
- 对应源码：`61b2c1d`

## 主要变化

- Account Durable Object 继续作为唯一账户 authority，保持原子 outbox、cursor、ACK、稳定 opId、conflict 和 tombstone 语义。
- Android 使用 Keystore 保存凭据，WorkManager 负责网络恢复与已完成离线账本补传；认证失败、撤销和 revision rollback 均 fail-closed。
- 中央 observation registry 使用 canonical product/audience/capability，并通过持久 checkpoint 在业务空闲时续期，不改写历史 revision。

## 验证摘要

- format、typecheck、lint、自动化测试、桌面构建与 Android 构建门禁已通过。
- 本版本由后续 `0.12.70` 同版四端安装与云端 MCP 验证取代，没有单独声明物理关机、跨设备 live 接管或 production 灰度通过。

## 已知限制

- `supportsPcOff` 仍应视为未验收；没有本版本独立的手机、平板与 Windows 关机实机证据。
- 未创建公开 tag 或 GitHub Release。

## SHA256

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-0.12.69-x64.exe` | `672C50CD00DD2BCD39F68CEDEE862A3F31F4E76BA4F424D159681B6154280205` |
| `FocusLink-0.12.69-x64-portable.exe` | `46A62D74797A3F88F2267869C5E60A66F6B1359E76B93297C1585EC7000DA4ED` |
