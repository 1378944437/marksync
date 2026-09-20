# 抽屉宽度稳定性验收（2026-09-20）

本批仅调整 UI，未提交、推送或发布。运行产物来自当前工作区，不是已发布的 v1.6.3 包。

## 原因与修改

- 原生 dialog 默认允许滚动，抽屉从屏幕下方滑入时产生临时纵向滚动条，面板先缩窄再恢复。
- 内部列表从短变长时，滚动条又占用 6px 内容宽度。
- 共用 Drawer 外层使用 overflow-hidden，内容区使用 scrollbar-gutter: stable，并明确 flex 收缩边界。
- 仅独立控制台的文档根节点预留滚动条位置，避免影响原生 popup 的自动尺寸测量。

## 实测

隔离 Edge 配置、真实加载扩展；开启无头浏览器默认隐藏的滚动条。
六种视口/模式：360×560 桌面紧凑页、320×640 / 390×740 / 390×320 手机模拟页、1280×900 桌面控制台、390×740 手机控制台。

- 三个真实入口（本地书签、云端备份、本地快照），共 18 场景：修复前动画宽度波动均为 6px，修复后均为 0px。
- 添加合成高内容前后，修复前列表可用宽度减少 6px，修复后不变；滚动仍可达 300px，无横向溢出，Escape 正常关闭。
- 两种控制台增加/移除高内容后宽度一致。
- 原生 action popup 连续打开三次均为 360×560；五组手机视口下同步/设置页共 10 场景无横向溢出且填满视口。
- `pnpm build`：Chrome / Firefox 类型检查和构建通过。已有包体积与 Browserslist 数据过期警告仍存在。

数据见 baseline.json、results.json 与 viewport/results.json。脚本：scripts/verify-drawer-width.cjs、scripts/verify-viewport-layout.cjs；通过 MARKSYNC_PLAYWRIGHT 指向已安装模块，通过 MARKSYNC_VALIDATION_OUTPUT 指定证据目录。

## 限制

手机结果为 Edge 触屏/UA/视口模拟；未执行实体手机或原生 Firefox UI 验收。云端未连接真实服务；长列表使用 DOM 合成内容隔离滚动条变化，不作为网络同步功能验收。纯样式变更未重复全量业务单元测试。
