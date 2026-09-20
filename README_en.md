<p align="center">
  <img src="./packages/app/assets/icon.png" alt="MarkSync Logo" width="96" height="96">
</p>

<h1 align="center">MarkSync</h1>

<p align="center">
  <strong>Privacy-First · E2E Encrypted · Incremental · Cross-Browser WebDAV Bookmark Sync Extension</strong>
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
  <a href="./README.md">简体中文</a> · <a href="./README_en.md"><strong>English</strong></a>
</p>

---

## 💡 Why MarkSync?

Your bookmarks represent private digital assets. **MarkSync** removes third-party relay servers completely, returning total data sovereignty to you. Sync seamlessly between **Chrome, Edge, Firefox**, and mobile devices via your personal **WebDAV** storage (Nutstore, Nextcloud, Synology NAS, InfiniCLOUD, Alist) or **GitHub Gist (secret snippets)**.

```
┌──────────────────┐        E2E Encrypted Channel (TLS + AES-256-GCM)        ┌─────────────────────────┐
│  Local Browser   │ ◄─────────────────────────────────────────────────────► │  Private Cloud Storage  │
│  (Chrome/Edge/FF)│           Zero Relay Servers · 100% Data Sovereignty    │  (WebDAV / GitHub Gist) │
└──────────────────┘                                                         └─────────────────────────┘
```

---

## ✨ Core Feature Matrix

The popup opens without horizontal or card slide-in motion; count loading rows keep a fixed height. The cloud count shows “—” while loading, without a skeleton block.
Desktop popup content fills the browser window without an extra rounded outer border; mobile views remain edge-to-edge.

The About & updates page lists separate “Project on GitHub” and “Forked from” links using repository names instead of raw URLs. Updates require manual download and installation.
Scrollbars are hidden; mouse-wheel, touch and keyboard scrolling remain available.
Settings help supports click, hover and keyboard focus. Retention fields show one pair of step buttons; backup file intervals use a dropdown.

On a new device with no bookmarks, enable encryption using the existing cloud passphrase. After verification, only local settings are saved; download your bookmarks from the sync panel without publishing an empty backup.

| Feature | Description |
| :--- | :--- |
| ☁️ **Multi-Protocol Cloud Storage** | Seamlessly switch between **WebDAV** and **GitHub Gist**; 1-click auto-creation of secret Gists with custom API proxy endpoint support. |
| 🔐 **End-to-End Encryption (E2E)** | Authenticated **AES-256-GCM + PBKDF2**. Bookmarks are encrypted before leaving your browser; zero-knowledge storage in the cloud with real-time strength indication. |
| ⚡ **Smart Incremental Sync** | Tree-level **SHA-256 hash** comparison detects minimal deltas in milliseconds. Smart folder normalization prevents duplicate bloating. |
| 🛡️ **Dual-Track Disaster Recovery** | **Local snapshots (IndexedDB)** and **cloud multi-version backups (WebDAV/Gist)**. **Guaranteed minimum 5 copies protection** with custom quota and auto-rotation. |
| 🎯 **Direct Access & Device Tags** | Dashboard cards explain their snapshot/backup destination; lists support keyboard expansion and confirmation before restoring. Native parsing of custom device names (e.g. `💻 Living Room PC (Edge) · 157 bookmarks`). |
| 📱 **Responsive & Mobile-Ready** | A 360px desktop popup and bounded panels on wide screens; mobile layouts (Firefox Android / Kiwi) with 44px list action targets, bottom safe-area spacing and portrait/landscape support. Backup and snapshot panels use a fixed height and fade in; loading or expanding lists keeps their frame position and width stable. |
| 🔌 **1-Click Cloud Presets** | Built-in templates for Nutstore, Nextcloud, Synology NAS, InfiniCLOUD, and Alist — no manual URL construction needed. |

---

## 🚀 Quick Start in 1 Minute

### 1. Install Extension
- **Chrome / Edge / Chromium-based**: Download `marksync-chrome-v*.zip` from [Releases](https://github.com/1378944437/marksync/releases/latest), unpack it, and click "Load unpacked" on `chrome://extensions` (with Developer mode enabled).
- **Firefox**: Download Mozilla-signed `marksync-firefox-v*.xpi` from [Releases](https://github.com/1378944437/marksync/releases/latest) and drag it into your browser window.

### 2. Connect Cloud Storage (Choose Either)
Click the MarkSync icon ➔ **Settings** ➔ **Cloud Storage**:
- **Option A: WebDAV**
  - Choose your provider preset (e.g. Nutstore or Nextcloud) to auto-fill the server URL;
  - Enter your username and **app-specific password**, click "Test these inputs", then "Save connection settings". Testing does not save or upload.
- **Option B: GitHub Gist**
  - Enter your Personal Access Token (PAT) with `gist` scope;
  - Click "Auto Create" or enter an existing Gist ID, test, then save. For multiple unordered legacy backups, choose the current version under "Adopt legacy Gist backups".

When saving, testing, creating a Gist or importing settings, the browser requests access to the required host as needed. Denial leaves the current configuration unchanged; use "Authorize site access" in the panel later. Large Gist files may also require access to a trusted raw-download host.

### 3. Sync
Return to the main page and click **Sync Now**. Enable **Auto Sync** in settings to keep changes continuously synced in the background.

---

## Site access and notifications

- The extension keeps bookmarks, storage and alarms permissions. HTTP/HTTPS host access is requested as needed, rather than requiring access to all sites at installation. Host grants do not isolate ports or directories on the same host.
- After an update, legacy all-sites grants are checked and removed. Existing connections may need authorization again. Failed removal blocks network operations and asks you to use the browser's extension manager, where granted host access can also be revoked.
- Denied or revoked access pauses affected sync operations while preserving pending edits, baselines and recovery records. Authorize again and retry manually, or wait for the existing automatic schedule. Cached cloud lists may remain briefly visible and do not prove that the connection is available.
- Completion uses the extension badge and panel logs. No page bubble or content script is injected. "Check for updates" requests GitHub API host access separately.
- Network requests do not automatically follow redirects. Enter the final WebDAV or custom Gist API address. Gist raw-download URLs must still pass the trusted-host check; a browser permission grant cannot bypass it.

## Sync and recovery behavior

- Only the bookmarks bar syncs by default. Comparison, upload and cloud restore use the same scope; excluded bookmarks are never moved or deleted. Full local snapshot restore is independent of cloud scope.
- First use, account/target changes and scope changes require a direction choice when contents differ. Matching counts do not prove matching contents.
- When no bookmarks remain in scope, select "Publish clear request" in the sync panel. Each receiving device must confirm the first application of that clear version. Unsynced local edits are also deleted: check the displayed target, folders and count. To keep local content, dismiss the notice and upload manually. Expired confirmations or changed contents, scope or cloud versions require a fresh confirmation; disabling the ordinary safety breaker does not bypass this check.
- Publishing a clear retains existing cloud history; receiving saves a full local snapshot first. Only system folders present in the backup and included in both scopes are affected. Later nonempty uploads still apply normal retention. Upgrade all devices to a build supporting empty sync first; older clients may reject the backup format and must not bypass that error. Empty backups without explicit clear intent are rejected.
- Changing, enabling or disabling encryption verifies and publishes a new backup before committing local settings. Historical encrypted files still require their original password. After interruption, resume or cancel an uncommitted migration. Cancellation verifies and deletes the candidate; Gist also restores the previous current version. Failed deletion retains the migration record. Already committed settings only need final cleanup; their backup is kept. Older Gist migrations without a previous-version record must be resumed.
- Gist creation runs in the background. Once the background receives a successful response, the latest created ID is saved locally. Reopen settings, fill the draft from that result, check the token, then save connection settings. If the network result is unknown or local persistence fails, check the provider before creating another Gist.
- Cloud and local snapshot restores accept only `http:`, `https:`, `ftp:` and `ftps:` bookmark URLs. Other schemes, including `javascript:` bookmarklets, `data:`, `file:` and `mailto:`, reject the entire restore before any writes; nodes are never silently skipped. Cloud validation may also block sync for these backups.
- Uploads and safety snapshots use the same validation. Unsupported local URLs stop cloud writes and destructive local operations before they begin. Full safety snapshots include excluded roots, so unsupported URLs outside the sync scope also block these operations.
- If old-backup cleanup fails after a successful upload, the result reports the cleanup error while keeping the verified new backup valid. Factory reset disables auto sync and removes settings before deleting snapshots. Settings cleanup failures preserve snapshots; a partially completed reset can be retried.
- Failed restore writes pause auto sync and retain the safety snapshot. Restore it through the recovery notice or snapshot page. A failed snapshot prevents replacement.
- New Gist backups use a version index. Unordered legacy files are not automatically deleted. Invalid indexes or unindexed old-client writes stop sync; coordinate upgrades across devices sharing a target.
- "Create a new file on the next upload" does not upload immediately. Configuration export excludes passwords and Gist tokens by default. Imports missing credentials do not start auto sync.

See the [current delivery status](docs/DELIVERY_STATUS.md) for the 1.6.3 fixes, empty sync and host permission results, evidence and limitations (Chinese). Real providers, native toolbar popup lifecycle and actual Firefox interactions remain unverified; earlier cross-browser evidence does not validate this batch. See the delivery record and release page for publication status.

Use the [actual usage checklist](docs/ACTUAL_USAGE_CHECKLIST.md) when validating in a real environment.

Version 1.6.3 adds explicit empty-sync confirmation and per-host access, fixes snapshot and encryption-migration safeguards, and removes page bubbles. See the [release page](https://github.com/1378944437/marksync/releases/tag/v1.6.3) for packages.

## 🏢 Common WebDAV Provider Quick Reference

| Provider | WebDAV Server URL | Username | Password Note |
| :--- | :--- | :--- | :--- |
| **Nutstore (坚果云)** | `https://dav.jianguoyun.com/dav/` | Account email | ⚠️ Must use **App Password** generated from Security Settings |
| **Nextcloud** | `https://your-domain.com/remote.php/dav/files/USER/` | Account name | App-specific password recommended; keep trailing slash `/` |
| **Synology NAS** | `https://nas.example.com:5006/home/` | DSM account | Enable WebDAV Server package and open the HTTPS port |
| **InfiniCLOUD** | `https://my.infinicloud.com/dav/` | Connection ID | Generate Connection Password in the dashboard |
| **Alist / Custom** | `https://dav.example.com/dav/` | Custom user | Ensure `PROPFIND`, `PUT`, `MKCOL` verbs are supported |

---

## 🛠️ Minimal Developer Guide

```bash
# Install dependencies
pnpm install

# Run automated tests (use the results from the current run)
pnpm test

# Development mode (with HMR)
pnpm dev:chrome   # or pnpm dev:firefox

# Production build (with strict type checks)
pnpm build
```

- **Architecture**: Domain-Driven Design (`core` / `infrastructure` / `application` / `components`);
- **Code Standard**: Strict 300-line limit per file for single responsibility; pure strict TypeScript.

---

## 📄 License

Open-sourced under the [GNU Affero General Public License v3.0 (AGPL-3.0)](./LICENSE) to guarantee full user sovereignty and privacy.
