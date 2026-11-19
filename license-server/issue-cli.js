#!/usr/bin/env node
/**
 * GearBox Pro V5.0 服务端命令行授权签发工具
 *
 * 单机绑定签发示例：
 *   node issue-cli.js --machine GBP-1A2B-3C4D-5E6F-7A8B --customer "示例重工有限公司" --expires 2027-12-31 --out ./client.gbplic
 *
 * 通用授权码签发示例（不限机器码，仍受私钥签名与到期日期约束）：
 *   node issue-cli.js --universal --customer "内部测试/企业通用" --expires 2027-12-31 --out ./universal.gbplic
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

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

function signLicense({ machineCode, universal = false, customerName, expiresAt, edition = 'Professional', privateKeyPem }) {
  let cleanMachine = String(machineCode || '').trim().toUpperCase();
  const isUniversal = Boolean(universal) || cleanMachine === 'ANY' || cleanMachine === '*' || cleanMachine === 'ALL';
  if (isUniversal) {
    cleanMachine = UNIVERSAL_MACHINE_CODE;
  }

  const cleanCustomer = String(customerName || '').trim();
  const cleanExpires = String(expiresAt || '').trim();

  if (!isUniversal && !/^GBP-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$/.test(cleanMachine)) {
    throw new Error('机器码格式无效，应类似 GBP-XXXX-XXXX-XXXX-XXXX（如需签发通用授权，请使用 --universal 或传入 ANY）');
  }
  if (!cleanCustomer) {
    throw new Error('客户名称不能为空');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanExpires)) {
    throw new Error('到期日期格式无效，请使用 YYYY-MM-DD（例如 2027-12-31）');
  }

  const payload = {
    licenseId: `LIC-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
    product: PRODUCT_ID,
    edition,
    customerName: cleanCustomer,
    machineCode: cleanMachine,
    issuedAt: new Date().toISOString().slice(0, 10),
    expiresAt: cleanExpires
  };

  const canonical = canonicalizePayload(payload);
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  const sigBuf = crypto.sign(null, Buffer.from(canonical, 'utf8'), privateKey);
  const signature = sigBuf.toString('base64url');
  const payloadB64 = Buffer.from(canonical, 'utf8').toString('base64url');
  const licenseCode = `${CODE_PREFIX}${payloadB64}.${signature}`;

  const licenseFileObject = {
    format: 'GearBoxProLicense',
    algorithm: 'Ed25519',
    licenseType: isUniversal ? 'universal' : 'machine_bound',
    payload,
    signature,
    licenseCode
  };

  return { payload, signature, licenseCode, licenseFileObject, isUniversal };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i];
    if (key === '--universal') {
      args.universal = true;
    } else if (key.startsWith('--') && i + 1 < argv.length) {
      args[key.slice(2)] = argv[++i];
    }
  }
  return args;
}

if (require.main === module) {
  const args = parseArgs(process.argv);
  const keyPath = args.key || process.env.LICENSE_PRIVATE_KEY_PATH || path.join(__dirname, 'keys', 'private.pem');

  if ((!args.machine && !args.universal) || !args.customer || !args.expires) {
    console.log('单机授权：node issue-cli.js --machine <机器码> --customer <客户名称> --expires <YYYY-MM-DD> [--out 文件.gbplic]');
    console.log('通用授权：node issue-cli.js --universal --customer <客户名称> --expires <YYYY-MM-DD> [--out 文件.gbplic]');
    process.exit(1);
  }
  if (!fs.existsSync(keyPath)) {
    console.error(`[issue-cli] 未找到私钥文件：${keyPath}，请先运行 node keygen.js`);
    process.exit(1);
  }

  try {
    const privateKeyPem = fs.readFileSync(keyPath, 'utf8');
    const result = signLicense({
      machineCode: args.machine,
      universal: Boolean(args.universal),
      customerName: args.customer,
      expiresAt: args.expires,
      edition: args.edition || 'Professional',
      privateKeyPem
    });

    const jsonText = JSON.stringify(result.licenseFileObject, null, 2);
    if (args.out) {
      fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
      fs.writeFileSync(args.out, jsonText, 'utf8');
      console.log(`✓ 已生成授权文件：${path.resolve(args.out)}`);
    }
    console.log('\n================ 授权信息 ================');
    console.log(`授权编号：${result.payload.licenseId}`);
    console.log(`授权模式：${result.isUniversal ? '通用授权（不限机器码）' : '单机绑定授权'}`);
    console.log(`客户名称：${result.payload.customerName}`);
    console.log(`机器码：  ${result.payload.machineCode}`);
    console.log(`有效期至：${result.payload.expiresAt}`);
    console.log('\n================ 授权码（可直接发送给客户粘贴激活） ================');
    console.log(result.licenseCode);
  } catch (err) {
    console.error('[issue-cli] 签发失败：', err.message);
    process.exit(1);
  }
}

module.exports = { signLicense, canonicalizePayload, UNIVERSAL_MACHINE_CODE };
