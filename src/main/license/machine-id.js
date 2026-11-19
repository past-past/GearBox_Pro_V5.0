/**
 * Windows / Cross-platform deterministic hardware machine code generator.
 * Produces a stable, privacy-preserving SHA-256 fingerprint formatted as:
 *   GBP-XXXX-XXXX-XXXX-XXXX
 */
const crypto = require('crypto');
const os = require('os');
const { execFileSync } = require('child_process');

let cachedMachineCode = null;

function readWindowsHardwareUuid() {
  if (process.platform !== 'win32') return '';
  // Prefer PowerShell CIM (works on Windows 10/11 even after wmic deprecation)
  try {
    const out = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '(Get-CimInstance Win32_ComputerSystemProduct).UUID; (Get-CimInstance Win32_BaseBoard).SerialNumber'
      ],
      { encoding: 'utf8', timeout: 4000, windowsHide: true }
    );
    const cleaned = out
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s && !/^to be filled|^default string|^none$|^00000000/i.test(s))
      .join('|');
    if (cleaned) return cleaned;
  } catch (_) {}

  // Fallback to wmic for older Windows 10 builds
  try {
    const out = execFileSync('wmic', ['csproduct', 'get', 'uuid'], {
      encoding: 'utf8',
      timeout: 3000,
      windowsHide: true
    });
    const lines = out
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s && s.toLowerCase() !== 'uuid');
    if (lines[0]) return lines[0];
  } catch (_) {}

  return '';
}

function getStableMacAddresses() {
  const ifaces = os.networkInterfaces() || {};
  const macs = [];
  for (const list of Object.values(ifaces)) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!item || item.internal) continue;
      if (item.mac && item.mac !== '00:00:00:00:00:00') {
        macs.push(item.mac.toLowerCase());
      }
    }
  }
  return Array.from(new Set(macs)).sort().slice(0, 3).join(',');
}

function getMachineCode() {
  if (cachedMachineCode) return cachedMachineCode;

  const hwUuid = readWindowsHardwareUuid();
  const cpuModel = (os.cpus() && os.cpus()[0] && os.cpus()[0].model) || '';
  const macs = getStableMacAddresses();
  const rawSeed = [
    'GEARBOX-PRO-V5-HWID',
    process.platform,
    os.arch(),
    hwUuid || `${os.hostname()}|${macs}|${cpuModel}`
  ].join('::');

  const digest = crypto.createHash('sha256').update(rawSeed, 'utf8').digest('hex').toUpperCase();
  const shortHex = digest.slice(0, 16);
  cachedMachineCode = `GBP-${shortHex.slice(0, 4)}-${shortHex.slice(4, 8)}-${shortHex.slice(8, 12)}-${shortHex.slice(12, 16)}`;
  return cachedMachineCode;
}

module.exports = { getMachineCode };
