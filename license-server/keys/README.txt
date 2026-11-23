本目录用于存放 Ed25519 授权密钥对：
- private.pem：服务端签发私钥（已被 .gitignore 与 electron-builder 排除，严禁上传 GitHub 或分发给客户！）
- public.pem ：验签公钥（会同步复制到 src/main/license/public.pem 随客户端打包）

升级软件时应沿用与服务端 private.pem 匹配的现有公钥，不要直接替换公钥或运行 keygen.js --force，否则旧授权将无法通过新版验签。
只有在计划轮换密钥时才重新生成密钥对，并同步更新 license-server/keys/public.pem 与 src/main/license/public.pem。轮换会导致旧密钥签发的授权失效，必须提前安排客户重新激活。
private.pem 仅保存在管理员受控服务器，不得提交到 GitHub。
