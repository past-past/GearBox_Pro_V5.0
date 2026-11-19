/**
 * GearBox Pro减速机参数化设计及建模系统 V5.0 — Electron Main Process
 */
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');

const { LicenseManager } = require('./license/license-manager');
const { runSolidWorksModeling, runAutoCADModeling } = require('./cad-service');
const { initAutoUpdater, checkForUpdates } = require('./updater');

const APP_DISPLAY_NAME = 'GearBox Pro减速机参数化设计及建模系统';
const RENDERER_INDEX_PATH = path.join(__dirname, '..', 'renderer', 'index.html');
const EXPECTED_RENDERER_URL = pathToFileURL(RENDERER_INDEX_PATH).href;

let mainWindow = null;
let licenseManager = null;

// Single-instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

/**
 * Strictly validate that every IPC request originates from our own local renderer frame.
 */
function assertTrustedSender(event) {
  if (!mainWindow || !event || event.sender !== mainWindow.webContents) {
    throw new Error('拒绝来自未知窗口的 IPC 请求');
  }
  const frameUrl = event.senderFrame && event.senderFrame.url ? event.senderFrame.url : '';
  const cleanFrameUrl = frameUrl.split('#')[0].split('?')[0];
  if (cleanFrameUrl.toLowerCase() !== EXPECTED_RENDERER_URL.toLowerCase()) {
    throw new Error(`拒绝来自非受信任来源的 IPC 请求: ${frameUrl}`);
  }
}

function sendMenuAction(action) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('menu:action', action);
  }
}

function buildApplicationMenu() {
  const template = [
    {
      label: '文件(&F)',
      submenu: [
        {
          label: '打开参数文件 (.gbpro)...',
          accelerator: 'CmdOrCtrl+O',
          click: () => sendMenuAction('file:open')
        },
        {
          label: '保存参数文件 (.gbpro)',
          accelerator: 'CmdOrCtrl+S',
          click: () => sendMenuAction('file:save')
        },
        {
          label: '另存为参数文件...',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => sendMenuAction('file:save-as')
        },
        { type: 'separator' },
        {
          label: '退出',
          accelerator: 'Alt+F4',
          role: 'quit'
        }
      ]
    },
    {
      label: '视图(&V)',
      submenu: [
        { label: '重新加载页面', accelerator: 'CmdOrCtrl+R', role: 'reload' },
        { label: '强制重新加载', accelerator: 'CmdOrCtrl+Shift+R', role: 'forceReload' },
        { type: 'separator' },
        { label: '放大视图', accelerator: 'CmdOrCtrl+Plus', role: 'zoomIn' },
        { label: '缩小视图', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
        { label: '重置缩放 (100%)', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
        { type: 'separator' },
        {
          label: '切换浅色/深色工程界面',
          accelerator: 'CmdOrCtrl+Shift+T',
          click: () => sendMenuAction('view:toggle-theme')
        },
        { label: '切换全屏', accelerator: 'F11', role: 'togglefullscreen' }
      ]
    },
    {
      label: '帮助(&H)',
      submenu: [
        {
          label: '使用流程与帮助文档',
          accelerator: 'F1',
          click: () => sendMenuAction('help:open-docs')
        },
        {
          label: '授权管理与机器码',
          click: () => sendMenuAction('help:open-license')
        },
        {
          label: '检查软件更新...',
          click: () => checkForUpdates(true)
        },
        { type: 'separator' },
        {
          label: '关于 GearBox Pro',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: '关于软件',
              message: APP_DISPLAY_NAME,
              detail: `版本：V${app.getVersion()}\n架构：Electron 受控安全主进程 + 离线 Ed25519 授权验签\n支持：SolidWorks 3D 自动建模 & AutoCAD Mechanical 2D 零件图生成`
            });
          }
        }
      ]
    }
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function createMainWindow() {
  const iconPath = path.join(__dirname, '..', '..', 'build', 'icon.png');
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1120,
    minHeight: 720,
    title: APP_DISPLAY_NAME,
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    backgroundColor: '#eef2f6',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: !app.isPackaged
    }
  });

  // Block unexpected popup windows and external navigation
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    const cleanTarget = targetUrl.split('#')[0].split('?')[0];
    if (cleanTarget.toLowerCase() !== EXPECTED_RENDERER_URL.toLowerCase()) {
      event.preventDefault();
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.loadFile(RENDERER_INDEX_PATH);
}

function registerIpcHandlers() {
  // 1. Save parameter project file (.gbpro)
  ipcMain.handle('project:save', async (event, payload) => {
    assertTrustedSender(event);
    if (!payload || typeof payload.content !== 'string') {
      return { ok: false, error: '无效的参数数据' };
    }
    try {
      let targetPath = payload.filePath;
      if (!targetPath) {
        const res = await dialog.showSaveDialog(mainWindow, {
          title: '保存减速机设计参数文件',
          defaultPath: payload.suggestedName || 'GearBox_Project.gbpro',
          filters: [
            { name: 'GearBox Pro 参数工程文件 (*.gbpro)', extensions: ['gbpro'] },
            { name: 'JSON 参数文件 (*.json)', extensions: ['json'] }
          ]
        });
        if (res.canceled || !res.filePath) {
          return { ok: false, canceled: true };
        }
        targetPath = res.filePath;
      }
      fs.writeFileSync(targetPath, payload.content, 'utf8');
      return {
        ok: true,
        filePath: targetPath,
        fileName: path.basename(targetPath)
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // 2. Open parameter project file (.gbpro)
  ipcMain.handle('project:open', async (event) => {
    assertTrustedSender(event);
    try {
      const res = await dialog.showOpenDialog(mainWindow, {
        title: '打开减速机设计参数文件',
        properties: ['openFile'],
        filters: [
          { name: 'GearBox Pro 参数工程文件 (*.gbpro;*.json)', extensions: ['gbpro', 'json'] }
        ]
      });
      if (res.canceled || !res.filePaths || !res.filePaths[0]) {
        return { ok: false, canceled: true };
      }
      const filePath = res.filePaths[0];
      const content = fs.readFileSync(filePath, 'utf8');
      return {
        ok: true,
        filePath,
        fileName: path.basename(filePath),
        content
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // 3. Choose local save directory (for SolidWorks models)
  ipcMain.handle('dialog:choose-directory', async (event) => {
    assertTrustedSender(event);
    const res = await dialog.showOpenDialog(mainWindow, {
      title: '请选择减速机三维模型的保存根目录',
      properties: ['openDirectory', 'createDirectory']
    });
    if (res.canceled || !res.filePaths || !res.filePaths[0]) {
      return { ok: false, canceled: true };
    }
    return { ok: true, path: res.filePaths[0] };
  });

  // 4. License status & offline activation
  ipcMain.handle('license:status', async (event) => {
    assertTrustedSender(event);
    return licenseManager.getStatus();
  });

  ipcMain.handle('license:import-file', async (event) => {
    assertTrustedSender(event);
    const res = await dialog.showOpenDialog(mainWindow, {
      title: '选择官方签发的授权文件',
      properties: ['openFile'],
      filters: [
        { name: 'GearBox Pro 授权文件 (*.gbplic;*.lic;*.json;*.txt)', extensions: ['gbplic', 'lic', 'json', 'txt'] }
      ]
    });
    if (res.canceled || !res.filePaths || !res.filePaths[0]) {
      return { ok: false, canceled: true };
    }
    const raw = fs.readFileSync(res.filePaths[0], 'utf8');
    return licenseManager.activateFromRaw(raw);
  });

  ipcMain.handle('license:activate-code', async (event, code) => {
    assertTrustedSender(event);
    return licenseManager.activateFromRaw(String(code || ''));
  });

  // 5. Controlled SolidWorks & AutoCAD Mechanical modeling IPC
  ipcMain.handle('cad:run-solidworks', async (event, payload) => {
    assertTrustedSender(event);
    const lic = licenseManager.getStatus();
    if (!lic.valid) {
      return { ok: false, error: '当前软件尚未通过授权验证或授权已到期，无法执行自动建模。' };
    }
    return runSolidWorksModeling(payload);
  });

  ipcMain.handle('cad:run-autocad', async (event, payload) => {
    assertTrustedSender(event);
    const lic = licenseManager.getStatus();
    if (!lic.valid) {
      return { ok: false, error: '当前软件尚未通过授权验证或授权已到期，无法执行自动绘图。' };
    }
    return runAutoCADModeling(payload);
  });
}

app.whenReady().then(() => {
  licenseManager = new LicenseManager({
    publicKeyPath: path.join(__dirname, 'license', 'public.pem'),
    storagePath: path.join(app.getPath('userData'), 'license.gbplic')
  });
  buildApplicationMenu();
  registerIpcHandlers();
  createMainWindow();
  initAutoUpdater(mainWindow, licenseManager);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
