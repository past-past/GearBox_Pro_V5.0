# GearBox Pro减速机参数化设计及建模系统 (Windows 桌面端 V5.0)

本项目将 **GearBox Pro V5.0** 网页端封装为可离线部署在 Windows 10/11 (x64) 系统的 Electron 桌面应用程序，集成参数工程存取、本地化离线资源、受控安全主进程 SolidWorks / AutoCAD Mechanical 自动建模、Ed25519 非对称离线授权验签，以及 GitHub Actions 自动化打包与 `V5.0` 发布流程。

---

## 一、核心功能与安全架构

1. **参数工程文件保存与打开 (`.gbpro`)**
   - 支持通过顶部「保存参数 / 打开参数」按钮或菜单「文件 → 保存 / 另存为 / 打开 (`Ctrl+S` / `Ctrl+Shift+S` / `Ctrl+O`)」，自由选择路径与文件名保存当前全部减速机参数配置，随时重新载入复现。
2. **原生视图控制与帮助文档**
   - 菜单栏「视图」提供：重新加载 (`Ctrl+R`)、强制重新加载 (`Ctrl+Shift+R`)、放大 (`Ctrl+=`)、缩小 (`Ctrl+-`)、重置缩放 (`Ctrl+0`)、全屏 (`F11`) 及浅色/深色工程界面切换 (`Ctrl+Shift+T`)。
   - 内置「帮助文档 (`F1`)」完整介绍参数设置、工程存取与 SolidWorks / AutoCAD Mechanical 建模流程。
3. **100% 本地化离线资源**
   - 移除所有外部 CDN（Tailwind CSS、Three.js、Google Fonts），通过 `scripts/prepare-assets.js` 在构建阶段自动将 `three@0.128.0` 与 `tailwindcss@3.4.17` 本地编译打包进 `src/renderer/vendor/`，支持完全离线运行且界面零错位。
   - 优化浅色工业界面（`theme-industrial-light`）的三维视口背景（`#cfdbe8`）、半透明箱盖（深钴蓝 `0x0369a1`）与轴段金属对比度，以及彩色/渐变按钮文字可读性。
4. **受控 Electron 主进程建模架构（告别 HTA / ActiveX / 本机 HTTP 脚本服务）**
   - 渲染进程强制开启 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`、`webSecurity: true`。
   - 仅通过 `src/main/preload.js` 暴露受限的 `window.gearboxDesktop` IPC 方法；主进程逐次校验 `event.senderFrame.url` 必须为本应用本地 `index.html`，并对建模命令白名单、建模范围参数与脚本文本执行严格安全审计（拦截 `WScript.Shell`、PowerShell、网络请求、`subprocess`、`eval` 等危险原语），仅通过 `child_process.execFile`（无 Shell）调用本机 `cscript.exe`（SolidWorks COM）与 `python`（AutoCAD Mechanical）。
5. **非对称加密授权机制（服务端私钥签发 · 客户端离线公钥验签）**
   - 算法：Node.js 原生 **Ed25519** 椭圆曲线数字签名。
   - **客户端仅内置公钥**（`src/main/license/public.pem`），用于离线校验授权签名、机器码绑定与到期日期；公钥无法伪造或签发任何新授权。
   - **无打扰体验**：授权信息**不会常驻显示在软件主界面**；仅在首次启动未授权或授权到期/失效时弹出激活窗口，激活成功后自动隐藏且不再弹窗，直至授权到期。

---

## 二、目录结构说明

```text
GearBox-Pro-Desktop/
├── .github/workflows/release.yml   # GitHub Actions 自动构建 Windows 安装包与 V5.0 Release
├── build/
│   ├── icon.ico                    # Windows 多分辨率齿轮主题图标
│   └── icon.png                    # 512×512 高清齿轮图标
├── scripts/
│   ├── prepare-assets.js           # 构建前本地化 Three.js 与 Tailwind CSS
│   └── verify-build.js             # 构建前离线授权验签与安全策略自动化测试
├── src/
│   ├── main/
│   │   ├── main.js                 # Electron 主进程（安全窗口、中文菜单、IPC 校验）
│   │   ├── preload.js              # 最小权限 contextBridge 桥接
│   │   ├── cad-service.js          # 受控 SolidWorks / AutoCAD Mechanical 执行模块
│   │   └── license/
│   │       ├── machine-id.js       # Windows 硬件指纹机器码生成器
│   │       ├── license-manager.js  # 离线 Ed25519 公钥验签管理器
│   │       └── public.pem          # 仅含公钥（安全随客户端打包）
│   └── renderer/
│       ├── index.html              # 主界面（零外链、浅色对比度增强）
│       ├── desktop-bridge.js       # 工程存取、帮助弹窗、首次授权弹窗逻辑
│       ├── styles/tailwind-input.css
│       └── vendor/fonts.css        # 纯本地 Windows 工程字体栈
└── license-server/                 # 【仅部署在管理员服务器，打包客户端时自动排除】
    ├── keygen.js                   # 生成 Ed25519 私钥/公钥对
    ├── issue-cli.js                # 命令行授权签发工具
    ├── server.js                   # 零依赖 HTTP 管理签发服务器 + Web 控制台 + 审计日志
    └── .env.example                # 环境变量配置示例
```

---

## 三、打包与授权管理服务器配置（重要必读）

> **核心安全原则：私钥 (`private.pem`) 永远只保存在管理员受控的授权服务器中，绝不可上传至 GitHub 仓库，也绝不可打包进客户端安装包！**

### 第 1 步：在管理员受控机器上生成正式密钥对

压缩包中预置的 `src/main/license/public.pem` 仅用于保证首次 CI 校验通过（不含对应私钥）。**在正式面向客户发布前，请务必在您的受控服务器或管理员电脑上重新生成正式密钥对：**

```bash
cd license-server
node keygen.js --force
```

执行后会自动生成：
- `license-server/keys/private.pem`：**正式签发私钥**（权限 `600`，已被 `.gitignore` 与 `electron-builder` 排除，请立即做好离线加密备份，**切勿提交到 Git**）。
- `src/main/license/public.pem`：**正式验签公钥**（请仅将此公钥文件提交到 GitHub 仓库，以便 GitHub Actions 将正式公钥打包进 Windows 客户端）。

### 第 2 步：部署授权管理服务器（推荐内网/HTTPS 反向代理）

`license-server/server.js` 为纯 Node.js 原生实现（需 Node.js >= 18，**无需安装任何 npm 依赖**）。

1. 将整个 `license-server/` 目录（含 `keys/private.pem`）上传至您的管理服务器（如 Linux 云服务器或公司内网受控主机）。
2. 设置高强度管理员令牌并启动服务（默认仅监听 `127.0.0.1:8090`）：
   - **Linux (systemd / shell)**：
     ```bash
     export LICENSE_SERVER_HOST=127.0.0.1
     export LICENSE_SERVER_PORT=8090
     export LICENSE_ADMIN_TOKEN="请替换为至少24位高强度随机字符串"
     node server.js
     ```
   - **Windows PowerShell**：
     ```powershell
     $env:LICENSE_SERVER_HOST="127.0.0.1"
     $env:LICENSE_SERVER_PORT="8090"
     $env:LICENSE_ADMIN_TOKEN="请替换为至少24位高强度随机字符串"
     node server.js
     ```
3. **生产环境加固建议**：
   - 使用 **Nginx / Caddy** 作为反向代理对外提供 **HTTPS (TLS 1.2+)**，禁止明文 HTTP 暴露管理员令牌。
   - 在防火墙或 Nginx 层限制仅允许公司办公网 IP / VPN 访问管理控制台（`/` 与 `/api/licenses/issue`）。
   - 保护私钥文件权限：`chmod 600 license-server/keys/private.pem`（Windows 下通过 NTFS ACL 仅允许运行服务的管理员账户读取）。
   - 定期备份 `license-server/issued-audit.jsonl` 签发审计日志，用于追踪所有客户授权记录。
   - 若怀疑私钥泄露，需重新执行 `node keygen.js --force` 生成新密钥对，更新客户端 `public.pem` 并发布新版本。

### 第 3 步：为客户签发离线授权（两种方式）

客户首次打开软件后，在弹窗中复制本机机器码（例如 `GBP-1A2B-3C4D-5E6F-7A8B`）并连同单位名称发给管理员：

- **方式 A：通过 Web 签发管理台**
  打开部署好的管理台地址（如 `https://license.your-domain.com/`），输入管理员令牌、客户机器码、客户名称与到期日期，点击「签发离线授权」，可直接复制 `GBPRO1.xxxx.yyyy` 授权码或下载 `.gbplic` 授权文件发给客户。
- **方式 B：通过服务器命令行签发（支持单机绑定与通用授权）**
  - 单机绑定授权：
  ```bash
  cd license-server
  node issue-cli.js --machine GBP-1A2B-3C4D-5E6F-7A8B --customer "某某传动机械有限公司" --expires 2027-12-31 --out ./issued_customer.gbplic
  ```
  - 通用授权码（不限机器码，仍受 Ed25519 私钥签名与到期日期约束）：
  ```bash
  cd license-server
  node issue-cli.js --universal --customer "企业通用授权" --expires 2027-12-31 --out ./universal.gbplic
  ```
  （在 Web 签发管理台中，也可直接将「授权模式」切换为 **通用授权码** 一键签发。）

客户在离线电脑上导入 `.gbplic` 文件或粘贴授权码即可完成本地公钥验签激活；**激活后完全离线使用，且不再弹窗显示授权信息直至授权到期**。

---

## 四、GitHub 打包与 `V5.0` 发布流程

本项目已内置 `.github/workflows/release.yml`，推送 `V5.0` 标签后将由 GitHub Actions 的 `windows-latest` 云端环境自动完成：安装依赖 → 本地化 Three.js & Tailwind CSS → 运行安全与授权校验测试 → 打包 Windows 安装程序（NSIS `.exe`）与绿色便携版（Portable `.exe`）→ 自动创建 GitHub Release 并上传产物。

### 发布步骤

1. **创建 GitHub 仓库**：在 GitHub 新建一个私有或公开仓库（例如 `gearbox-pro-desktop`）。
2. **解压并初始化代码**：将本压缩包解压到本地文件夹，先按第三节第 1 步在管理员环境生成正式密钥并同步 `src/main/license/public.pem`（确认 `git status` 中**没有** `private.pem`）。
3. **提交并推送主分支**：
   ```bash
   git init
   git add .
   git commit -m "Release GearBox Pro Desktop V5.0"
   git branch -M main
   git remote add origin https://github.com/<你的用户名>/<你的仓库名>.git
   git push -u origin main
   ```
4. **开启 GitHub Actions 写入权限**：在仓库页面进入 `Settings → Actions → General → Workflow permissions`，选择 **Read and write permissions** 并保存。
5. **创建并推送 `V5.0` 标签触发自动打包发布**：
   ```bash
   git tag V5.0
   git push origin V5.0
   ```
6. **下载发布成品**：在仓库顶部进入 `Actions` 查看构建进度（约 3–5 分钟），构建完成后在仓库右侧 **Releases → V5.0** 页面即可直接下载：
   - `GearBoxPro-V5.0.0-Windows-x64-nsis.exe`（标准 Windows 安装包，含桌面快捷方式与开始菜单）
   - `GearBoxPro-V5.0.0-Windows-x64-portable.exe`（免安装绿色单文件版）
   - `SHA256SUMS.txt`（完整性校验哈希文件）

---

## 五、本机运行环境要求

- **操作系统**：Windows 10 (1809+) / Windows 11 64 位。
- **SolidWorks 自动建模**：本机需安装 SolidWorks 2018–2025（COM 自动化接口）。
- **AutoCAD Mechanical 2D 自动出图**：本机需安装 AutoCAD Mechanical（2018–2025）及 Python 3.8+（安装依赖 `pip install pywinauto pywin32`）。
---

## 六、客户端自动更新说明 (`electron-updater`)

本项目已集成离线友好的 `electron-updater` 自动更新能力（仅对 NSIS 安装版生效，离线用户断网启动时静默跳过，绝不弹窗打扰）：

1. **如何发布新版本触发客户端自动更新**：
   - 修改 `package.json` 中的 `"version"`（必须高于旧版本，例如从 `"5.0.0"` 改为 `"5.0.1"` 或 `"5.1.0"`）。
   - 提交代码后打新标签并推送：
     ```bash
     git add package.json
     git commit -m "Bump version to 5.0.1"
     git push origin main
     git tag V5.0.1
     git push origin V5.0.1
     ```
   - GitHub Actions 会自动将仓库名写入 `app-update.yml`，并在 Release 中一并上传 `latest.yml`、`.blockmap` 增量包与新 `.exe` 安装包。
2. **客户端更新体验**：
   - 联网启动软件 6 秒后自动静默检查，或在菜单栏点击 **「帮助 → 检查软件更新...」** 手动检查。
   - 发现新版本后弹窗确认，后台下载时在 Windows 任务栏图标上显示进度条，下载完成后一键重启覆盖安装（**保留原有离线授权与本地 `.gbpro` 参数文件**）。
3. **注意事项**：
   - 直接使用 GitHub Releases 自动更新时，仓库需为 **Public（公开）**；若使用 Private（私有）仓库，仍可通过手动下载 Release 安装包覆盖升级。
