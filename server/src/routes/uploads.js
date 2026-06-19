import { Router } from 'express';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { authMiddleware } from '../middleware/auth.js';
import { UPLOADS_DIR } from '../db/init.js';

const router = Router();

router.use(authMiddleware);

const EXT_BY_MIME = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

// 接收 base64 dataURL，落盘到数据目录 uploads 下，返回可访问的相对 URL
router.post('/', (req, res) => {
  const { image } = req.body || {};
  if (!image || typeof image !== 'string') {
    return res.status(400).json({ message: '请提供图片数据' });
  }

  const match = image.match(/^data:(image\/[\w.+-]+);base64,(.+)$/);
  if (!match) {
    return res.status(400).json({ message: '图片格式不正确，需为 base64 dataURL' });
  }

  const mime = match[1].toLowerCase();
  const ext = EXT_BY_MIME[mime];
  if (!ext) {
    return res.status(400).json({ message: '不支持的图片类型' });
  }

  let buffer;
  try {
    buffer = Buffer.from(match[2], 'base64');
  } catch {
    return res.status(400).json({ message: '图片数据解析失败' });
  }
  if (buffer.length === 0 || buffer.length > 8 * 1024 * 1024) {
    return res.status(400).json({ message: '图片为空或超过 8MB' });
  }

  mkdirSync(UPLOADS_DIR, { recursive: true });
  const fileName = `${Date.now()}_${randomBytes(6).toString('hex')}.${ext}`;
  writeFileSync(join(UPLOADS_DIR, fileName), buffer);

  res.status(201).json({ url: `/uploads/${fileName}` });
});

export default router;
