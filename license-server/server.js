#!/usr/bin/env node
/**
 * GearBox Pro V5.0.6 授权签发管理服务器（零第三方依赖，纯 Node.js 原生 http + crypto）
 * 支持：单机绑定授权（指定机器码）与 通用授权码（不限机器码，仍受私钥签名与到期日期约束）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { signLicense } = require('./issue-cli');

const HOST = process.env.LICENSE_SERVER_HOST || '127.0.0.1';
const PORT = Number(process.env.LICENSE_SERVER_PORT || 8090);
const ADMIN_TOKEN = process.env.LICENSE_ADMIN_TOKEN || '';
const PRIVATE_KEY_PATH = process.env.LICENSE_PRIVATE_KEY_PATH || path.join(__dirname, 'keys', 'private.pem');
const AUDIT_LOG_PATH = path.join(__dirname, 'issued-audit.jsonl');

if (!ADMIN_TOKEN || ADMIN_TOKEN.length < 12) {
  console.error('[license-server] 安全拦截：必须设置长度不少于 12 位的环境变量 LICENSE_ADMIN_TOKEN 才允许启动服务器！');
  console.error('示例（Linux/macOS）：LICENSE_ADMIN_TOKEN="YourStrongRandomSecretToken2026" node server.js');
  console.error('示例（Windows PowerShell）：$env:LICENSE_ADMIN_TOKEN="YourStrongRandomSecretToken2026"; node server.js');
  process.exit(1);
}

if (!fs.existsSync(PRIVATE_KEY_PATH)) {
  console.error(`[license-server] 未找到私钥文件 ${PRIVATE_KEY_PATH}，请先运行 node keygen.js`);
  process.exit(1);
}

const privateKeyPem = fs.readFileSync(PRIVATE_KEY_PATH, 'utf8');

const ADMIN_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>GearBox Pro V5.0.6 授权签发管理台</title>
<style>
  body { font-family: "Microsoft YaHei", system-ui, sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; padding: 32px 16px; }
  .card { max-width: 680px; margin: 0 auto; background: #1e293b; border: 1px solid #334155; border-radius: 14px; padding: 28px; box-shadow: 0 20px 50px rgba(0,0,0,0.35); }
  h1 { margin: 0 0 6px; font-size: 20px; color: #38bdf8; }
  p.sub { margin: 0 0 22px; font-size: 13px; color: #94a3b8; }
  label { display: block; font-size: 13px; font-weight: 600; margin: 14px 0 6px; color: #cbd5e1; }
  input, select, textarea { width: 100%; box-sizing: border-box; padding: 10px 12px; border-radius: 8px; border: 1px solid #475569; background: #0f172a; color: #f8fafc; font-size: 13px; }
  input:disabled { opacity: 0.65; cursor: not-allowed; }
  .hint { font-size: 12px; color: #fbbf24; margin-top: 6px; display: none; }
  button { margin-top: 18px; padding: 11px 18px; border-radius: 8px; border: 0; background: #0284c7; color: #fff; font-weight: 600; cursor: pointer; font-size: 14px; }
  button:hover { background: #0369a1; }
  .btn-sec { background: #059669; margin-left: 8px; }
  .out { margin-top: 20px; padding: 14px; border-radius: 10px; background: #020617; border: 1px solid #334155; display: none; }
  .err { color: #fda4af; font-size: 13px; margin-top: 10px; }
  .mono { font-family: Consolas, monospace; word-break: break-all; }
</style>
</head>
<body>
  <div class="card">
    <h1>GearBox Pro V5.0.6 授权签发管理台</h1>
    <p class="sub">私钥仅保留在服务端 · 支持单机绑定授权与通用授权 · 客户端离线公钥验签</p>
    <label>管理员令牌 (LICENSE_ADMIN_TOKEN)</label>
    <input id="token" type="password" placeholder="输入服务端配置的管理员令牌" />
    <label>授权模式</label>
    <select id="licenseMode">
      <option value="machine">单机绑定授权（绑定指定机器码）</option>
      <option value="universal">通用授权码（不限机器码 · 仍受私钥签名与有效期限制）</option>
    </select>
    <label>客户机器码</label>
    <input id="machine" type="text" placeholder="例如：GBP-1A2B-3C4D-5E6F-7A8B" />
    <div id="universalHint" class="hint">⚠ 当前已选择【通用授权码】：签发后的授权码可在任意电脑上离线激活使用（到期后自动失效），请妥善保管并控制分发范围。</div>
    <label>客户名称 / 单位名称</label>
    <input id="customer" type="text" placeholder="例如：某某重工传动有限公司" />
    <label>授权到期日期 (YYYY-MM-DD)</label>
    <input id="expires" type="date" />
    <label>授权版本</label>
    <select id="edition">
      <option value="Professional">Professional 专业版</option>
      <option value="Enterprise">Enterprise 企业版</option>
      <option value="Trial">Trial 评估版</option>
    </select>
    <div>
      <button id="btnIssue">签发离线授权</button>
      <button id="btnDownload" class="btn-sec" style="display:none;">下载 .gbplic 授权文件</button>
    </div>
    <div id="err" class="err"></div>
    <div id="out" class="out">
      <div style="font-size:12px;color:#34d399;margin-bottom:8px;">✓ 签发成功！可复制下方授权码发送给客户，或点击下载 .gbplic 授权文件：</div>
      <textarea id="codeOut" rows="4" readonly class="mono"></textarea>
    </div>
  </div>
<script>
  let lastLicenseObj = null;
  const modeSel = document.getElementById('licenseMode');
  const machineInp = document.getElementById('machine');
  const universalHint = document.getElementById('universalHint');

  modeSel.onchange = () => {
    const isUniv = modeSel.value === 'universal';
    machineInp.disabled = isUniv;
    universalHint.style.display = isUniv ? 'block' : 'none';
    if (isUniv) {
      machineInp.dataset.prev = machineInp.value;
      machineInp.value = 'ANY';
    } else {
      machineInp.value = machineInp.dataset.prev || '';
    }
  };

  document.getElementById('btnIssue').onclick = async () => {
    const errEl = document.getElementById('err');
    const outEl = document.getElementById('out');
    const dlBtn = document.getElementById('btnDownload');
    errEl.textContent = '';
    outEl.style.display = 'none';
    dlBtn.style.display = 'none';
    const isUniv = modeSel.value === 'universal';
    try {
      const resp = await fetch('/api/licenses/issue', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + document.getElementById('token').value.trim()
        },
        body: JSON.stringify({
          universal: isUniv,
          machineCode: isUniv ? 'ANY' : machineInp.value.trim(),
          customerName: document.getElementById('customer').value.trim(),
          expiresAt: document.getElementById('expires').value.trim(),
          edition: document.getElementById('edition').value
        })
      });
      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        errEl.textContent = data.error || '签发失败';
        return;
      }
      lastLicenseObj = data.licenseFileObject;
      document.getElementById('codeOut').value = data.licenseCode;
      outEl.style.display = 'block';
      dlBtn.style.display = 'inline-block';
    } catch (e) {
      errEl.textContent = '请求失败：' + e.message;
    }
  };
  document.getElementById('btnDownload').onclick = () => {
    if (!lastLicenseObj) return;
    const blob = new Blob([JSON.stringify(lastLicenseObj, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const suffix = lastLicenseObj.payload.machineCode === 'ANY' ? 'UNIVERSAL' : lastLicenseObj.payload.machineCode;
    a.download = (lastLicenseObj.payload.customerName || 'GearBox') + '_' + suffix + '.gbplic';
    a.click();
    URL.revokeObjectURL(a.href);
  };
</script>
</body>
</html>`;

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    return sendJson(res, 200, { ok: true, service: 'GearBox-Pro-License-Server', version: '5.0.6' });
  }

  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(ADMIN_HTML);
    return;
  }

  if (req.method === 'POST' && req.url === '/api/licenses/issue') {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (token !== ADMIN_TOKEN) {
      return sendJson(res, 401, { ok: false, error: '管理员令牌校验失败 (401 Unauthorized)' });
    }

    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 64 * 1024) req.destroy();
    });
    req.on('end', () => {
      try {
        const input = JSON.parse(body || '{}');
        const issued = signLicense({
          universal: Boolean(input.universal),
          machineCode: input.machineCode,
          customerName: input.customerName,
          expiresAt: input.expiresAt,
          edition: input.edition || 'Professional',
          privateKeyPem
        });

        const auditRecord = {
          timestamp: new Date().toISOString(),
          remoteAddress: req.socket.remoteAddress,
          licenseId: issued.payload.licenseId,
          licenseType: issued.isUniversal ? 'universal' : 'machine_bound',
          customerName: issued.payload.customerName,
          machineCode: issued.payload.machineCode,
          expiresAt: issued.payload.expiresAt,
          edition: issued.payload.edition
        };
        fs.appendFileSync(AUDIT_LOG_PATH, JSON.stringify(auditRecord) + '\n', 'utf8');

        return sendJson(res, 200, {
          ok: true,
          licenseCode: issued.licenseCode,
          licenseFileObject: issued.licenseFileObject
        });
      } catch (err) {
        return sendJson(res, 400, { ok: false, error: err.message });
      }
    });
    return;
  }

  sendJson(res, 404, { ok: false, error: 'Not Found' });
});

server.listen(PORT, HOST, () => {
  console.log(`✓ GearBox Pro V5.0.6 授权签发管理服务器已启动：http://${HOST}:${PORT}`);
  console.log('  支持单机绑定授权与通用授权（ANY），建议生产环境通过 Nginx/Caddy 启用 HTTPS。');
});
