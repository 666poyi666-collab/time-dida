# FocusLink v0.12.60

- 发布类型：本地中间候选
- 验证状态：部分通过，存在外部门禁
- 对应基线：`a5a86d2`；包内标记 `dirty`，本轮未创建正式 release commit

## 主要变化

- 新增 Sync v2 租约 Outbox、base snapshot、Bootstrap manifest 与显式 epoch/generation。
- 拆分不可变时间账本、可编辑 metadata 和追加式账本修正；加入三方合并、tagId 语义和显式冲突。
- 新增独立设备令牌、scope、配对、防重放、撤销与轮换。
- 新增 tombstone、水位、stale 设备、graveyard、冲突中心与回收站 API。
- 部署 Cloudflare Queue 和 v2 Durable Object；保留 v1 与 Node/Docker 应急后端。
- 完成 R2 AES-256-GCM 备份和 maintenance generation 恢复代码。

## 验证摘要

- 自动化：71 个文件、486 项通过。
- Cloudflare：公网 bootstrap、applied/duplicate、revision conflict、cursor、配对、nonce 防重放、scope、Queue 诊断与重部署持久性通过。
- Docker：Linux Engine 29.6.1，镜像构建、Compose、健康和隔离集成通过。
- Android：华为 DBY-W09 已安装 `0.12.60 / 1260`，18 项 instrumentation 完成；指定小米
  `22041216C` 已通过网络 ADB 覆盖安装并回读 `0.12.60 / 1260`，原 IndexedDB 与原生连接偏好保留，
  9 项适用的 Sync/runtime 原生用例通过。PIP UI 用例被系统结束且未返回 JUnit 完成码，人工截图、
  华为专属和缺少真实云参数的用例不计作小米通过项。
- R2：Cloudflare API 返回 `10042`，真实对象写入与恢复门禁未通过。
- Windows：覆盖安装退出码 0，文件版本 `0.12.60.0`；SQLite 完整性通过，79 场会话与 19 项设置保留，158 个历史实体建立 v2 base 后 Outbox 收敛为 0。`.git/lfs/tmp` 的重复增长源已用本地 attributes 覆盖隔离；此前使用 `-LiteralPath` 的清理命令未展开通配符，需以修正后的 `-Path` 命令清空并回读为 0 后才通过 LFS 卫生门禁。

## 已知限制

- FCM、华为 Push Kit、MiPush 凭据尚未配置，HTTPS 轮询保持权威。
- 小米超级岛仍受 OEM Focus 签名白名单限制。
- 本轮不推送 main，不创建 tag 或 GitHub Release。

## SHA256

- 安装版：`E201356A2A63AE950217E199276CC40DEF867283E255D4EDB1ECD4D204DF4888`
- 便携版：`A981B26E93100690792C1A8CFBEA9A2E7EA80ABFFB05589BC3DC3702CC182083`
