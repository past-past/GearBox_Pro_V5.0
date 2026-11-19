/**
 * GearBox Pro V5.0 Desktop Renderer Bridge
 * Handles:
 *  - Parameter Project Save / Open (.gbpro) via native Electron dialogs
 *  - Help Documentation Modal
 *  - First-Run / Expired Offline Ed25519 License Activation Gate (silent when valid)
 *  - Application Menu Event Dispatch (File / View / Help)
 */
(function initGearBoxDesktopBridge() {
  'use strict';

  const desktop = window.gearboxDesktop || null;
  let currentProjectPath = null;
  let licenseValid = true;

  function notify(msg) {
    if (window.__gearboxHooks && typeof window.__gearboxHooks.showToast === 'function') {
      window.__gearboxHooks.showToast(msg);
    } else {
      console.log('[GearBox Desktop]', msg);
    }
  }

  function serializeProjectState() {
    const raw = window.state || {};
    const cloned = {};
    const omitKeys = new Set(['design', 'lastPopupInterferenceSig']);
    for (const [k, v] of Object.entries(raw)) {
      if (omitKeys.has(k)) continue;
      cloned[k] = JSON.parse(JSON.stringify(v));
    }
    const codeName = (raw.design && raw.design.codeName) ? String(raw.design.codeName) : 'GearBox_V5';
    return {
      format: 'GearBoxProProject',
      schemaVersion: '5.0',
      appName: 'GearBox Pro减速机参数化设计及建模系统',
      savedAt: new Date().toISOString(),
      codeName,
      theme: document.body.classList.contains('theme-industrial-light') ? 'light' : 'dark',
      parameters: cloned
    };
  }

  function applyImportedProject(projectData) {
    if (!projectData || typeof projectData !== 'object' || !projectData.parameters || typeof projectData.parameters !== 'object') {
      throw new Error('无效的 GearBox Pro 参数文件格式（缺少 parameters 字段）');
    }
    const target = window.state;
    if (!target) {
      throw new Error('设计状态尚未初始化');
    }
    const params = projectData.parameters;
    for (const [k, v] of Object.entries(params)) {
      if (k === 'design') continue;
      if (Object.prototype.hasOwnProperty.call(target, k)) {
        target[k] = v;
      }
    }
    if (projectData.theme === 'dark') {
      document.body.classList.remove('theme-industrial-light');
    } else if (projectData.theme === 'light') {
      document.body.classList.add('theme-industrial-light');
    }
    if (window.__gearboxHooks && typeof window.__gearboxHooks.syncAfterStateImport === 'function') {
      window.__gearboxHooks.syncAfterStateImport();
    }
  }

  async function handleSaveProject(forceSaveAs = false) {
    const payload = serializeProjectState();
    const safeName = (payload.codeName || 'GearBox_Project').replace(/[^a-zA-Z0-9_\-\u4e00-\u9fa5.]/g, '_');
    const suggestedName = `${safeName}.gbpro`;

    if (desktop && typeof desktop.saveProjectFile === 'function') {
      const res = await desktop.saveProjectFile({
        filePath: forceSaveAs ? null : currentProjectPath,
        suggestedName,
        content: JSON.stringify(payload, null, 2)
      });
      if (res && res.canceled) return;
      if (res && res.ok) {
        currentProjectPath = res.filePath || currentProjectPath;
        notify(`已保存参数工程文件：${res.fileName || suggestedName}`);
      } else {
        notify(`保存失败：${(res && res.error) || '未知错误'}`);
      }
      return;
    }

    // Browser fallback
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = suggestedName;
    a.click();
    URL.revokeObjectURL(a.href);
    notify(`已导出参数工程文件：${suggestedName}`);
  }

  async function handleOpenProject() {
    if (desktop && typeof desktop.openProjectFile === 'function') {
      const res = await desktop.openProjectFile();
      if (!res || res.canceled) return;
      if (!res.ok) {
        notify(`打开失败：${res.error || '无法读取文件'}`);
        return;
      }
      try {
        const parsed = JSON.parse(res.content);
        applyImportedProject(parsed);
        currentProjectPath = res.filePath || null;
        notify(`已成功载入参数文件：${res.fileName || ''}`);
      } catch (err) {
        notify(`参数文件解析失败：${err.message}`);
      }
      return;
    }

    // Browser fallback
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.gbpro,.json';
    inp.onchange = async () => {
      const file = inp.files && inp.files[0];
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text());
        applyImportedProject(parsed);
        notify(`已成功载入参数文件：${file.name}`);
      } catch (err) {
        notify(`参数文件解析失败：${err.message}`);
      }
    };
    inp.click();
  }

  // ==================== 帮助文档弹窗 ====================
  function openHelpModal() {
    const el = document.getElementById('gbHelpModal');
    if (el) el.classList.remove('hidden');
  }
  function closeHelpModal() {
    const el = document.getElementById('gbHelpModal');
    if (el) el.classList.add('hidden');
  }

  // ==================== 首次启动 / 到期授权弹窗（有效时不显示） ====================
  function setLicenseError(msg) {
    const box = document.getElementById('gbLicenseErrorBox');
    if (!box) return;
    if (!msg) {
      box.classList.add('hidden');
      box.textContent = '';
    } else {
      box.textContent = msg;
      box.classList.remove('hidden');
    }
  }

  function showLicenseModal(status, allowClose) {
    const modal = document.getElementById('gbLicenseModal');
    const machineInput = document.getElementById('gbMachineCodeInput');
    const subtitle = document.getElementById('gbLicenseModalSubtitle');
    const closeBtn = document.getElementById('btnCloseLicenseModalIfValid');
    if (!modal) return;

    if (machineInput && status && status.machineCode) {
      machineInput.value = status.machineCode;
    }
    if (closeBtn) {
      closeBtn.classList.toggle('hidden', !allowClose);
    }
    if (subtitle && status) {
      if (status.valid) {
        subtitle.textContent = `当前设备已完成离线验签授权（授权客户：${status.customerName || '-'}，有效期至：${status.expiresAt || '-'}）。如需更新或续期授权，可在下方导入新授权。`;
      } else if (status.reason === 'EXPIRED') {
        subtitle.textContent = '您的软件授权已到期，请将下方机器码发送给管理员签发新授权后导入激活。';
      } else {
        subtitle.textContent = '首次使用需导入管理员签发的授权文件或授权码。授权成功后将不再弹窗显示授权信息，直至授权到期。';
      }
    }
    setLicenseError(status && !status.valid && status.message ? status.message : '');
    modal.classList.remove('hidden');
  }

  function hideLicenseModal() {
    const modal = document.getElementById('gbLicenseModal');
    if (modal) modal.classList.add('hidden');
    setLicenseError('');
  }

  async function checkLicenseOnStartup() {
    if (!desktop || typeof desktop.getLicenseStatus !== 'function') return;
    try {
      const status = await desktop.getLicenseStatus();
      licenseValid = Boolean(status && status.valid);
      if (!licenseValid) {
        // 仅在首次未授权、授权失效或到期时弹窗
        showLicenseModal(status, false);
      } else {
        // 授权有效时严格不弹窗、不在主界面显示任何授权信息
        hideLicenseModal();
      }
    } catch (err) {
      console.error('License check error:', err);
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    const btnSave = document.getElementById('btnSaveProjectTop');
    const btnOpen = document.getElementById('btnOpenProjectTop');
    const btnHelp = document.getElementById('btnOpenHelpTop');
    const btnCloseHelp = document.getElementById('btnCloseHelpModal');
    const helpBackdrop = document.getElementById('gbHelpModal');

    if (btnSave) btnSave.addEventListener('click', () => handleSaveProject(false));
    if (btnOpen) btnOpen.addEventListener('click', () => handleOpenProject());
    if (btnHelp) btnHelp.addEventListener('click', openHelpModal);
    if (btnCloseHelp) btnCloseHelp.addEventListener('click', closeHelpModal);
    if (helpBackdrop) {
      helpBackdrop.addEventListener('click', (e) => {
        if (e.target === helpBackdrop) closeHelpModal();
      });
    }

    // 授权弹窗交互
    const btnCopyMachine = document.getElementById('btnCopyMachineCode');
    const btnImportFile = document.getElementById('btnImportLicenseFile');
    const btnActivateCode = document.getElementById('btnActivateLicenseCode');
    const btnCloseLicense = document.getElementById('btnCloseLicenseModalIfValid');

    if (btnCopyMachine) {
      btnCopyMachine.addEventListener('click', async () => {
        const inp = document.getElementById('gbMachineCodeInput');
        if (!inp || !inp.value) return;
        try {
          await navigator.clipboard.writeText(inp.value);
          notify('已复制本机机器码到剪贴板');
        } catch {
          inp.select();
          document.execCommand('copy');
          notify('已复制本机机器码');
        }
      });
    }

    if (btnImportFile && desktop && typeof desktop.importLicenseFile === 'function') {
      btnImportFile.addEventListener('click', async () => {
        setLicenseError('');
        const res = await desktop.importLicenseFile();
        if (!res || res.canceled) return;
        if (res.ok && res.status && res.status.valid) {
          licenseValid = true;
          hideLicenseModal();
          notify('授权验证通过，激活成功！');
        } else {
          setLicenseError((res && res.error) || '授权文件验签失败，请确认文件未被篡改且与本机机器码一致。');
        }
      });
    }

    if (btnActivateCode && desktop && typeof desktop.activateLicenseCode === 'function') {
      btnActivateCode.addEventListener('click', async () => {
        setLicenseError('');
        const ta = document.getElementById('gbLicenseCodeTextarea');
        const code = ta ? ta.value.trim() : '';
        if (!code) {
          setLicenseError('请先粘贴管理员签发的授权码，或点击上方按钮导入授权文件。');
          return;
        }
        const res = await desktop.activateLicenseCode(code);
        if (res && res.ok && res.status && res.status.valid) {
          licenseValid = true;
          if (ta) ta.value = '';
          hideLicenseModal();
          notify('授权码验签通过，激活成功！');
        } else {
          setLicenseError((res && res.error) || '授权码验签失败，请检查是否完整粘贴或已过期。');
        }
      });
    }

    if (btnCloseLicense) {
      btnCloseLicense.addEventListener('click', () => {
        if (licenseValid) hideLicenseModal();
      });
    }

    // 监听主进程原生菜单事件
    if (desktop && typeof desktop.onMenuAction === 'function') {
      desktop.onMenuAction(async (action) => {
        switch (action) {
          case 'file:open':
            await handleOpenProject();
            break;
          case 'file:save':
            await handleSaveProject(false);
            break;
          case 'file:save-as':
            await handleSaveProject(true);
            break;
          case 'view:toggle-theme':
            if (window.__gearboxHooks && typeof window.__gearboxHooks.toggleTheme === 'function') {
              window.__gearboxHooks.toggleTheme();
            }
            break;
          case 'help:open-docs':
            openHelpModal();
            break;
          case 'help:open-license':
            if (desktop && typeof desktop.getLicenseStatus === 'function') {
              const st = await desktop.getLicenseStatus();
              licenseValid = Boolean(st && st.valid);
              showLicenseModal(st, licenseValid);
            }
            break;
          default:
            break;
        }
      });
    }

    // 快捷键支持 Ctrl+S / Ctrl+Shift+S / Ctrl+O
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleSaveProject(e.shiftKey);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        handleOpenProject();
      }
    });

    // 启动时静默检查授权
    checkLicenseOnStartup();
  });
})();
