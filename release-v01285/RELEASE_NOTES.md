# FocusLink v0.12.85

> 记录日期：2026-08-11
>
> 对应源码提交：`e75e466`（干净提交，产物内嵌 `APP_COMMIT='e75e466'` 且无 `-dirty`）
>
> 发布类型：版本记录推送
>
> 验证状态：Windows、华为与小米已实装回读；OPPO OWW221 已退役，不再开发或纳入验证；完整最终树已干净整合并推送 GitHub main（提交 40d6dec），未创建 tag、未创建 GitHub Release（用户未要求正式发布）

## 主要变化

- 0.12.84 二进制（干净提交 `1c800a8`）打包后又落地 loopback 同步服务与打包 smoke 收口，候选身份不可复用；本轮唯一源码版本升为 `0.12.85/1285`（release-v01285）。0.12.84 的 EXE/APK 只保留为历史证据，不回填本轮安装矩阵。
- loopback 同步服务规避 WHATWG Fetch forbidden port：显式 forbidden 端口在 `listen()` 前拒绝；动态端口 0 有界重绑（`MAX_DYNAMIC_PORT_BIND_ATTEMPTS=16`）且每次先关闭 forbidden listener 再重试；标准列表不可被测试 seam 绕开；并发 `listen()` 合并为同一 in-flight bind；重试耗尽后服务保持关闭。
- live fallback smoke 改为隔离 synthetic 凭据：在隔离 userData 内由 Electron `safeStorage` helper 现场加密 synthetic 非生产令牌；helper 拒绝系统临时目录之外的目标与非 `focuslink-live-fallback-` 前缀目录；初始化、加密或解密失败在有界超时内明确失败，不以 `SKIP` 计过；smoke 只读隔离 profile，不读取或复制当前账户真实凭据。
- mini smoke 增加置顶断言：置顶动作前后收起态几何与 Win32 前台窗口身份（handle/processId/title）保持不变，且不抢焦点；临时 userData 清理采用有界重试且不覆盖首个产品/断言错误。

## 验证

- 源码门禁（干净提交 `e75e466`，Node 22.22.2/npm 10.9.9）：`format:check`、`typecheck`、`lint` 全部通过；全量 Vitest 114 文件 / 801 项全部通过（含新增 `tests/deviceSyncServerPortSafety.test.ts`）；聚焦回归 `releaseLfsHygiene` + `deviceSyncServerPortSafety` 10/10 通过；`npm run build` 通过。
- 打包与 smoke（`npm run dist`）：installer/portable FileVersion 0.12.85，app.asar 仅含当前一套 main/preload/service chunks；packaged UI smoke（idle→running→paused→settings dark）、mini bring-to-front smoke、隔离 live fallback smoke（关闭 loopback 端口 → 首次实时握手失败 → 本机计时可开始可结束）均 exit 0。
- 安装矩阵实况（同版资产分别实装回读，不推断）：
  - Windows：静默覆盖 `/S` 后回读卸载注册表 `DisplayName=FocusLink 0.12.85`、`DisplayVersion=0.12.85`、UninstallString 指向生产卸载器；安装态 `FocusLink.exe` FileVersion=0.12.85。结果：PASS。
  - 华为 DBY-W09（`192.168.1.7:5555`，serial `f8630574`）：`adb install -r` 成功，回读 `versionName=0.12.85` / `versionCode=1285`；MainActivity 启动、进程存活、logcat 无 FATAL/ANR。结果：PASS。
  - 小米 xaga：恢复前旧 TCP serial `192.168.50.250:5555` 处于 offline；2026-08-11 以 mDNS serial `adb-D68P65855TPBHYWS-P0OKFa._adb-tls-connect._tcp` 重新在线后，`adb install -r` 成功，回读 `versionName=0.12.85` / `versionCode=1285`，启动无 FATAL/ANR。结果：PASS。
  - OPPO OWW221：已退役，不安装、不 smoke、不纳入新版本矩阵。
- APK 备份 SHA-256：`972FD825B9D1F5A3205AAFD92C9F8844F94F488810AD4CC918FAC9146C77D2D8`（`FocusLink-0.12.85-1285-debug.apk`，aapt 回读 `app.focuslink.mobile`、versionCode 1285）。
- LFS 门禁：移除本地 `.git/info/attributes` 防护后 `git check-attr filter diff` 两份 EXE 均报 `filter: lfs` / `diff: lfs`；显式单次暂存；`.git/lfs/tmp` 清理后回读 0 文件 / 0 B，暂存后仍为 0 文件 / 0 B。
- 说明：Windows、华为与小米三设备安装门禁已闭合；完整最终树已干净整合并推送 GitHub main（提交 40d6dec），历史超大非 LFS blob 已从该整合提交历史剔除。本记录不构成 tag 或 GitHub Release（用户未要求正式发布）；历史超大非 LFS blob 推送阻塞仅按 Bug-06 / `FL-INSTALL-006` 保留为先前证据。

## 升级提示

- Windows 覆盖安装后必须同时回读卸载注册表和安装态 EXE 版本，并重启应用。
- Android 必须对每台指定设备使用同一 APK 执行 `adb install -r`，逐台回读 `versionName=0.12.85` / `versionCode=1285`；生产连接只允许 canonical HTTPS authority，不配置 ADB reverse。
- 保留既有合法 `fl2` 凭据；新设备登录 probe 返回 `not-deployed` 时不得清除应用数据。

## 已知限制

- OPPO OWW221 已退役，不再开发或验证；历史版本中关于手表的门禁记录仅作历史保留。
- 0.12.84 的历史事故事实（Bug-05/Bug-06、LFS 1.02 GiB 事件与 FL-INSTALL-006）见 IMPLEMENTATION_LOG、SYNC_TROUBLESHOOTING 与 INSTALLER_TROUBLESHOOTING，不被本次升版改写。

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-0.12.85-x64.exe` | `582FCE3298231E1BD09A53ECD875A400B5D181E6C3EC7CF8317F6DBFB20571DF` |
| `FocusLink-0.12.85-x64-portable.exe` | `52C1E386DAE17B8F2EB56AAE4E37175BB47F368A29230326E48EA5CA3E63F00A` |

同时提供 `SHA256SUMS.txt`。哈希与产物在干净提交 `e75e466` 打包、packaged smoke 通过后复算一致。
