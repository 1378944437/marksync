/**
 * 配置导出与导入迁移设置区块组件
 * 支持一键打包复制当前配置代码并在新设备快速粘贴还原
 */
import { useState } from "react";
import { Check, Copy, Download, FileUp, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { SettingGroup } from "./SettingRow";
import { Button } from "../Button";
import { Input } from "../Input";
import { useStorage } from '../../hooks/useStorage';
import { requestHostPermissions } from '../../infrastructure/browser/host-permissions';
import {
  applyMigratedSettings,
  exportSettings,
  parseAndValidateSettings,
} from "../../application/settings-migrator";

export function SettingsMigrationSection() {
  const [storageType] = useStorage('storage_type', 'webdav');
  const [webdavUrl] = useStorage('webdav_url', '');
  const [gistEndpoint] = useStorage('gist_endpoint', 'https://api.github.com');
  const [includePasswords, setIncludePasswords] = useState(false);
  const [importCode, setImportCode] = useState("");
  const [isCopied, setIsCopied] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const handleExport = async () => {
    try {
      const code = await exportSettings({ includePasswords });
      await navigator.clipboard.writeText(code);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
      toast.success("配置代码已复制到剪贴板", {
        description: includePasswords
          ? "注意：配置代码中包含密码等敏感信息，请妥善保管！"
          : "已安全导出（未包含密码与私钥）。",
      });
    } catch (error) {
      toast.error("导出失败", { description: (error as Error).message });
    }
  };

  const handleImport = async () => {
    if (!importCode.trim()) {
      toast.error("请先粘贴配置代码");
      return;
    }

    const { valid, error, payload } = parseAndValidateSettings(importCode);
    if (!valid || !payload) {
      toast.error("无效的配置代码", { description: error });
      return;
    }

    setIsImporting(true);
    try {
      const s = payload.settings;
      const endpoint = (s.storage_type ?? storageType) === 'gist'
        ? (s.gist_endpoint ?? gistEndpoint) || 'https://api.github.com' : s.webdav_url ?? webdavUrl;
      if (endpoint) await requestHostPermissions([endpoint]);
      await applyMigratedSettings(payload);
      toast.success("配置导入成功", {
        description: "配置已更新，页面将自动刷新应用新设置",
      });
      setImportCode("");
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    } catch (err) {
      toast.error("应用配置失败", { description: (err as Error).message });
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <SettingGroup title="配置迁移与跨端备份">
      <div className="p-3.5 space-y-4">
        {/* 导出配置卡片 */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <Copy className="w-3.5 h-3.5 text-primary" />
              导出当前配置
            </span>
            <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-muted-foreground select-none">
              <input
                type="checkbox"
                checked={includePasswords}
                onChange={(e) => setIncludePasswords(e.target.checked)}
                className="rounded border-border text-primary focus:ring-0 w-3.5 h-3.5"
              />
              <span className="flex items-center gap-0.5">
                <KeyRound className="w-3 h-3" />
                包含密码与私钥
              </span>
            </label>
          </div>

          <p className="text-[11px] text-muted-foreground">
            将当前 WebDAV 连接、同步范围、快照配额与防误删配置打包为便携代码，方便复制到新设备。
          </p>

          <Button
            size="sm"
            variant="outline"
            className="w-full text-xs h-8 gap-1.5 bg-background hover:bg-muted font-medium"
            onClick={handleExport}
          >
            {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
            {isCopied ? "配置代码已复制！" : "生成并复制配置代码"}
          </Button>
        </div>

        <div className="h-px bg-border/50" />

        {/* 导入配置卡片 */}
        <div className="space-y-2.5">
          <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
            <FileUp className="w-3.5 h-3.5 text-primary" />
            导入配置代码
          </span>

          <Input
            type="text"
            value={importCode}
            onChange={(e) => setImportCode(e.target.value)}
            placeholder="粘贴形如 marksync://config/v1/... 的配置代码"
            className="h-8 text-xs font-mono"
          />

          <Button
            size="sm"
            variant="default"
            disabled={!importCode.trim() || isImporting}
            className="w-full text-xs h-8 gap-1.5"
            onClick={handleImport}
          >
            <Download className="w-3.5 h-3.5" />
            {isImporting ? "正在解析应用..." : "校验并一键导入配置"}
          </Button>
        </div>
      </div>
    </SettingGroup>
  );
}
