# 隐藏滚动条且不占位

透明滚动条仍占宽，嵌套设置滚动区叠加后导致页面偏左。改用 scrollbar-width:none 与 WebKit 零宽高，移除 App、Drawer 和控制台根节点的 scrollbar-gutter 预留槽。

双端构建和类型检查通过。隔离 Edge 的 360px 设置页实测卡片左右边距均为 17px、宽326px，真实滚轮可以滚动。截图见 settings.png。

scripts/verify-hidden-scrollbar.cjs 使用实际绘制的合成长内容验证：18个入口/视口组合滚轮、PageDown、零滚动条占宽通过，横纵位置波动均为0；另2个控制台检查通过。结果见 results.json。

此前使用纯空白占高元素时模拟滚轮命中失败，透明化对照的结论不充分；补充文本绘制后零宽滚动条方案正常，真实设置页亦通过，不再以透明占位作为兼容措施。

实体手机触摸及原生 Firefox UI 未验证。已保存、未提交发布，重新加载本地扩展生效。旧 hidden-scrollbar 目录为前一版透明方案证据，以本目录为准。
