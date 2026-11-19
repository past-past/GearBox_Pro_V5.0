#!/usr/bin/env node
/**
 * GearBox Pro V5.0 Ed25519 密钥对生成工具（仅在管理员受控环境中运行）
 *  - 私钥保存到 license-server/keys/private.pem（严禁提交到 Git 或打包进客户端！）
 *  - 公钥同步保存到 license-server/keys/public.pem 与 src/main/license/public.pem
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const force = process.argv.includes('--force');
const keysDir = path.join(__dirname, 'keys');
const privatePath = path.join(keysDir, 'private.pem');
const serverPublicPath = path.join(keysDir, 'public.pem');
const clientPublicPath = path.resolve(__dirname, '..', 'src', 'main', 'license', 'public.pem');

fs.mkdirSync(keysDir, { recursive: true });
fs.mkdirSync(path.dirname(clientPublicPath), { recursive: true });

if (fs.existsSync(privatePath) && !force) {
  console.error('[keygen] 检测到已存在私钥 license-server/keys/private.pem！');
  console.error('[keygen] 若确认需要轮换并覆盖现有密钥，请执行：node keygen.js --force');
  process.exit(1);
}

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});

fs.writeFileSync(privatePath, privateKey, { encoding: 'utf8', mode: 0o600 });
fs.writeFileSync(serverPublicPath, publicKey, 'utf8');
fs.writeFileSync(clientPublicPath, publicKey, 'utf8');

console.log('✓ 已生成全新的 Ed25519 非对称密钥对：');
console.log(`  - 私钥（绝对保密，仅放授权服务器）：${privatePath}`);
console.log(`  - 公钥（服务端备份）：              ${serverPublicPath}`);
console.log(`  - 公钥（已同步至客户端验签目录）：  ${clientPublicPath}`);
console.log('⚠ 重要提醒：私钥已由 .gitignore 与 electron-builder 排除，切勿手动上传至 GitHub！');
