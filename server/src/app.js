import express from 'express';
import cors from 'cors';
import { existsSync, readFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { initDb, UPLOADS_DIR } from './db/init.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import shopRoutes from './routes/shops.js';
import orderRoutes from './routes/orders.js';
import expenseRoutes from './routes/expenses.js';
import reportRoutes from './routes/reports.js';
import ocrRoutes from './routes/ocr.js';
import settingsRoutes from './routes/settings.js';
import collectorRoutes from './routes/collector.js';
import qianniuRoutes from './routes/qianniu.js';
import factoryRoutes from './routes/factory.js';
import uploadRoutes from './routes/uploads.js';
import productRoutes from './routes/products.js';
import { createRemoteProxyMiddleware, normalizeRemoteBaseUrl } from './middleware/remoteProxy.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '';

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const remoteBaseUrl = normalizeRemoteBaseUrl(process.env.ERP_REMOTE_BASE_URL);
if (remoteBaseUrl) {
  const remoteProxy = createRemoteProxyMiddleware(remoteBaseUrl);
  app.use('/api/auth', remoteProxy);
  app.use('/api/users', remoteProxy);
  app.use('/api/shops', remoteProxy);
  app.use('/api/orders', remoteProxy);
  app.use('/api/expenses', remoteProxy);
  app.use('/api/reports', remoteProxy);
  app.use('/api/ocr', remoteProxy);
  app.use('/api/settings', remoteProxy);
  app.use('/api/factory', remoteProxy);
  app.use('/api/uploads', remoteProxy);
  app.use('/api/products', remoteProxy);
  app.use('/api/qianniu', remoteProxy);
  // 注：素材图为二进制，不走文本代理（会损坏）。Web 端直接访问中心服务器，
  // 图片由中心服务器的静态目录提供，桥接端不再本地服务 /uploads。
} else {
  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/shops', shopRoutes);
  app.use('/api/orders', orderRoutes);
  app.use('/api/expenses', expenseRoutes);
  app.use('/api/reports', reportRoutes);
  app.use('/api/ocr', ocrRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/factory', factoryRoutes);
  app.use('/api/uploads', uploadRoutes);
  app.use('/api/products', productRoutes);
  app.use('/api/qianniu', qianniuRoutes);

  // 工厂素材图静态访问（存储在挂载盘或数据目录）
  mkdirSync(UPLOADS_DIR, { recursive: true });
  app.use('/uploads', express.static(UPLOADS_DIR, {
    setHeaders(res) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    },
  }));
}
app.use('/api/collector', collectorRoutes);

const clientDist = join(__dirname, '..', '..', 'client', 'dist');
const updatesDir = join(__dirname, '..', '..', 'updates');

function normalizeVersion(value) {
  return String(value || '').trim().replace(/^v/i, '').split('-')[0];
}

function compareVersions(a, b) {
  const left = normalizeVersion(a).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const right = normalizeVersion(b).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(left.length, right.length, 3);
  for (let i = 0; i < length; i += 1) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

app.get('/updates/latest', (req, res) => {
  const manifest = join(updatesDir, 'manifest.json');
  if (!existsSync(manifest)) {
    return res.status(404).send('No update package is available.');
  }

  try {
    const body = JSON.parse(readFileSync(manifest, 'utf8').replace(/^\uFEFF/, ''));
    let downloadUrl = body.download_url || body.download_page_url;
    if (typeof downloadUrl === 'string' && downloadUrl.startsWith('/')) {
      const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
      const proto = forwardedProto || req.protocol || 'http';
      const publicBaseUrl = (process.env.PUBLIC_BASE_URL || `${proto}://${req.get('host')}`).replace(/\/+$/, '');
      downloadUrl = `${publicBaseUrl}${downloadUrl}`;
    }
    if (!downloadUrl) {
      return res.status(404).send('No update package is available.');
    }
    return res.redirect(302, downloadUrl);
  } catch {
    return res.status(500).send('Update manifest is invalid.');
  }
});
app.use('/updates', express.static(updatesDir));
app.get('/api/updates/manifest', (req, res) => {
  const manifest = join(updatesDir, 'manifest.json');
  if (!existsSync(manifest)) {
    return res.json({
      ok: true,
      update_available: false,
      message: '暂无可用更新',
    });
  }

  try {
    const body = JSON.parse(readFileSync(manifest, 'utf8').replace(/^\uFEFF/, ''));
    const current = normalizeVersion(req.query.current);
    const latest = normalizeVersion(body.version);
    if (current && latest && compareVersions(latest, current) <= 0) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      return res.json({
        ok: true,
        update_available: false,
        version: latest,
        current,
        message: '已是最新版',
      });
    }

    const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
    const proto = forwardedProto || req.protocol || 'http';
    const publicBaseUrl = (process.env.PUBLIC_BASE_URL || `${proto}://${req.get('host')}`).replace(/\/+$/, '');
    if (typeof body.download_url === 'string' && body.download_url.startsWith('/')) {
      body.download_url = `${publicBaseUrl}${body.download_url}`;
    }
    if (body.download_url && !body.download_page_url) {
      body.download_page_url = body.download_url;
    }
    body.ok = true;
    body.update_available = true;
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    return res.json(body);
  } catch {
    return res.sendFile(manifest);
  }
});

app.use(express.static(clientDist, {
  setHeaders(res, filePath) {
    if (filePath.endsWith('index.html')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      return;
    }

    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  },
}));
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(join(clientDist, 'index.html'));
  }
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: '服务器内部错误' });
});

initDb();

app.listen(PORT, HOST || undefined, () => {
  console.log(`Server running on ${HOST || '0.0.0.0'}:${PORT}`);
  if (remoteBaseUrl) {
    console.log(`Bridge mode enabled, remote ERP: ${remoteBaseUrl}`);
  }
});
