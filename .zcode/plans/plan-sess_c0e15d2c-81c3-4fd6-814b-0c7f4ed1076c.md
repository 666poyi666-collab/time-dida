# 设备授权登录 + 管理员后台:完整实现方案

## 目标(你的决定)
- 设备用**安装身份**(installationId,重启/重装不变,重置需重新授权)
- 管理员后台做在**云端**,界面我设计
- 一条龙全做:报错显示 + 完整设备授权 + README + 部署 + 真机验收

## 现状(探查结论)
后端链路已有 80% 就绪,只缺中间一环:
- ✅ **令牌签发已实现**:私有 worker `focuslink-sync` 已有 `/sync/v1/devices/register` 路由(需 `fia_*` 身份令牌),DO 的 `registerOwnerDevice` 会按 installationId 生成稳定 deviceId + `fl2_*` 令牌(365 天),重新注册只轮换密钥不换 deviceId
- ✅ **管理员登录/页面已存在**:`poyi-oauth-as` 有 `/owner/sign-in`(一次性验证码,无需账号密码)、`/owner/consent`、`/owner/devices` 页面,且有 `fls_*` 服务凭证跳板调 foxlink-cloud-mcp 的现成模式
- ❌ **缺失**:公网 `/account/v1/device/bootstrap` 端点(foxlink-cloud-mcp 里没有)→ 这就是 404 / failed to fetch 的根因;也没有"批准设备注册"的流存储和页面

## 三个仓库的改动

### 1. foxlink-cloud-mcp(gateway,加 bootstrap 端点)
- 新增 D1 迁移 `0004_bootstrap_flows.sql`:`bootstrap_flows` 表(flow_id、registration_json、poll_token_hmac、status[pending/approved/expired]、expires_at、消费标记)
- 新增 `src/bootstrap.ts`:
  - `POST /account/v1/device/bootstrap`(公网,无鉴权,走 CORS)→ `start` 建流程返回 `login-required`(flowId `flow_*`、pollToken `flb_*`、loginUrl 指向 AS 的 `/owner/device-registrations?flow=...`、retryAfterMs 750-10000、有效期 10 分钟);`poll` 回显 pending,批准后 → 调私有 worker `/sync/v1/devices/register`(带 `fia_*` + owner-subject)→ 返回 `authenticated`(endpoint=canonical、accountLabel="Poyi")
  - 服务间端点(仅 AS 可调,`fls_*` + action 头,仿 pair 模式):`/sync/v1/bootstrap/flows`(列出待批)、`/sync/v1/bootstrap/approve`(批准/拒绝)
- `src/index.ts` 接入路由;`wrangler.jsonc` 加 `FOCUSLINK_OWNER_LABEL` var 并注释新 secret
- 新增 `tests/bootstrap.test.ts`(vitest pool,仿现有 pairing 测试)

### 2. poyi-oauth-as(身份网关,加设备批准页)
- `src/worker.ts` 新增:`GET/POST /owner/device-registrations`(复用 owner session + CSRF 模式),页面列出待批准设备(设备名/型号/类型),批准/拒绝按钮;新增 `requestBootstrapFlows` / `requestBootstrapApproval` 函数(仿 `requestPairDevices`,走 `FOCUSLINK_MCP` 绑定 + `fls_*` 凭证)
- 新增测试(仿 `security.test.ts` 的 loginAndConsent 模式)

### 3. FocusLink(本仓库,文档+验收)
- 根 `README.md` 重写"FocusLink 跨设备同步"章节:单账号 Poyi;设备授权绑定(这台电脑 + 这台平板 + 这台手机);数据通用;登录 = 设备授权流(手机上不输账号密码,由 owner 在网页批准)
- `backend-design/BACKEND_SPEC.md` + `IMPLEMENTATION_LOG.md` 更新部署状态;CHANGELOG 新条目(完成后)
- 可选小改:无(客户端 bootstrap 流程已完整)

## 部署与验收
1. **部署前准备**:给 `focuslink-sync` 和 `foxlink-cloud-mcp` 配同一 `FIA_*` 身份令牌 secret;给 foxlink-cloud-mcp 配 `FOCUSLINK_BOOTSTRAP_PEPPER`
2. **迁移+部署**:foxlink-cloud-mcp D1 迁移 + deploy;poyi-oauth-as deploy;focuslink-sync 部署(确保 readyz 通过)
3. **端到端验证**:`npm run probe:account-bootstrap` → 期望 `deployed-login-required`;然后小米/华为真机点登录 → 验证码进后台 → 批准 → 手机自动开始同步;PC 验证旧凭据仍同步
4. **测试门禁**:三个仓库各自的 typecheck/lint/test 全过

## 需你知晓的边界
- 涉及**外部两个仓库**(foxlink-cloud-mcp、poyi-oauth-as)的代码与部署,你会看到我在那两个目录写代码
- 本迭代跨端登录行为有变化,按 AGENTS.md 三端门禁,代码改动后应补丁升版到 0.12.75 并重装四端——但 OPPO 手表当前离线,是否升版重装留到云功能验证通过后与你确认(不强推)
- 遗留收尾(推送 main、release-v01273 清理)在云功能落地后一并处理