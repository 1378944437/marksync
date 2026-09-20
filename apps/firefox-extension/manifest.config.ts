import { defineManifest } from "@crxjs/vite-plugin";

// @ts-ignore
import { version } from "../../package.json";

const manifest = defineManifest({
  manifest_version: 3,
  // 名称/描述通过 _locales 本地化（packages/app/assets/_locales/）
  default_locale: "zh_CN",
  name: "__MSG_extName__",
  version: version,
  description: "__MSG_extDescription__",
  action: {
    default_popup: "index.html",
    default_icon: {
      "16": "icon-16.png",
      "32": "icon-32.png",
      "48": "icon-48.png",
      "128": "icon.png",
    },
  },
  options_ui: {
    page: "index.html",
    open_in_tab: true,
  },
  permissions: ["bookmarks", "storage", "alarms"],
  optional_host_permissions: ["http://*/*", "https://*/*"],
  background: {
    scripts: ["src/background.ts"],
    type: "module",
  },
  icons: {
    "16": "icon-16.png",
    "32": "icon-32.png",
    "48": "icon-48.png",
    "128": "icon.png",
  },
});

// Firefox 特定配置 - 手动添加到最终 manifest
// @ts-expect-error Firefox-specific property not in Chrome types
manifest.browser_specific_settings = {
  gecko: {
    // 独立 ID：上游（Yueby）用 bookmark-syncer@example.com 签名并绑定在其账号上，
    // 本 fork 品牌为 marksync，使用自己的 ID 签名分发（与上游互不干扰）
    id: "marksync@example.com",
    strict_min_version: "140.0", // Firefox 140+ 支持 data_collection_permissions
    data_collection_permissions: {
      required: ["none"], // 声明不收集任何数据
    },
  },
};

export default manifest;
