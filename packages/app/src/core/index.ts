/**
 * Core 领域统一导出
 * 核心业务逻辑层的入口
 */

// Storage 领域
export * from "./storage";

// Backup 领域
export * from "./backup";

// Bookmark 领域
export * from "./bookmark";

// Sync 领域
export * from "./sync";
// 对外同步入口；书签树合并引擎仍从 ./bookmark 导入。
export { smartSync } from "./sync";
