/**
 * GearBox Pro V5.0 Offline Ed25519 License Verifier
 *
 * Security model:
 *  - Only embeds the Ed25519 PUBLIC key (public.pem).
 *  - Public key can ONLY verify signatures; it can NEVER issue or forge new licenses.
 *  - Strictly offline at runtime: validates cryptographic signature, product ID,
 *    machine code binding (supports both single-machine "GBP-..." and signed universal "ANY"),
 *    and expiration timestamp.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getMachineCode } = require('./machine-id');

const PRODUCT_ID = 'GearBox-Pro-Desktop';
const CODE_PREFIX = 'GBPRO1.';
const UNIVERSAL_MACHINE_CODE = 'ANY';

function canonicalizePayload(payload) {
  const ordered = {
    customerName: String(payload.customerName || '').trim(),
    edition: String(payload.edition || 'Professional').trim(),
    expiresAt: String(payload.expiresAt || '').trim(),
    issuedAt: String(payload.issuedAt || '').trim(),
    licenseId: String(payload.licenseId || '').trim(),
    machineCode: String(payload.machineCode || '').trim().toUpperCase(),
    product: String(payload.product || '').trim()
  };
  return JSON.stringify(ordered);
}

function parseLicenseInput(rawText) {
  const trimmed = String(rawText || '').trim();
  if (!trimmed) {
    throw new Error('授权内容为空');
  }

  // Format A: Compact activation code "GBPRO1.<base64url(payload)>.<base64url(signature)>"
  if (trimmed.startsWith(CODE_PREFIX)) {
    const parts = trimmed.split('.');
    if (parts.length !== 3) {
      throw new Error('授权码格式不正确（应为 GBPRO1.<payload>.<signature>）');
    }
    const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf8');
    const payload = JSON.parse(payloadJson);
    const signature = parts[2];
    return { payload, signature, rawCode: trimmed };
  }

  // Format B: JSON license file (.gbplic / .json)
  const parsed = JSON.parse(trimmed);
  if (parsed && typeof parsed.licenseCode === 'string' && parsed.licenseCode.startsWith(CODE_PREFIX)) {
    return parseLicenseInput(parsed.licenseCode);
  }
  if (!parsed || typeof parsed.payload !== 'object' || typeof parsed.signature !== 'string') {
    throw new Error('授权文件缺少 payload 或 signature 字段');
  }
  return { payload: parsed.payload, signature: parsed.signature };
}

class LicenseManager {
  constructor(options = {}) {
    this.publicKeyPath = options.publicKeyPath || path.join(__dirname, 'public.pem');
    this.storagePath = options.storagePath || null;
    this.machineCodeOverride = options.machineCode || null;
  }

  getPublicKeyPem() {
    if (!fs.existsSync(this.publicKeyPath)) {
      throw new Error('缺少内置验签公钥 (public.pem)');
    }
    return fs.readFileSync(this.publicKeyPath, 'utf8');
  }

  getCurrentMachineCode() {
    return this.machineCodeOverride || getMachineCode();
  }

  verifyRawLicense(rawText, nowDate = new Date()) {
    const currentMachineCode = this.getCurrentMachineCode();
    let parsed;
    try {
      parsed = parseLicenseInput(rawText);
    } catch (err) {
      return {
        valid: false,
        reason: 'INVALID_FORMAT',
        message: `授权格式错误：${err.message}`,
        machineCode: currentMachineCode
      };
    }

    const { payload, signature } = parsed;
    if (!payload || payload.product !== PRODUCT_ID) {
      return {
        valid: false,
        reason: 'INVALID_PRODUCT',
        message: '授权文件不属于 GearBox Pro 桌面端产品。',
        machineCode: currentMachineCode
      };
    }

    // 1. Cryptographic Ed25519 signature verification (detects ANY tampering, including changing machineCode to ANY!)
    let sigOk = false;
    try {
      const publicKey = crypto.createPublicKey(this.getPublicKeyPem());
      const canonicalBytes = Buffer.from(canonicalizePayload(payload), 'utf8');
      const sigBytes = Buffer.from(signature, 'base64url');
      sigOk = crypto.verify(null, canonicalBytes, publicKey, sigBytes);
    } catch (err) {
      return {
        valid: false,
        reason: 'VERIFY_ERROR',
        message: `公钥验签异常：${err.message}`,
        machineCode: currentMachineCode
      };
    }

    if (!sigOk) {
      return {
        valid: false,
        reason: 'INVALID_SIGNATURE',
        message: '授权数字签名校验失败：授权内容可能已被篡改或并非由官方私钥签发。',
        machineCode: currentMachineCode
      };
    }

    // 2. Machine code binding check (ANY = official server-signed universal license)
    const targetMachine = String(payload.machineCode || '').trim().toUpperCase();
    const isUniversal = targetMachine === UNIVERSAL_MACHINE_CODE;
    if (!isUniversal && targetMachine !== currentMachineCode) {
      return {
        valid: false,
        reason: 'MACHINE_MISMATCH',
        message: `授权绑定的机器码 (${targetMachine}) 与本机机器码 (${currentMachineCode}) 不匹配。`,
        machineCode: currentMachineCode
      };
    }

    // 3. Expiration date check (inclusive of the expiry calendar date end 23:59:59 UTC)
    const expStr = String(payload.expiresAt || '').trim();
    const expMs = /^\d{4}-\d{2}-\d{2}$/.test(expStr)
      ? Date.parse(`${expStr}T23:59:59.999Z`)
      : Date.parse(expStr);
    if (!Number.isFinite(expMs)) {
      return {
        valid: false,
        reason: 'INVALID_EXPIRY',
        message: '授权到期日期格式无效。',
        machineCode: currentMachineCode
      };
    }
    if (nowDate.getTime() > expMs) {
      return {
        valid: false,
        reason: 'EXPIRED',
        message: `授权已于 ${expStr} 到期，请联系管理员续期。`,
        customerName: payload.customerName,
        expiresAt: expStr,
        machineCode: currentMachineCode
      };
    }

    return {
      valid: true,
      reason: 'OK',
      licenseId: payload.licenseId,
      customerName: payload.customerName,
      edition: payload.edition || 'Professional',
      issuedAt: payload.issuedAt,
      expiresAt: expStr,
      isUniversal,
      machineCode: currentMachineCode
    };
  }

  getStatus() {
    const currentMachineCode = this.getCurrentMachineCode();
    if (!this.storagePath || !fs.existsSync(this.storagePath)) {
      return {
        valid: false,
        reason: 'NOT_ACTIVATED',
        message: '',
        machineCode: currentMachineCode
      };
    }
    try {
      const raw = fs.readFileSync(this.storagePath, 'utf8');
      return this.verifyRawLicense(raw);
    } catch (err) {
      return {
        valid: false,
        reason: 'READ_ERROR',
        message: `读取本地授权文件失败：${err.message}`,
        machineCode: currentMachineCode
      };
    }
  }

  activateFromRaw(rawText) {
    const status = this.verifyRawLicense(rawText);
    if (!status.valid) {
      return { ok: false, error: status.message, status };
    }
    if (this.storagePath) {
      fs.mkdirSync(path.dirname(this.storagePath), { recursive: true });
      fs.writeFileSync(this.storagePath, String(rawText).trim(), 'utf8');
    }
    return { ok: true, status };
  }
}

module.exports = {
  LicenseManager,
  PRODUCT_ID,
  CODE_PREFIX,
  UNIVERSAL_MACHINE_CODE,
  canonicalizePayload
};
