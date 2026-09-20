# 主弹窗首次打开修复

共用抽屉修复没有覆盖主界面：App 原先首次渲染横移 20px，SyncView 卡片逐项上移 16px。此次取消首次入场动画及页面横移，计数行固定 36px，并保留主滚动区的滚动条占位、关闭滚动锚定。

scripts/verify-popup-startup.cjs 从首次 DOM 渲染逐帧采样。360px 桌面紧凑页及 320/390/430px 手机模拟页各打开两次，共八次通过：首页、卡片及其父容器无 transform 位移，计数行高始终 36px。结果见 results.json。

Chrome/Firefox 构建和类型检查通过，既有包体积/Browserslist 警告保留。此检查针对入场动画和计数高度，不等同于真实服务异步权限/错误提示、语言切换等全部布局变化已消除。实体手机和原生 Firefox 尚未验证。

v1.6.5 已成功发布并校验 Chrome ZIP 与 Firefox 签名 XPI；本次主弹窗修复在其后实施，已保存但尚未提交发布。
