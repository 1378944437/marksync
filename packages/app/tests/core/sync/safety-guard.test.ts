/**
 * safety-guard.ts 单元测试
 * 测试防误删安全阈值判定、配置存取与待确认熔断状态管理
 */
import { __resetMockStore } from "@src/__mocks__/webextension-polyfill";
import {
  clearPendingSafetyConfirmation,
  DEFAULT_SAFETY_SETTINGS,
  evaluateSafetyBreaker,
  getPendingSafetyConfirmation,
  getSafetySettings,
  saveSafetySettings,
  setPendingSafetyConfirmation,
} from "@src/core/sync/utils/safety-guard";
import { beforeEach, describe, expect, it } from "vitest";
import browser from "webextension-polyfill";

describe("SafetyGuard - 防误删安全防护", () => {
  beforeEach(() => {
    __resetMockStore();
  });

  describe("配置存取与边界保护", () => {
    it("未配置时返回默认设置（enabled: true, threshold: 20）", async () => {
      const settings = await getSafetySettings();
      expect(settings).toEqual(DEFAULT_SAFETY_SETTINGS);
    });

    it("正确持久化并读取自定义配置", async () => {
      await saveSafetySettings({ enabled: true, threshold: 30 });
      const settings = await getSafetySettings();
      expect(settings.enabled).toBe(true);
      expect(settings.threshold).toBe(30);
    });

    it("自动约束阈值在 10% ~ 50% 安全区间内", async () => {
      await saveSafetySettings({ threshold: 5 });
      expect((await getSafetySettings()).threshold).toBe(10);

      await saveSafetySettings({ threshold: 80 });
      expect((await getSafetySettings()).threshold).toBe(50);
    });
  });

  describe("熔断待确认状态管理", () => {
    it("初始状态下无待确认记录", async () => {
      const pending = await getPendingSafetyConfirmation();
      expect(pending).toBeNull();
    });

    it("能正确记录并在确认后清除", async () => {
      const record = {
        id: "safety-test-1",
        timestamp: Date.now(),
        deletedCount: 25,
        totalBefore: 100,
        deletePercentage: 25,
        threshold: 20,
      };

      await setPendingSafetyConfirmation(record);
      expect(await getPendingSafetyConfirmation()).toEqual(record);

      await clearPendingSafetyConfirmation();
      expect(await getPendingSafetyConfirmation()).toEqual(null);
    });
  });

  describe("evaluateSafetyBreaker 核心熔断判定", () => {
    it("删除数量 <= 10 条时不触发熔断（视为小幅度常规整理）", async () => {
      // 50 个删 10 个，占比 20%，但数量 <= 10，不触发
      const result = await evaluateSafetyBreaker({
        deletedCount: 10,
        totalBefore: 50,
      });
      expect(result.allowed).toBe(true);
    });

    it("删除占比低于阈值时不触发熔断", async () => {
      // 500 个删 15 个，占比 3% < 20%
      const result = await evaluateSafetyBreaker({
        deletedCount: 15,
        totalBefore: 500,
      });
      expect(result.allowed).toBe(true);
    });

    it("删除数量 > 10 且占比 >= 阈值时触发安全熔断，并自动记录待确认状态", async () => {
      // 100 个删 25 个，占比 25% >= 20%
      const result = await evaluateSafetyBreaker({
        deletedCount: 25,
        totalBefore: 100,
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("触发防误删保护");
      expect(result.confirmation?.deletedCount).toBe(25);
      expect(result.confirmation?.deletePercentage).toBe(25);

      // 验证已自动写入 storage
      const pending = await getPendingSafetyConfirmation();
      expect(pending?.deletedCount).toBe(25);
    });

    it("skipSafetyGuard 无匹配 pending 时不放行（fail-closed，重新评估）", async () => {
      const result = await evaluateSafetyBreaker({
        deletedCount: 80,
        totalBefore: 100,
        skipSafetyGuard: true,
      });
      expect(result.allowed).toBe(false);
    });

    it("skipSafetyGuard 缺少 confirmationId 时不放行（fail-closed）", async () => {
      const first = await evaluateSafetyBreaker({ context: "ctx-b", deletedCount: 25, totalBefore: 100 });
      expect(first.allowed).toBe(false);
      const retry = await evaluateSafetyBreaker({
        context: "ctx-b",
        deletedCount: 80,
        totalBefore: 100,
        skipSafetyGuard: true,
      });
      expect(retry.allowed).toBe(false);
    });

    it("功能未启用 (enabled: false) 时直接放行", async () => {
      await saveSafetySettings({ enabled: false });
      const result = await evaluateSafetyBreaker({
        deletedCount: 80,
        totalBefore: 100,
      });
      expect(result.allowed).toBe(true);
    });

    it("边界输入（totalBefore <= 0 或 deletedCount <= 0）安全放行", async () => {
      expect((await evaluateSafetyBreaker({ deletedCount: 0, totalBefore: 100 })).allowed).toBe(true);
      expect((await evaluateSafetyBreaker({ deletedCount: 15, totalBefore: 0 })).allowed).toBe(true);
    });

    it("context 与 confirmationId 完全匹配时放行（两阶段确认）", async () => {
      const first = await evaluateSafetyBreaker({ context: "ctx-a", deletedCount: 25, totalBefore: 100 });
      expect(first.allowed).toBe(false);
      const retry = await evaluateSafetyBreaker({
        context: "ctx-a",
        confirmationId: first.confirmation!.id,
        deletedCount: 80,
        totalBefore: 100,
        skipSafetyGuard: true,
      });
      expect(retry.allowed).toBe(true);
    });

    it("confirmationId 不匹配时不放行，落入正常评估并重新熔断", async () => {
      const first = await evaluateSafetyBreaker({ context: "ctx-a", deletedCount: 25, totalBefore: 100 });
      expect(first.allowed).toBe(false);
      const retry = await evaluateSafetyBreaker({
        context: "ctx-a",
        confirmationId: "forged-id",
        deletedCount: 80,
        totalBefore: 100,
        skipSafetyGuard: true,
      });
      expect(retry.allowed).toBe(false);
      // 重新评估生成了新的待确认记录（id 已更换）
      const pending = await getPendingSafetyConfirmation();
      expect(pending?.id).not.toBe(first.confirmation!.id);
    });
  });
});
