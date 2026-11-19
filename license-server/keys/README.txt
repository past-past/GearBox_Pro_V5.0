本目录用于存放 Ed25519 授权密钥对：
- private.pem：服务端签发私钥（已被 .gitignore 与 electron-builder 排除，严禁上传 GitHub 或分发给客户！）
- public.pem ：验签公钥（会同步复制到 src/main/license/public.pem 随客户端打包）

生产发布前请务必在管理员机器上执行：
  cd license-server
  node keygen.js --force
然后仅将更新后的 src/main/license/public.pem 提交到 GitHub 仓库触发打包。
