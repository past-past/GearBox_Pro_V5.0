/**
 * GearBox Pro V5.0 Offline-Friendly Auto Updater (electron-updater)
 *
 * Behavior:
 *  - Startup check is silent: if offline, portable build, or GitHub unreachable, it fails silently with zero popups.
 *  - Manual check (Help -> 检查软件更新...) displays clear Chinese status / error messages.
 *  - Uses native Windows taskbar progress bar during download and prompts before restarting to install.
 */
const fs = require('fs');
const path = require('path');
const { app, dialog } = require('electron');

let autoUpdater = null;
let mainWinRef = null;
let isChecking = false;
let isManualCheck = false;
let initialized = false;

function hasUpdateConfig() {
  if (!app.isPackaged) return false;
  // NSIS installed builds include resources/app-update.yml; portable builds do not.
  const cfgPath = path.join(process.resourcesPath, 'app-update.yml');
  return fs.existsSync(cfgPath);
}

function loadUpdater() {
  if (autoUpdater) return autoUpdater;
  try {
    const mod = require('electron-updater');
    autoUpdater = mod.autoUpdater;
    return autoUpdater;
  } catch (err) {
    return null;
  }
}

function initAutoUpdater(mainWindow, licenseManager) {
  mainWinRef = mainWindow;
  if (initialized) return;

  const updater = loadUpdater();
  if (!updater) return;

  initialized = true;
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = true;
  updater.allowPrerelease = false;

  updater.on('update-available', async (info) => {
    isChecking = false;
    const version = (info && info.version) ? info.version : '新版本';
    const result = await dialog.showMessageBox(mainWinRef, {
      type: 'info',
      title: '发现新版本',
      message: `检测到 GearBox Pro 新版本 V${version}`,
      detail: `当前版本：V${app.getVersion()}\n最新版本：V${version}\n\n是否立即在后台下载更新包？（覆盖更新不会丢失现有授权和参数文件）`,
      buttons: ['立即下载更新', '稍后提醒'],
      defaultId: 0,
      cancelId: 1
    });
    if (result.response === 0) {
      try {
        await updater.downloadUpdate();
      } catch (err) {
        if (mainWinRef && !mainWinRef.isDestroyed()) mainWinRef.setProgressBar(-1);
        dialog.showMessageBox(mainWinRef, {
          type: 'error',
          title: '下载更新失败',
          message: '更新包下载中断，请检查网络连接后重试。',
          detail: err && err.message ? err.message : ''
        });
      }
    }
  });

  updater.on('update-not-available', () => {
    const manual = isManualCheck;
    isChecking = false;
    isManualCheck = false;
    if (manual) {
      dialog.showMessageBox(mainWinRef, {
        type: 'info',
        title: '检查更新',
        message: '当前已是最新版本',
        detail: `您正在使用 GearBox Pro V${app.getVersion()}。`
      });
    }
  });

  updater.on('download-progress', (progress) => {
    if (mainWinRef && !mainWinRef.isDestroyed() && progress && typeof progress.percent === 'number') {
      const ratio = Math.max(0, Math.min(1, progress.percent / 100));
      mainWinRef.setProgressBar(ratio);
    }
  });

  updater.on('update-downloaded', async (info) => {
    if (mainWinRef && !mainWinRef.isDestroyed()) {
      mainWinRef.setProgressBar(-1);
    }
    const version = (info && info.version) ? info.version : '新版本';
    const result = await dialog.showMessageBox(mainWinRef, {
      type: 'info',
      title: '更新已就绪',
      message: `GearBox Pro V${version} 已下载完成`,
      detail: '点击「立即重启并更新」将自动安装新版本并重新启动软件；若选择「退出时安装」，将在您下次关闭软件时自动更新。',
      buttons: ['立即重启并更新', '退出时安装'],
      defaultId: 0,
      cancelId: 1
    });
    if (result.response === 0) {
      updater.quitAndInstall(false, true);
    }
  });

  updater.on('error', (err) => {
    const manual = isManualCheck;
    isChecking = false;
    isManualCheck = false;
    if (mainWinRef && !mainWinRef.isDestroyed()) {
      mainWinRef.setProgressBar(-1);
    }
    // 离线或网络不可达时，启动静默检查不打扰用户；仅手动检查时给出友好提示
    if (manual) {
      dialog.showMessageBox(mainWinRef, {
        type: 'warning',
        title: '检查更新失败',
        message: '无法连接更新服务器',
        detail: `请确认当前已联网，且 GitHub 仓库已设为 Public 公开仓库并发布了包含 latest.yml 的 Release。\n\n详细信息：${(err && err.message) || '网络异常'}`
      });
    }
  });

  // 启动后延迟 6 秒进行一次静默检查（仅当已打包安装且授权有效时）
  setTimeout(() => {
    if (!hasUpdateConfig()) return;
    if (licenseManager && typeof licenseManager.getStatus === 'function') {
      const lic = licenseManager.getStatus();
      if (!lic || !lic.valid) return;
    }
    checkForUpdates(false);
  }, 6000);
}

async function checkForUpdates(manual = true) {
  const updater = loadUpdater();
  if (!updater) {
    if (manual && mainWinRef) {
      dialog.showMessageBox(mainWinRef, {
        type: 'info',
        title: '检查更新',
        message: '更新模块未就绪',
        detail: '当前环境未加载 electron-updater 模块。'
      });
    }
    return;
  }

  if (!hasUpdateConfig()) {
    if (manual && mainWinRef) {
      dialog.showMessageBox(mainWinRef, {
        type: 'info',
        title: '检查更新',
        message: '当前版本不支持自动在线更新',
        detail: '自动更新仅适用于通过 Windows 安装包 (NSIS .exe) 安装的正式发行版；便携版或本地开发调试环境请直接下载新版替换。'
      });
    }
    return;
  }

  if (isChecking) return;
  isChecking = true;
  isManualCheck = Boolean(manual);

  try {
    await updater.checkForUpdates();
  } catch (err) {
    // Error event handler already handles user notification when manual === true
    isChecking = false;
    isManualCheck = false;
  }
}

module.exports = {
  initAutoUpdater,
  checkForUpdates
};
