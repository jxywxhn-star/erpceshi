import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'erp_secret_key_2024';

export function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: '未登录，请先登录' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Token 已过期，请重新登录' });
  }
}

export function adminMiddleware(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: '权限不足，仅管理员可操作' });
  }
  next();
}

export function factoryMiddleware(req, res, next) {
  if (req.user.role !== 'factory') {
    return res.status(403).json({ message: '权限不足，仅工厂账号可操作' });
  }
  next();
}

export { JWT_SECRET };
