# 主机权限收敛交付记录

状态：2026-09-20，代码和说明已保存，自动化验证通过，原生授权对话框与 Firefox 实际交互待验证。用户明确接受取消网页气泡并授权继续实施。版本保持 1.6.2，未提交、推送、签名或发布；此前工作区修复保留。

## 结果

- 两个 manifest 移除必需的全网权限与静态内容脚本，改为 HTTP/HTTPS 可选主机权限；删除气泡脚本及两个壳入口。同步完成角标、安全角标与面板日志保留。
- WebDAV 保存/测试，Gist 保存/测试/创建，配置导入和检查更新，在用户点击中申请所需主机权限。拒绝授权不会提交新配置或发起依赖该授权的网络操作；草稿保留。部分配置导入按合并后的实际目标再检查，不能绕过门禁启用新目标。
- WebDAV/Gist 每次 HTTP 请求前检查权限，自动同步执行入口提前暂停；云端列表通过 provider 的 `assertAccess` 契约在缓存读取前、网络返回后回填缓存前检查。缺权不当作“没有云端备份”。权限事件使旧列表缓存失效，并恢复待上传任务的调度。
- 面板和独立页面显示待授权主机。后台缺权记录用具体目标标识的 SHA-256 摘要作键，只保存缺权主机；同 API 的不同 Gist 隔离，切换目标立即隐藏旧按钮状态。不保存路径、账号或 Token 原文。
- Gist 先验证 raw URL 的可信主机，再检查浏览器授权；受信任下载主机未授权时提供单独入口，不可信地址直接拒绝。两个 HTTP 客户端拒绝自动重定向，避免授权检查之后跳往未核对地址。
- 启动及网络访问前核对旧全网授权；移除失败时停止并给出扩展管理页操作提示。保留连接配置、待上传、ACK、基线及恢复/迁移记录。既有外部写入不会因撤权而自动撤销；读回受阻时不确认成功。
- 中英文 README 同步说明授权、重新授权、气泡取消与重定向限制。凭证存储与 KDF 格式保持现状。

权限请求在按钮调用栈首次异步等待之前发起，后台不弹授权窗；可选权限声明不代表已获得全网授权，主机权限也不等于目录隔离。平台依据：[Chrome permissions](https://developer.chrome.com/docs/extensions/reference/api/permissions)、[Firefox optional_host_permissions](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/optional_host_permissions)。

## 实际验证

| 检查 | 结果与范围 |
| --- | --- |
| 全量 Vitest | 55 文件、598 用例通过；含新增 21 项权限用例及更新后的 4 项角标/日志用例 |
| 独立 app strict 类型检查 | `pnpm --filter @marksync/app exec tsc --noEmit` 通过 |
| 双浏览器构建 | `pnpm build` 通过；两份生成 manifest 无必需主机权限和内容脚本 |
| 权限浏览器检查 | 11 项通过，隔离 Edge 153.0.4234.32、本机 WebDAV/Gist 合成服务 |
| 旧本地包重载升级 | 1 项通过，同一临时配置和扩展路径，上一批真实 ZIP → 当前构建；全网授权移除且指定持久状态保持一致 |
| 空树浏览器回归 | 7 项通过，两台隔离 Edge；含真实一分钟定时同步、发布页面关闭、接收确认和部分写入后的恢复 |
| 交付核对 | 差异空白、本批代码/测试/脚本 300 行限制、本地文档链接及输入摘要核对 |

证据：[权限结果](validation/2026-09-20-host-permissions/results.json)、[升级结果](validation/2026-09-20-host-permissions/upgrade.json)、[空树回归](validation/2026-09-20-host-permissions/empty-sync/results.json)、[最终输入和构建摘要](validation/2026-09-20-host-permissions/evidence.json)。截图保存于同一目录。

权限浏览器检查覆盖：

1. 新装默认无主机授权；连接测试缺权时没有 HTTP 请求，并显示授权入口。
2. 通过测试浏览器扩展管理功能预先允许本机主机，再点击真实面板按钮，获得精确主机授权；没有模拟 `contains` 的成功结果。
3. 显式注入 `request(false)`，确认保存被拒绝且旧连接、输入草稿不变。此项不宣称点击了原生对话框“取消”。
4. 撤权后的自动上传不发请求、不 ACK、不推进基线；重新授权后实际自动上传恢复。
5. PUT 已到服务端、读回前撤权，上传报告失败，旧基线与云端历史保留；重新授权后智能同步先读回，没有重复 PUT。
6. 重定向响应不会继续访问跳转地址。
7. Gist raw 缺权显示单独主机，同 API 切换 Gist 后旧提示消失；不可信 raw 地址未获得授权或 Token 请求。

单元测试另覆盖本机/IP/IPv6/自定义端点模式、禁止 URL 类型、旧权限撤销失败、所有 WebDAV 动词、Gist 创建与更新拒权、部分导入拒权、撤权后缓存拒绝、请求中撤权禁止回填及缺权记录脱敏。IPv6 此处仅验证模式生成，不代表实际浏览器授权通过。

## 方法、限制及下一步

可复现入口：`scripts/verify-host-permissions.cjs`、`scripts/verify-permission-upgrade.cjs`、`scripts/verify-extension.cjs --empty-sync`。设置 `MARKSYNC_PLAYWRIGHT` 为已安装模块路径；空树回归用 `MARKSYNC_VALIDATION_OUTPUT` 指向本批证据子目录，避免覆盖历史证据。升级脚本依赖前批保留的本地 ZIP，只替换临时目录内容，不改源安装包。

原生授权对话框在本机无头 Edge 中一直等待，未自动点击。测试助手通过隔离浏览器的扩展管理 API 预先允许本机测试主机，随后仍由真实面板按钮调用 `permissions.request` 激活授权。这证明授权后行为，不代替原生 Accept/Cancel 交互；助手仅允许回环主机，不用于真实配置。管理接口依据为 Chromium 的 [developer_private 定义](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/common/extensions/api/developer_private.webidl)。

旧包重载使用相同版本号和未打包扩展，不证明商店升级、Firefox 升级或所有历史授权状态。真实 WebDAV/Gist、Firefox/手机、工具栏 popup、原生授权对话框与外部服务重定向兼容性仍待实际使用验收。待补：首次允许/拒绝、设置换域、配置导入、撤销与重新授权、Gist 大文件下载，以及商店或 Firefox 实际升级后的旧授权检查。

已知构建提示仍为主包超过 500 kB、Browserslist 数据过期；未通过调整阈值隐藏。网络结果未知不能盲目重复创建 Gist；本轮没有新增分布式事务或改变云端格式。

本轮已生成[本地候选包与安装验收步骤](../artifacts/marksync-v1.6.2-host-permissions-20260920/INSTALL.md)。打包前核对 264 个输入、29 个构建文件摘要与上述最终证据一致；Chrome 15 个、Firefox 14 个包内文件逐一匹配构建，manifest 引用均存在，见[包校验](validation/2026-09-20-host-permissions/packages.json)。打包复用上述测试结果，未重复执行测试或构建；未签名或发布。前批 `artifacts/marksync-v1.6.2-empty-sync-20260920/` 保留用于历史核对与升级测试，**不含本轮权限修改**。
