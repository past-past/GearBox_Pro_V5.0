/**
 * GearBox Pro V5.0 Preload Script
 * Strictly exposes a minimal, allowlisted IPC surface via contextBridge.
 * nodeIntegration is FALSE and contextIsolation is TRUE.
 */
const { contextBridge, ipcRenderer } = require('electron');

const ALLOWED_MENU_ACTIONS = new Set([
  'file:open',
  'file:save',
  'file:save-as',
  'view:toggle-theme',
  'help:open-docs',
  'help:open-license'
]);

contextBridge.exposeInMainWorld('gearboxDesktop', Object.freeze({
  // 参数工程文件保存与打开
  saveProjectFile: (payload) => ipcRenderer.invoke('project:save', payload),
  openProjectFile: () => ipcRenderer.invoke('project:open'),

  // 选择本地保存根目录
  chooseSaveDirectory: () => ipcRenderer.invoke('dialog:choose-directory'),

  // 受控的 SolidWorks & AutoCAD Mechanical 建模命令
  runSolidWorksModeling: (payload) => ipcRenderer.invoke('cad:run-solidworks', payload),
  runAutoCADModeling: (payload) => ipcRenderer.invoke('cad:run-autocad', payload),

  // 离线公钥验签授权管理
  getLicenseStatus: () => ipcRenderer.invoke('license:status'),
  importLicenseFile: () => ipcRenderer.invoke('license:import-file'),
  activateLicenseCode: (code) => ipcRenderer.invoke('license:activate-code', code),

  // 原生菜单动作监听
  onMenuAction: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, action) => {
      if (ALLOWED_MENU_ACTIONS.has(action)) {
        callback(action);
      }
    };
    ipcRenderer.on('menu:action', listener);
    return () => ipcRenderer.removeListener('menu:action', listener);
  }
}));
