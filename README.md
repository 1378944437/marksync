<p align="center">
  <img src="./packages/app/assets/icon.png" alt="MarkSync Logo" width="96" height="96">
</p>

<h1 align="center">MarkSync · 汇签</h1>

<p align="center">
  <strong>私有主权 · 端到端加密 · 毫秒级增量 · 跨浏览器 WebDAV 书签双向同步扩展</strong>
</p>

<p align="center">
  <a href="https://github.com/1378944437/marksync/releases/latest"><img src="https://img.shields.io/github/v/release/1378944437/marksync?color=2563eb&style=flat-square&logo=github" alt="Latest Release"></a>
  <a href="https://github.com/1378944437/marksync/releases"><img src="https://img.shields.io/github/downloads/1378944437/marksync/total?color=16a34a&style=flat-square&logo=github" alt="Downloads"></a>
  <img src="https://img.shields.io/badge/tests-611%20passed-10b981?style=flat-square&logo=vitest" alt="611 Tests Passing">
  <img src="https://img.shields.io/badge/typescript-strict-3178c6?style=flat-square&logo=typescript" alt="TypeScript Strict">
  <img src="https://img.shields.io/badge/react-19-06b6d4?style=flat-square&logo=react" alt="React 19">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-amber?style=flat-square" alt="License"></a>
</p>

<p align="center">
  <a href="./README.md"><strong>简体中文</strong></a> · <a href="./README_en.md">English</a>
</p>

---

## 💡 为什么选择 MarkSync？

书签是私密的数字资产。**MarkSync** 彻底摒弃中心化中转服务器，利用你自己的 **WebDAV 云盘**（坚果云、Nextcloud、群晖 NAS、InfiniCLOUD、Alist）或 **GitHub Gist（私密代码片段）**，在 **Chrome、Edge、Firefox** 及移动端之间实现安全、快速、自主的双向书签同步。

```
┌─────────────────┐       端到端加密通道 (TLS + AES-256-GCM)       ┌────────────────────────┐
│  本地浏览器      │ ◄────────────────────────────────────────────► │ 私有云存储 (零中转)    │
│  (Chrome/Edge/FF)│          全密态/明态多协议 · 数据完全自主掌控   │ (WebDAV / GitHub Gist) │
└─────────────────┘                                                └────────────────────────┘
```

---

## ✨ 核心特性矩阵

| 模块 | 核心能力 |
| :--- | :--- |
| ☁️ **多协议云存储驱动** | 支持 **WebDAV** 与 **GitHub Gist** 双驱动无缝切换；一键自动创建私密 Gist，支持自建 API 反代加速 |
| 🔐 **端到端加密 (E2E)** | 基于 **AES-256-GCM + PBKDF2**，数据离机即密文，云端零知识存储，支持实时强度指示与多端密码认证 |
| ⚡ **智能增量同步** | 树形 **SHA-256 结构哈希**比对，毫秒级探测增量变更，同名目录智能合并去重，杜绝书签膨胀翻倍 |
| 🛡️ **双轨快照与容灾配额** | **本地时光机快照 (IndexedDB)** 与**云端多版本备份 (WebDAV/Gist)** 双重保护；**最低强制保底 5 份**，支持用户自定义配额与自动清理 |
| 🎯 **看板直达与设备识别** | 主看板明确提示快照与备份入口；列表支持键盘展开、恢复前确认；原生解析多端**自定义设备名称**（如 `💻 客厅电脑 (Edge) · 157 书签`） |
| 📱 **极致双端适配** | 桌面端 360px 弹窗、宽屏限宽面板；移动端（Firefox Android / Kiwi）44px 列表操作热区、底部安全区与横竖屏适配；备份与快照面板打开、列表变长时保持宽度稳定 |
| 🔌 **主流服务商一键配置** | 内置坚果云、Nextcloud、群晖 Synology NAS、InfiniCLOUD、Alist 预设模板，免去繁琐拼接 URL |

---

## 🚀 1 分钟极速上手

### 1. 安装扩展
- **Chrome / Edge / Chromium 内核**：前往 [Releases 页面](https://github.com/1378944437/marksync/releases/latest) 下载 `marksync-chrome-v*.zip`，解压后在 `chrome://extensions`（开启开发者模式）点击「加载已解压的扩展程序」。
- **Firefox 火狐浏览器**：在 [Releases 页面](https://github.com/1378944437/marksync/releases/latest) 下载经 Mozilla 官方签名的 `marksync-firefox-v*.xpi`，鼠标拖入浏览器即可直接安装。

### 2. 连接云端存储（二选一）
点击扩展图标 ➔ **「设置」** ➔ **「云端存储服务」**：
- **方式 A：WebDAV**
  - 选择你的服务商预设（如坚果云或 Nextcloud），系统会自动填充 WebDAV 地址；
  - 填入账号与**应用授权密码**，先「测试当前输入」，再「保存连接配置」。测试不会保存或上传。
- **方式 B：GitHub Gist**
  - 填入具有 `gist` 权限的 Personal Access Token；
  - 点击「自动创建」或输入已有 Gist ID，测试后「保存连接配置」。多份旧备份顺序不明时，从「接管旧版 Gist 备份」选择当前版本。

首次保存、测试连接、创建 Gist 或导入配置时，浏览器会按需要申请对应主机的访问权限。拒绝授权不会替换当前配置；之后可在面板点击「授权网站访问」。Gist 大文件可能另外需要授权受信任的原始文件下载主机。

### 3. 开始同步
返回首页点击 **「立即同步」** 即可。你也可以在「同步策略」中开启 **「自动同步」**，书签变动时自动静默上云。

---

## 网站权限与提示

- 扩展保留书签、存储和闹钟权限；HTTP/HTTPS 主机权限改为按需申请，不在安装时要求访问所有网站。授权作用于主机，不隔离同一主机的端口或目录。
- 更新后检查并移除旧的全网站授权，已有连接可能需要重新授权；撤销失败会停止网络操作并提示在扩展管理中处理。可在浏览器扩展管理中撤销已授予的主机权限。
- 拒绝或撤销网站权限后，相关同步暂停，待上传修改、基线及恢复记录保留；重新授权后可手动重试，自动任务按原计划恢复。已有云端列表可能短暂显示缓存，不能据此判断连接仍可用。
- 同步完成保留扩展角标与面板日志，不再向网页注入气泡或内容脚本。「检查更新」会单独申请 GitHub API 主机权限。
- 网络请求不自动跟随重定向；WebDAV 或自定义 Gist API 请填写最终服务地址。Gist 原始下载地址仍须通过可信主机校验，浏览器授权不能绕过该限制。

## 同步与恢复说明

- 默认仅同步书签栏。比较、上传及云端恢复使用同一范围，范围外书签不参与搬移或删除。本地完整快照恢复不受云端范围限制。
- 首次使用、切换账号/目标或范围后，内容不同时需选择同步方向。数量相同不代表内容一致。
- 同步范围内书签全部删光后，需在同步面板点「发布清空到云端」；每台接收设备首次接收该清空版本时再确认。本地未上传修改也会被清空，请核对显示的目标、范围和数量；如要保留本地内容，关闭提示并手动上传。确认过期或内容、范围、云端版本变化时需重新确认，关闭普通防误删开关不能绕过。
- 清空发布保留当时的云端历史，接收前保存完整本地快照，只有双方范围内且在备份中出现的系统文件夹受影响。后续非空上传仍按常规保留策略清理历史。所有设备应先升级至支持清空同步的构建；旧版可能报备份格式不支持，不能绕过错误继续同步。没有明确清空标记的空备份会被拒绝。
- 改密、启用或关闭加密先验证并发布新备份，再保存本地设置；历史密文仍需原密码。中断时可继续迁移，或取消尚未提交的迁移；取消会核对并删除候选文件，Gist 同时恢复原当前版本。删除失败会保留迁移记录；设置已提交时仅完成收尾，不删除生效备份。旧 Gist 迁移缺少上一版本记录时需继续迁移。
- 自动创建 Gist 在后台执行；后台收到成功结果后保留最近一次创建的 ID。页面关闭后可重开设置页，将结果填入草稿并核对 Token，再保存连接配置。网络结果未知或本地保存失败时不要盲目重复创建，应先在服务端核对。
- 云端及本地快照恢复仅接受 `http:`、`https:`、`ftp:`、`ftps:` 书签。含 `javascript:`（bookmarklet）、`data:`、`file:`、`mailto:` 等其他协议时，整份恢复会在写入前拒绝，不会静默跳过节点；云端数据校验也可能因此阻止同步。
- 上传和安全快照也使用相同校验；本地含不支持协议时，会在云端写入或本地删除前停止。完整安全快照包含范围外书签，因此范围外的不支持协议也会阻止操作。
- 上传成功后若旧备份清理失败，会单独显示清理失败原因，已确认的新备份仍有效。恢复出厂先停自动同步并清配置，最后删除快照；配置清理失败时保留快照，部分完成后可重试。
- 恢复写入失败后暂停自动同步，保留操作前快照，可从恢复提示或快照页恢复。快照失败时不会继续覆盖。
- Gist 新版使用版本索引。未知顺序的历史文件不自动清理；索引异常或旧客户端产生未索引文件时停止同步。请协调同一目标上的设备升级。
- 「下次上传创建新文件」不会立即上传。配置导出默认不含密码和 Gist Token；缺少凭据的导入不会自动同步。

1.6.3 的修复、空树同步和权限验证结果见 [当前交付状态](docs/DELIVERY_STATUS.md)。真实服务、原生工具栏 popup 生命周期及 Firefox 实际交互仍待验证；前序跨浏览器记录不能代替本轮验收。发布状态以交付记录与发布页面为准。

实际使用时请参考[验收清单](docs/ACTUAL_USAGE_CHECKLIST.md)。

1.6.3 增加清空同步确认、按主机授权，修复快照与加密迁移保护，并取消网页气泡。安装包见[发布页面](https://github.com/1378944437/marksync/releases/tag/v1.6.3)。

## 🏢 常用云盘配置速览

| 服务商 | WebDAV 服务器 URL | 用户名 | 密码注意 |
| :--- | :--- | :--- | :--- |
| **坚果云** | `https://dav.jianguoyun.com/dav/` | 注册邮箱 | ⚠️ 须使用网页端「安全设置」生成的**应用授权密码** |
| **Nextcloud** | `https://your-domain.com/remote.php/dav/files/用户名/` | 登录账号 | 推荐使用应用专用密码；URL 末尾须保留斜杠 `/` |
| **群晖 NAS** | `https://nas.example.com:5006/home/` | DSM 账号 | 需安装 WebDAV Server 套件并开放对应端口 |
| **InfiniCLOUD**| `https://my.infinicloud.com/dav/` | Connection ID | 登录控制台开启 WebDAV Connection 获取连接密码 |
| **Alist / 自建** | `https://dav.example.com/dav/` | 自建用户名 | 确保开启 `PROPFIND`、`PUT`、`MKCOL` 等标准动词 |

---

## 🛠️ 极简开发者指南

```bash
# 安装依赖
pnpm install

# 运行自动化测试（结果以本次执行为准）
pnpm test

# 开发调试（支持热重载）
pnpm dev:chrome   # 或 pnpm dev:firefox

# 生产全量构建（包含 strict 类型检查）
pnpm build
```

- **架构规范**：遵循 DDD 领域分层架构（`core` / `infrastructure` / `application` / `components`）；
- **代码红线**：每个单文件严守 300 行以内单一职责标准，纯严格 TypeScript 开发。

---

## 📄 开源许可证

本项目基于 [GNU Affero General Public License v3.0 (AGPL-3.0)](./LICENSE) 协议开源，保障用户绝对的数据自主与自由。
