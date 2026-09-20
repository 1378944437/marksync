/**
 * sync-indicator.ts 测试
 * 同步完成提示：保留角标与日志，不访问网页
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { notifySyncCompleted } from "@src/application/sync-indicator";
import browser from "webextension-polyfill";
import { addSyncLog } from '@src/core/analytics/sync-analytics';
vi.mock('@src/core/analytics/sync-analytics', () => ({ addSyncLog: vi.fn(async () => {}) }));

describe("notifySyncCompleted", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => { vi.runOnlyPendingTimers(); vi.useRealTimers(); });

  it("上传成功后闪现角标，不再查询或通知网页", async () => {
    await notifySyncCompleted("uploaded");

    expect(browser.action.setBadgeText).toHaveBeenCalledWith({ text: "✓" });
    expect(browser.tabs.query).not.toHaveBeenCalled();
    expect(browser.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it("下载成功后同样提示", async () => {
    await notifySyncCompleted("downloaded");
    expect(browser.action.setBadgeText).toHaveBeenCalledWith({ text: "✓" });
    expect(browser.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it("内容相同（skip_identical）不提示，避免噪音", async () => {
    await notifySyncCompleted("skipped");
    expect(browser.action.setBadgeText).not.toHaveBeenCalled();
    expect(browser.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it("仍记录手动同步日志，角标在原时限后清除", async () => {
    await notifySyncCompleted('uploaded', { trigger: 'manual', message: 'completed' });
    expect(addSyncLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'uploaded', trigger: 'manual', message: 'completed' }));
    vi.advanceTimersByTime(2000);
    expect(browser.action.setBadgeText).toHaveBeenLastCalledWith({ text: '' });
  });
});
