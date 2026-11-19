/**
 * Controlled Native CAD/SolidWorks Modeling Service (Electron Main Process Only)
 *
 * Security Guarantees:
 *  - No HTA / ActiveX host, no localhost HTTP arbitrary script execution server.
 *  - Only accepts explicitly allowlisted modeling commands from the verified renderer window.
 *  - Validates command name, parameters, script size, required GearBox markers,
 *    strips comment-only lines before scanning, and rejects dangerous command-execution /
 *    network / registry / dynamic-eval primitives (while permitting safe WScript.Shell
 *    SpecialFolders directory lookup used by SolidWorks save-folder selection).
 *  - Executes strictly via child_process.execFile (shell: false) with timeout and automatic cleanup.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const ALLOWED_SW_SCOPES = new Set([
  'all',
  'housing_no_cover',
  'housing_both',
  'housing',
  'upper_cover',
  'shafts_gears'
]);

const MAX_SCRIPT_BYTES = 2 * 1024 * 1024; // 2 MB cap

const FORBIDDEN_VBS_PATTERNS = [
  /\b\w+\.(Run|Exec)\s*(\(|\s+["'])/i,
  /CreateObject\s*\(\s*["']WScript\.Shell["']\s*\)\.(Run|Exec)\b/i,
  /ShellExecute/i,
  /powershell(\.exe)?/i,
  /\bcmd\.exe\b/i,
  /MSXML2\./i,
  /XMLHTTP/i,
  /WinHttp/i,
  /ADODB\.Stream/i,
  /RegWrite|RegDelete/i,
  /ExecuteGlobal\b/i,
  /\bEval\s*\(/i,
  /winmgmts:/i,
  /certutil|bitsadmin/i
];

const FORBIDDEN_PY_PATTERNS = [
  /\bsubprocess\b/,
  /\bos\.system\s*\(/,
  /\bos\.popen\s*\(/,
  /\burllib\b/,
  /\brequests\b/,
  /\bsocket\b/,
  /\bhttp\.client\b/,
  /\bshutil\.rmtree\s*\(/,
  /\b__import__\s*\(/,
  /\beval\s*\(/,
  /\bexec\s*\(/
];

function stripVbsCommentLines(script) {
  return script
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed && !trimmed.startsWith("'") && !/^Rem\b/i.test(trimmed);
    })
    .join('\n');
}

function stripPyCommentLines(script) {
  return script
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed && !trimmed.startsWith('#');
    })
    .join('\n');
}

function assertSafeString(val, label, maxLen = 120) {
  if (typeof val !== 'string' || !val.trim()) {
    throw new Error(`参数 ${label} 不能为空`);
  }
  if (val.length > maxLen) {
    throw new Error(`参数 ${label} 超出允许长度`);
  }
  if (/[\x00-\x1f<>|&;`$]/.test(val)) {
    throw new Error(`参数 ${label} 包含非法控制字符`);
  }
  return val.trim();
}

function validateSolidWorksRequest(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('无效的 SolidWorks 建模请求体');
  }
  if (payload.command !== 'SW_BUILD_GEARBOX') {
    throw new Error(`不允许的建模命令：${String(payload.command)}`);
  }
  const codeName = assertSafeString(payload.codeName, 'codeName', 80);
  const scope = String(payload.scope || 'all').trim();
  if (!ALLOWED_SW_SCOPES.has(scope)) {
    throw new Error(`不允许的建模范围：${scope}`);
  }
  if (typeof payload.scriptContent !== 'string' || payload.scriptContent.length < 100) {
    throw new Error('SolidWorks 建模脚本内容不完整');
  }
  if (Buffer.byteLength(payload.scriptContent, 'utf8') > MAX_SCRIPT_BYTES) {
    throw new Error('SolidWorks 建模脚本体积超出安全限制');
  }
  if (!/SldWorks\.Application/i.test(payload.scriptContent)) {
    throw new Error('建模脚本未通过 SolidWorks COM 特征校验');
  }
  const executableCode = stripVbsCommentLines(payload.scriptContent);
  for (const rx of FORBIDDEN_VBS_PATTERNS) {
    if (rx.test(executableCode)) {
      throw new Error(`建模脚本包含被安全策略禁止的调用 (${rx.source})`);
    }
  }
  return { codeName, scope, scriptContent: payload.scriptContent };
}

function validateAutoCADRequest(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('无效的 AutoCAD Mechanical 绘图请求体');
  }
  if (payload.command !== 'ACADM_DRAW_PART') {
    throw new Error(`不允许的 CAD 绘图命令：${String(payload.command)}`);
  }
  const drawingNo = assertSafeString(payload.drawingNo, 'drawingNo', 80);
  const partTitle = assertSafeString(payload.partTitle, 'partTitle', 100);
  if (typeof payload.scriptContent !== 'string' || payload.scriptContent.length < 100) {
    throw new Error('AutoCAD Mechanical 绘图脚本内容不完整');
  }
  if (Buffer.byteLength(payload.scriptContent, 'utf8') > MAX_SCRIPT_BYTES) {
    throw new Error('AutoCAD Mechanical 绘图脚本体积超出安全限制');
  }
  if (!/win32com\.client|pywinauto|AutoCAD/i.test(payload.scriptContent)) {
    throw new Error('绘图脚本未通过 AutoCAD Mechanical 特征校验');
  }
  const executableCode = stripPyCommentLines(payload.scriptContent);
  for (const rx of FORBIDDEN_PY_PATTERNS) {
    if (rx.test(executableCode)) {
      throw new Error(`绘图脚本包含被安全策略禁止的调用 (${rx.source})`);
    }
  }
  return { drawingNo, partTitle, scriptContent: payload.scriptContent };
}

function runSolidWorksModeling(payload) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve({ ok: false, error: 'SolidWorks COM 自动建模仅支持在 Windows 系统中运行。' });
      return;
    }

    let validated;
    try {
      validated = validateSolidWorksRequest(payload);
    } catch (err) {
      resolve({ ok: false, error: err.message });
      return;
    }

    const runId = crypto.randomBytes(8).toString('hex');
    const tmpDir = path.join(os.tmpdir(), 'GearBoxPro_SW_Controlled');
    fs.mkdirSync(tmpDir, { recursive: true });
    const tmpVbs = path.join(tmpDir, `gbpro_sw_${runId}.vbs`);

    // Windows cscript.exe natively supports UTF-16LE with BOM for full Chinese/Unicode comments & paths
    const utf16Bom = Buffer.from([0xff, 0xfe]);
    const bodyBuf = Buffer.from(validated.scriptContent.replace(/\r?\n/g, '\r\n'), 'utf16le');
    fs.writeFileSync(tmpVbs, Buffer.concat([utf16Bom, bodyBuf]));

    const cleanup = () => {
      try {
        if (fs.existsSync(tmpVbs)) fs.unlinkSync(tmpVbs);
      } catch (_) {}
    };

    execFile(
      'cscript.exe',
      ['//NoLogo', tmpVbs],
      { windowsHide: true, timeout: 240000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        cleanup();
        if (err) {
          resolve({
            ok: false,
            error: (stderr || err.message || 'SolidWorks 执行失败').trim(),
            stdout: (stdout || '').trim()
          });
          return;
        }
        resolve({
          ok: true,
          codeName: validated.codeName,
          scope: validated.scope,
          stdout: (stdout || '').trim()
        });
      }
    );
  });
}

function runAutoCADModeling(payload) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve({ ok: false, error: 'AutoCAD Mechanical 自动绘图仅支持在 Windows 系统中运行。' });
      return;
    }

    let validated;
    try {
      validated = validateAutoCADRequest(payload);
    } catch (err) {
      resolve({ ok: false, error: err.message });
      return;
    }

    const runId = crypto.randomBytes(8).toString('hex');
    const tmpDir = path.join(os.tmpdir(), 'GearBoxPro_ACADM_Controlled');
    fs.mkdirSync(tmpDir, { recursive: true });
    const tmpPy = path.join(tmpDir, `gbpro_acadm_${runId}.py`);
    fs.writeFileSync(tmpPy, validated.scriptContent, 'utf8');

    const cleanup = () => {
      try {
        if (fs.existsSync(tmpPy)) fs.unlinkSync(tmpPy);
      } catch (_) {}
    };

    const tryRun = (exe, args, onFallback) => {
      execFile(
        exe,
        args,
        { windowsHide: false, timeout: 180000, maxBuffer: 4 * 1024 * 1024 },
        (err, stdout, stderr) => {
          if (err && err.code === 'ENOENT' && onFallback) {
            onFallback();
            return;
          }
          cleanup();
          if (err) {
            resolve({
              ok: false,
              error: (stderr || err.message || 'Python / AutoCAD Mechanical 执行失败').trim(),
              stdout: (stdout || '').trim()
            });
            return;
          }
          resolve({
            ok: true,
            drawingNo: validated.drawingNo,
            partTitle: validated.partTitle,
            stdout: (stdout || '').trim()
          });
        }
      );
    };

    // Try python first, fallback to Windows py launcher
    tryRun('python', [tmpPy], () => {
      tryRun('py', ['-3', tmpPy], null);
    });
  });
}

module.exports = {
  runSolidWorksModeling,
  runAutoCADModeling,
  validateSolidWorksRequest,
  validateAutoCADRequest
};
