# MarkSync 架构与重构记录

## 当前架构补充（2026-09-14）

本文维护架构约束；任务验收见 [集中修复结果](docs/FIX_RESULTS_2026-09-14.md)。下方旧目录快照和“完成”表述属于历史记录，不表示当前产品已经全部验收。

- 分层仍为 UI / background / application → core → infrastructure。存储策略复用 provider 接口和工厂，本轮没有新增后端或依赖。现有 core 对具体 provider 工厂的导入仍是历史耦合，不宣称已完全依赖倒置。
- 书签边界统一真实根、范围过滤、受限匹配索引及整树校验；云端 hash 重算。历史无身份系统根只按已知标题识别，不按位置猜测。Firefox 菜单支持本机完整快照恢复，不进入跨浏览器云端映射。
- 页面经 background 消息请求同步、本地/云端恢复、清空、重置、Gist 接管及加密迁移。后台同步门防同实例竞态，持久化锁用于重启后的核对；页面不能传入内部跳锁/加密选项。
- `bookmark_recovery` 关联操作前快照 ID；失败后阻断自动同步，保护该快照不被淘汰或手动删除。显式恢复成功后解除记录并清除旧基线。
- 快照创建与云端备份生成共用恢复树校验；无法原样恢复的数据在持久化快照或发布前拒绝，不能用不可恢复的快照放行破坏性操作。完整安全快照也校验范围外书签。
- `encryption_migration` 在外部写入前记录候选路径、内容摘要及基线；结果未知先读回。新密码与基线在一次本地 storage 写入中提交，完成后清除临时记录。
- `pending_bookmark_upload` 与独立 ACK 保存待处理编辑；旧上传不能清除新事件。失败使用现有 alarm 重试，禁用自动同步或切换目标时保留任务但不执行。
- Gist 使用 `marksync-index.json`，version=1，包含 revision、current、entries（name/order/timestamp/legacy）。数据与索引一起 PATCH 后读回；未知文件、损坏、截断时停止写入。该协议没有分布式 CAS。
- 目标键包含驱动、端点及账号/库 ID，不含密码/Token；基线额外关联范围。无范围旧基线不用于自动决策。下载只对同一客户端原始字节去重，解密独立执行。
- 范围基线按固定字段比较布尔值，不依赖对象属性顺序；Chrome 持久化可能重排字段，不能用 JSON 字符串相等代替语义相等。手动后台消息明确携带手动日志来源及实际结果。
- FullTab 复用 SyncView；Modal/Drawer 使用原生 dialog 及 Tab 焦点边界。配置测试与保存分离；快照失败有重试入口，页面重开可读取最近后台失败。
- 输入上限：100000 节点、深度 100、解压后 64 MiB、压缩 Base64 输入 32 MiB；超限停止，不能截断后恢复。
- 空树同步（2026-09-20）：复用安全确认记录与后台 push/pull/restore 消息。空载荷正文为 `{format:'marksync-empty-v1',scope,tree}`，放在原 `data` 字段；校验后才解码为内存书签树和 `emptySync` 标记。旧数组读取器拒绝该载荷，普通备份与 E2E 格式不变。确认绑定方向、目标、范围、包含目录结构的本地/云端签名和文件版本，15 分钟有效；普通熔断开关不能放行。发布保留云端历史，接收保存完整快照并沿用恢复记录；相同基线已接收且本地未变时跳过重复清空。Firefox 专有菜单不进入清空载荷。WebDAV/Gist 均没有分布式 CAS，上传前复核不构成跨设备原子事务。

- 主机权限（2026-09-20）：HTTP/HTTPS 为可选主机权限，不注册网页内容脚本。UI 点击申请授权；infrastructure 封装平台 API，WebDAV/Gist 每次请求检查且拒绝重定向。provider 的可选 `assertAccess` 契约用于缓存读取及回填前检查；两真实驱动实现，core 不直接调用权限 API。缺权提示按具体存储目标摘要隔离；后台保留待处理状态，不申请授权。完成提示仅保留角标和日志。验收边界见 [权限交付](docs/HOST_PERMISSIONS_2026-09-20.md)。

## 历史重构记录

> 以下成果仅表示当时的结构迁移。
> 
> 原有 2500+ 行混乱代码已完全重构为清晰的 DDD 架构，职责分明，易于维护和测试。

## 重构成果总览 ✅

**原有结构（已删除）：**
- `services/bookmarkService.ts` - 982行 ❌
- `services/backupService.ts` ❌
- `services/sync/` - 约813行 ❌
- `services/webdav.ts` ❌
- `lib/bookmarksApi.ts` ❌
- `lib/browser.ts` ❌
- `lib/utils.ts` ❌
- `background/autoSync.ts` - 465行 → 改为26行转发层 ✅

**新架构（DDD）：**
- ✅ `infrastructure/` - 基础设施层（HTTP、Browser API、工具）
- ✅ `core/storage/` - 存储领域（5个模块）
- ✅ `core/backup/` - 备份领域（2个模块）
- ✅ `core/bookmark/` - 书签领域（6个模块，982行拆分）
- ✅ `core/sync/` - 同步领域（8个模块，813行拆分）
- ✅ `application/` - 应用层（5个模块）

## 已完成的工作 ✅

### 1. 新目录结构创建
已创建以下目录结构：
- `core/bookmark/` - 书签领域
- `core/sync/strategies/` - 同步策略
- `core/storage/providers/` - 存储提供者
- `core/backup/` - 备份领域
- `application/event-handlers/` - 事件处理器
- `application/use-cases/` - 用例
- `infrastructure/browser/` - 浏览器适配
- `infrastructure/http/` - HTTP 客户端
- `infrastructure/utils/` - 工具函数

### 2. 基础设施层迁移 ✅
已完成以下模块的重构和迁移：

#### Browser API 层
- ✅ `infrastructure/browser/api.ts` - 书签 API 封装
- ✅ `infrastructure/browser/info.ts` - 浏览器信息检测

#### HTTP 层
- ✅ `infrastructure/http/webdav-client.ts` - WebDAV HTTP 客户端

#### 工具函数层
- ✅ `infrastructure/utils/crypto.ts` - 加密工具（哈希计算）
- ✅ `infrastructure/utils/format.ts` - 格式化工具（类名合并、文件大小等）
- ✅ `infrastructure/utils/time.ts` - 时间工具（休眠、时间戳等）
- ✅ `infrastructure/utils/validation.ts` - 验证工具（URL验证、配置验证等）

#### 兼容层
- ✅ `lib/bookmarksApi.ts` - 指向新实现的兼容导出
- ✅ `lib/browser.ts` - 指向新实现的兼容导出
- ✅ `lib/utils.ts` - 指向新实现的兼容导出
- ✅ `services/webdav.ts` - 指向新实现的兼容导出

### 3. 构建验证 ✅
- ✅ 所有代码编译通过
- ✅ Chrome 和 Firefox 扩展构建成功
- ✅ 兼容层正常工作，现有代码无需修改导入路径

### 4. Core/Storage 领域迁移 ✅
已完成以下模块的重构和迁移：

#### Storage 核心层
- ✅ `core/storage/types.ts` - 存储类型定义（WebDAV 配置、文件信息、缓存等）
- ✅ `core/storage/cache-manager.ts` - 缓存管理器（Session Storage 缓存）
- ✅ `core/storage/queue-manager.ts` - 下载队列管理器（去重、超时控制）
- ✅ `core/storage/file-manager.ts` - 文件管理器（命名、解析、清理）
- ✅ `core/storage/index.ts` - 统一导出

#### 已更新的文件
- ✅ `services/sync/syncOperations.ts` - 已更新所有导入，使用新的 core/storage API
- ✅ `services/sync/index.ts` - 已更新导出，指向新实现
- ✅ `components/SettingsView.tsx` - 已更新 WebDAV 客户端导入
- ✅ `index.ts` - 已更新 WebDAV 客户端导出

#### 已删除的兼容层文件
- ✅ 删除 `services/sync/syncCache.ts`
- ✅ 删除 `services/sync/syncQueue.ts`
- ✅ 删除 `services/sync/syncUtils.ts`
- ✅ 删除 `services/webdav.ts`

**注意：Storage 领域已完全迁移，无兼容层残留！所有代码直接使用新架构。**

### 5. Core/Backup 领域迁移 ✅
已完成以下模块的重构和迁移：

#### Backup 核心层
- ✅ `core/backup/types.ts` - 备份类型定义（快照、配置等）
- ✅ `core/backup/snapshot-manager.ts` - 快照管理器（IndexedDB 操作）
- ✅ `core/backup/index.ts` - 统一导出

#### 已更新的文件
- ✅ `services/sync/syncOperations.ts` - 使用 `snapshotManager` 替代 `BackupService`
- ✅ `components/SyncView.tsx` - 更新快照相关操作
- ✅ `index.ts` - 导出 `snapshotManager` 和 `SnapshotManager`

#### 已删除的旧文件
- ✅ 删除 `services/backupService.ts`

**注意：Backup 领域已完全迁移，使用新的 SnapshotManager 类！**

### 6. Core/Bookmark 领域迁移 ✅
已完成以下模块的重构和迁移：

#### Bookmark 核心层
- ✅ `core/bookmark/types.ts` - 书签类型定义（节点、索引、跨浏览器映射）
- ✅ `core/bookmark/normalizer.ts` - 跨浏览器标准化（Chrome/Edge ↔ Firefox）
- ✅ `core/bookmark/hash-calculator.ts` - 哈希计算（用于内容匹配）
- ✅ `core/bookmark/comparator.ts` - 树比对（签名提取、统计）
- ✅ `core/bookmark/merger.ts` - 树合并与智能同步（全局索引、三阶段同步）
- ✅ `core/bookmark/repository.ts` - 仓储层（CRUD 操作、备份恢复）
- ✅ `core/bookmark/index.ts` - 统一导出

#### 已更新的文件
- ✅ `services/sync/syncOperations.ts` - 使用 `bookmarkRepository`、`countBookmarks`、`compareWithCloud`
- ✅ `components/SyncView.tsx` - 使用 `bookmarkRepository`、`countBookmarks`
- ✅ `index.ts` - 导出 `bookmarkRepository`
- ✅ `core/index.ts` - 导出整个 Bookmark 领域

#### 已删除的旧文件
- ✅ 删除 `services/bookmarkService.ts`（982行 → 拆分为 6 个专注的模块）

**注意：Bookmark 领域已完全迁移，原 982 行的巨型文件已拆分为清晰的 DDD 模块！**

## 待完成的工作 📋

### Phase 3: Core/Storage 领域迁移 ✅ **（完全迁移，无兼容层）**
已完成：
- ✅ `core/storage/types.ts` - 存储类型
- ✅ `core/storage/cache-manager.ts` - 缓存管理
- ✅ `core/storage/queue-manager.ts` - 下载队列
- ✅ `core/storage/file-manager.ts` - 文件管理

已迁移并删除旧文件：
- ✅ `services/sync/syncCache.ts` → `core/storage/cache-manager.ts` **（旧文件已删除）**
- ✅ `services/sync/syncQueue.ts` → `core/storage/queue-manager.ts` **（旧文件已删除）**
- ✅ `services/sync/syncUtils.ts` → `core/storage/file-manager.ts` **（旧文件已删除）**
- ✅ `services/webdav.ts` → `infrastructure/http/webdav-client.ts` **（旧文件已删除）**

已更新所有引用：
- ✅ `syncOperations.ts` - 直接使用 `cacheManager`、`queueManager`、`fileManager`
- ✅ `SettingsView.tsx` - 从 `infrastructure/http/webdav-client` 导入
- ✅ `index.ts` - 导出路径已更新

待完成（可选）：
- `core/storage/providers/local-provider.ts` - 本地存储（如需要）

### 7. Core/Sync 领域迁移（基础模块）✅
已完成以下模块的重构和迁移：

#### Sync 核心层（基础模块）
- ✅ `core/sync/types.ts` - 同步类型定义（SyncConfig、SyncResult、CloudInfo 等）
- ✅ `core/sync/lock-manager.ts` - 同步锁管理器（防止并发冲突）
- ✅ `core/sync/state-manager.ts` - 同步状态管理器（上次同步时间等）
- ✅ `core/sync/index.ts` - 统一导出

#### 已更新的文件
- ✅ `services/sync/syncOperations.ts` - 使用新的 `core/sync` 导出
- ✅ `services/sync/index.ts` - 重新导出新的 `core/sync` API
- ✅ `core/index.ts` - 导出整个 Sync 领域

#### 已删除的旧文件
- ✅ 删除 `services/sync/syncLock.ts`（95行 → lock-manager.ts）
- ✅ 删除 `services/sync/syncState.ts`（48行 → state-manager.ts）
- ✅ 删除 `services/sync/syncTypes.ts`（67行 → types.ts）

**注意：Sync 领域基础模块已完全迁移！锁管理和状态管理已进入 DDD 架构。**

### 8. Core/Sync 领域迁移（策略模块）✅
已完成以下模块的重构和迁移：

#### Sync 策略层
- ✅ `core/sync/strategies/push-strategy.ts` - 推送策略（smartPush，199行）
- ✅ `core/sync/strategies/pull-strategy.ts` - 拉取策略（smartPull，121行）
- ✅ `core/sync/strategies/smart-sync-strategy.ts` - 智能同步策略（smartSync，168行）
- ✅ `core/sync/cloud-operations.ts` - 云端操作（getCloudInfo, getCloudBackupList, restoreFromCloudBackup，226行）
- ✅ `core/sync/conflict-resolver.ts` - 冲突解决器（checkNeedsConflictResolution，31行）

#### 已更新的文件
- ✅ `core/sync/index.ts` - 导出所有策略和操作
- ✅ `services/sync/syncOperations.ts` - 改为简单转发层（13行）

**注意：原 603 行的 syncOperations.ts 已拆分为 5 个专注的策略模块！**

### Phase 5: Core/Backup 领域迁移 ✅ **（完全迁移，无兼容层）**
已完成：
- ✅ `core/backup/types.ts` - 备份类型
- ✅ `core/backup/snapshot-manager.ts` - 快照管理（IndexedDB）
- ✅ `core/backup/index.ts` - 统一导出

已迁移并删除旧文件：
- ✅ `services/backupService.ts` → `core/backup/snapshot-manager.ts` **（旧文件已删除）**

已更新所有引用：
- ✅ `syncOperations.ts` - 使用 `snapshotManager.createSnapshot()`
- ✅ `SyncView.tsx` - 使用 `snapshotManager` 的所有方法
- ✅ `index.ts` - 导出路径已更新

### 9. Application 层迁移 ✅
已完成以下模块的重构和迁移：

#### Application 层
- ✅ `application/constants.ts` - 常量定义（闹钟名称、超时配置等）
- ✅ `application/state-manager.ts` - 状态管理器（恢复状态、配置获取）
- ✅ `application/sync-executor.ts` - 同步执行器（executeUpload, executeAutoPull）
- ✅ `application/bookmark-monitor.ts` - 书签监听器（防抖同步）
- ✅ `application/scheduler.ts` - 定时调度器（Alarm 管理）
- ✅ `application/index.ts` - 统一导出公共 API

#### 已更新的文件
- ✅ `background/autoSync.ts` - 改为简单转发层（26行）

**注意：原 465 行的 autoSync.ts 已拆分为 5 个职责明确的模块！**

### 10. UI 层更新 ✅
已完成以下更新：

#### 已更新的组件
- ✅ `components/SyncView.tsx` - 直接使用 `core/sync` API
- ✅ `components/SettingsView.tsx` - 使用 `infrastructure/http/webdav-client`

**注意：所有 UI 组件已直接使用 Core 和 Application 层，不再依赖 Services 层！**

### 11. 最终清理 ✅
已完成以下清理：

#### 已删除的目录
- ✅ 删除整个 `services/` 目录（包含所有转发层和兼容层）
  - `services/sync/syncOperations.ts`（转发层）
  - `services/sync/index.ts`（转发层）
- ✅ 删除整个 `lib/` 目录（所有转发层）
  - `lib/bookmarksApi.ts`（转发到 infrastructure/browser/api）
  - `lib/browser.ts`（转发到 infrastructure/browser/info）
  - `lib/utils.ts`（转发到 infrastructure/utils）

#### 已更新的文件（直接使用 infrastructure 层）
- ✅ 8个 UI 组件：`SyncView`, `StatsCard`, `Input`, `TabNav`, `Badge`, `Card`, `Button`, `Label`
- ✅ 4个 Core 模块：`push-strategy`, `repository`, `hash-calculator`, `merger`
- ✅ `index.ts` - 主入口导出

#### 验证结果
- ✅ Chrome 扩展构建成功
- ✅ Firefox 扩展构建成功
- ✅ 无 TypeScript 错误
- ✅ 功能完整，无运行时错误

**注意：Services 和 Lib 目录已完全删除，项目已 100% 迁移到纯 DDD 架构！**

---

## ✅ 重构完成总结

### 🎯 核心成就

**✅ 100% DDD 架构实现**
- Infrastructure 层：技术实现与业务解耦
- Core 层：纯业务逻辑，易测试
- Application 层：应用协调，清晰的入口

**✅ 彻底删除兼容层**
- Services 目录已完全删除 ❌
- 无任何转发层或兼容代码残留
- 所有组件直接使用新架构

**✅ 大文件职责拆分**
- `bookmarkService.ts` (982行) → 6个专注模块
- `syncOperations.ts` (603行) → 5个策略模块
- `autoSync.ts` (465行) → 5个功能模块

### 📈 架构优势

1. **高内聚低耦合** - 每个模块职责单一
2. **易于测试** - 业务逻辑与技术实现分离
3. **跨浏览器** - Chrome/Firefox 差异统一处理
4. **可扩展** - 策略模式、仓储模式、管理器模式
5. **可维护** - 代码结构清晰，文档完整

### ⚠️ 已知问题

- Rollup 循环依赖警告（策略间相互引用，不影响功能）

---

## 重构原则（已遵循）

1. **不考虑兼容**：直接删除旧代码，无兼容层
2. **渐进式迁移**：每次迁移一个领域，保持系统可运行
3. **测试驱动**：每完成一个模块立即构建测试
4. **单一职责**：每个文件不超过 300 行
5. **清晰依赖**：核心层不依赖基础设施层具体实现

---

## 📂 最终目录结构

```
packages/app/src/
├── infrastructure/           # 基础设施层
│   ├── browser/              # 浏览器 API 适配
│   │   ├── api.ts            # 书签 API
│   │   └── info.ts           # 浏览器信息
│   ├── http/                 # HTTP 客户端
│   │   └── webdav-client.ts  # WebDAV 实现
│   └── utils/                # 工具函数
│       ├── crypto.ts         # 哈希计算
│       └── format.ts         # 格式化工具
│
├── core/                     # 核心业务层
│   ├── storage/              # 存储领域
│   │   ├── types.ts
│   │   ├── cache-manager.ts
│   │   ├── queue-manager.ts
│   │   ├── file-manager.ts
│   │   └── index.ts
│   ├── backup/               # 备份领域
│   │   ├── types.ts
│   │   ├── snapshot-manager.ts
│   │   └── index.ts
│   ├── bookmark/             # 书签领域
│   │   ├── types.ts
│   │   ├── normalizer.ts
│   │   ├── hash-calculator.ts
│   │   ├── comparator.ts
│   │   ├── merger.ts
│   │   ├── repository.ts
│   │   └── index.ts
│   ├── sync/                 # 同步领域
│   │   ├── types.ts
│   │   ├── lock-manager.ts
│   │   ├── state-manager.ts
│   │   ├── cloud-operations.ts
│   │   ├── conflict-resolver.ts
│   │   ├── strategies/
│   │   │   ├── push-strategy.ts
│   │   │   ├── pull-strategy.ts
│   │   │   └── smart-sync-strategy.ts
│   │   └── index.ts
│   └── index.ts              # Core 统一导出
│
├── application/              # 应用层
│   ├── constants.ts
│   ├── state-manager.ts      # 应用状态
│   ├── sync-executor.ts      # 同步执行
│   ├── bookmark-monitor.ts   # 书签监听
│   ├── scheduler.ts          # 定时调度
│   └── index.ts
│
├── components/               # UI 组件
├── background/               # 后台脚本
└── lib/                      # 遗留工具（待整理）
```

## 🎓 重构经验总结

### ✅ 成功经验

1. **渐进式迁移** - 每完成一个领域立即验证构建
2. **彻底删除** - 不保留兼容层，直接更新所有引用
3. **策略模式** - Sync 领域使用策略模式，代码更清晰
4. **单一职责** - 每个文件职责明确，易于理解

### 📚 设计模式应用

- **仓储模式** - BookmarkRepository 封装数据访问
- **策略模式** - Push/Pull/SmartSync 策略
- **管理器模式** - SnapshotManager、CacheManager 等
- **面向接口** - 抽象统一的 `IStorageProvider` 存储提供者接口，并提供 `createStorageProvider` 工厂模式，已原生接入 WebDAV 与 GitHub Gist 双驱动，实现无缝切换与扩展
- **同步范围** - 每设备可配置参与的系统文件夹（默认仅书签栏），范围外内容保留本地
