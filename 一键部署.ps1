$SERVER = "root@111.228.63.217"
$ERP_DIR = "$HOME\desktop\erp"

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  ERP 一键部署脚本（Windows -> Linux）" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "[1/4] 打包项目文件..." -ForegroundColor Yellow
$bundleTmp = "$env:TEMP\erp-bundle.tar.gz"
tar -czf $bundleTmp `
  --exclude="node_modules" `
  --exclude=".vite" `
  --exclude="data" `
  --exclude="dist" `
  --exclude=".env" `
  --exclude="deploy-payload.txt" `
  --exclude="server-setup.sh" `
  --exclude="erp-bundle.tar.gz" `
  --exclude="erp-deploy.tar.gz" `
  -C $ERP_DIR `
  client/src `
  client/package.json `
  client/package-lock.json `
  client/vite.config.js `
  client/index.html `
  client/.env.production `
  server/src `
  server/package.json `
  server/package-lock.json
if (-not $?) { Write-Host "  打包失败！" -ForegroundColor Red; exit 1 }
Write-Host "  OK" -ForegroundColor Green

Write-Host "[2/4] 上传文件到服务器..." -ForegroundColor Yellow
scp -o StrictHostKeyChecking=no $bundleTmp "${SERVER}:/root/erp-bundle.tar.gz"
if (-not $?) { Write-Host "  上传失败！请检查服务器连接和密码。" -ForegroundColor Red; exit 1 }
Write-Host "  OK" -ForegroundColor Green

Write-Host "[3/4] 远程安装部署..." -ForegroundColor Yellow
$deployScript = @'
mkdir -p /root/erp
cd /root/erp
tar xzf /root/erp-bundle.tar.gz

if ! command -v node &> /dev/null; then
  echo "Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - > /dev/null 2>&1
  apt-get install -y nodejs > /dev/null 2>&1
fi
echo "Node: $(node -v)"

if ! command -v pm2 &> /dev/null; then
  npm install -g pm2 > /dev/null 2>&1
fi

echo "Installing server deps..."
cd /root/erp/server
npm install --production > /dev/null 2>&1

echo "Building client..."
cd /root/erp/client
npm install > /dev/null 2>&1
npm run build > /dev/null 2>&1

echo "Starting service..."
cd /root/erp/server
pm2 delete erp 2>/dev/null
ERP_ENABLE_LOCAL_COLLECTOR_CONTROLS=0 pm2 start src/app.js --name erp
pm2 save 2>/dev/null

echo ""
echo "============================================"
echo "  DONE!"
echo "============================================"
echo "  URL: http://$(hostname -I | awk '{print $1}'):3001"
echo "  Collector control: disabled on central server"
echo ""
pm2 logs erp --lines 15 --nostream
'@

$deployScript | ssh -o StrictHostKeyChecking=no $SERVER "bash -s"
if (-not $?) { Write-Host "  远程部署失败！" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "[4/4] 清理临时文件..." -ForegroundColor Yellow
Remove-Item $bundleTmp -ErrorAction SilentlyContinue
Write-Host "  OK" -ForegroundColor Green

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "  部署完成！" -ForegroundColor Green
Write-Host "  访问: http://111.228.63.217:3001" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
