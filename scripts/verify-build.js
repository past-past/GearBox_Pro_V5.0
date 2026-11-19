#!/usr/bin/env node
/**
 * 打包前自动化安全与功能校验脚本：
 *  1. 校验离线 Ed25519 单机授权 & 通用授权（ANY）签发 -> 验签 -> 防篡改 -> 防跨机 -> 防过期 全流程
 *  2. 校验 SolidWorks / AutoCAD 安全参数与危险脚本拦截逻辑
 *  3. 校验客户端内置 public.pem 存在且绝不包含私钥
 */
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { LicenseManager } = require('../src/main/license/license-manager');
const { signLicense } = require('../license-server/issue-cli');
const { validateSolidWorksRequest, validateAutoCADRequest } = require('../src/main/cad-service');

const rootDir = path.resolve(__dirname, '..');

// 1. Verify client only embeds PUBLIC key
const clientPubPath = path.join(rootDir, 'src', 'main', 'license', 'public.pem');
assert(fs.existsSync(clientPubPath), '缺少客户端公钥 src/main/license/public.pem');
const clientPubText = fs.readFileSync(clientPubPath, 'utf8');
assert(clientPubText.includes('BEGIN PUBLIC KEY'), 'src/main/license/public.pem 格式不是有效的 PUBLIC KEY');
assert(!clientPubText.includes('PRIVATE KEY'), '安全错误：客户端公钥文件中绝不允许包含 PRIVATE KEY');

// 2. Cryptographic Ed25519 end-to-end test using ephemeral keypair
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gbpro-verify-'));
try {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
  const tmpPub = path.join(tmpDir, 'public.pem');
  const tmpStore = path.join(tmpDir, 'license.gbplic');
  fs.writeFileSync(tmpPub, publicKey, 'utf8');

  const testMachine = 'GBP-1A2B-3C4D-5E6F-7A8B';
  const mgr = new LicenseManager({
    publicKeyPath: tmpPub,
    storagePath: tmpStore,
    machineCode: testMachine
  });

  // 2a. Valid single-machine issuance & offline verification
  const issued = signLicense({
    machineCode: testMachine,
    customerName: '测试传动机械有限公司',
    expiresAt: '2099-12-31',
    privateKeyPem: privateKey
  });
  const actRes = mgr.activateFromRaw(issued.licenseCode);
  assert.strictEqual(actRes.ok, true, '有效单机授权码应通过激活');
  assert.strictEqual(mgr.getStatus().valid, true, '已持久化授权应离线验签通过');

  // 2b. Tampered expiresAt OR tampering machineCode -> ANY MUST fail
  const tamperedObj = JSON.parse(JSON.stringify(issued.licenseFileObject));
  delete tamperedObj.licenseCode;
  tamperedObj.payload.machineCode = 'ANY';
  const tamperCheck = mgr.verifyRawLicense(JSON.stringify(tamperedObj));
  assert.strictEqual(tamperCheck.valid, false, '私自将单机机器码篡改为 ANY 必须验签失败');
  assert.strictEqual(tamperCheck.reason, 'INVALID_SIGNATURE');

  // 2c. Wrong machine code MUST fail for single-machine license
  const otherMgr = new LicenseManager({
    publicKeyPath: tmpPub,
    machineCode: 'GBP-FFFF-EEEE-DDDD-CCCC'
  });
  const mismatchCheck = otherMgr.verifyRawLicense(issued.licenseCode);
  assert.strictEqual(mismatchCheck.valid, false, '单机授权在不同机器码上必须拒绝');
  assert.strictEqual(mismatchCheck.reason, 'MACHINE_MISMATCH');

  // 2d. Official server-signed universal license (ANY) MUST pass on ANY machine
  const universalIssued = signLicense({
    universal: true,
    customerName: '企业通用授权测试',
    expiresAt: '2099-12-31',
    privateKeyPem: privateKey
  });
  const univCheckA = mgr.verifyRawLicense(universalIssued.licenseCode);
  const univCheckB = otherMgr.verifyRawLicense(universalIssued.licenseCode);
  assert.strictEqual(univCheckA.valid, true, '官方签发的通用授权码应在机器 A 上通过');
  assert.strictEqual(univCheckB.valid, true, '官方签发的通用授权码应在机器 B 上通过');
  assert.strictEqual(univCheckB.isUniversal, true);

  // 2e. Expired universal license MUST still fail
  const expiredUniv = signLicense({
    universal: true,
    customerName: '过期通用授权测试',
    expiresAt: '2020-01-01',
    privateKeyPem: privateKey
  });
  const expiredCheck = otherMgr.verifyRawLicense(expiredUniv.licenseCode);
  assert.strictEqual(expiredCheck.valid, false, '过期的通用授权必须拒绝');
  assert.strictEqual(expiredCheck.reason, 'EXPIRED');

  // 3. CAD security validator tests
  const safeVbs = "' 不含 PowerShell\nSet swApp = CreateObject(\"SldWorks.Application\")\nSet wsh = CreateObject(\"WScript.Shell\")\nbaseDir = wsh.SpecialFolders(\"Desktop\")\n" + ' '.repeat(60);
  validateSolidWorksRequest({
    command: 'SW_BUILD_GEARBOX',
    codeName: 'ZLY224',
    scope: 'all',
    scriptContent: safeVbs
  });

  assert.throws(() => {
    validateSolidWorksRequest({
      command: 'SW_BUILD_GEARBOX',
      codeName: 'ZLY224',
      scope: 'all',
      scriptContent: safeVbs + '\nwsh.Run "calc.exe"\n'
    });
  }, /禁止/, '必须拦截含 wsh.Run 的恶意 VBS 脚本');

  assert.throws(() => {
    validateAutoCADRequest({
      command: 'ACADM_DRAW_PART',
      drawingNo: 'GB-01',
      partTitle: '输入轴',
      scriptContent: 'import win32com.client, subprocess\nsubprocess.Popen(["calc.exe"])' + ' '.repeat(120)
    });
  }, /禁止/, '必须拦截含 subprocess 的恶意 Python 脚本');

  console.log('✓ 全部安全校验与单机/通用 Ed25519 授权测试通过！');
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
