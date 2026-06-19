import { Router } from 'express';
import { getDb } from '../db/init.js';
import { authMiddleware, adminMiddleware } from '../middleware/auth.js';

const router = Router();

router.use(authMiddleware);

router.get('/', adminMiddleware, (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const config = {};
  rows.forEach((r) => {
    config[r.key] = r.value;
  });
  res.json(config);
});

router.post('/', adminMiddleware, (req, res) => {
  const db = getDb();
  const upsert = db.prepare(
    'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'
  );

  const transaction = db.transaction((data) => {
    for (const [key, value] of Object.entries(data)) {
      if (key.startsWith('ocr_') || key.startsWith('system_') || key.startsWith('collector_')) {
        upsert.run(key, String(value));
      }
    }
  });

  transaction(req.body);
  res.json({ message: '配置保存成功' });
});

router.get('/token-usage', adminMiddleware, (req, res) => {
  const db = getDb();
  const { start_date, end_date } = req.query;

  let where = '';
  const params = [];
  if (start_date && end_date) {
    where = 'WHERE created_at BETWEEN ? AND ?';
    params.push(start_date, end_date + ' 23:59:59');
  } else if (start_date) {
    where = 'WHERE created_at >= ?';
    params.push(start_date);
  }

  const summary = db.prepare(`
    SELECT
      COUNT(*) as call_count,
      COALESCE(SUM(prompt_tokens), 0) as total_prompt_tokens,
      COALESCE(SUM(completion_tokens), 0) as total_completion_tokens,
      COALESCE(SUM(total_tokens), 0) as total_tokens,
      COALESCE(SUM(CASE WHEN model LIKE '%ocr%' THEN 0.3/1000000 * total_tokens ELSE 0.004/1000000 * total_tokens END), 0) as estimated_cost
    FROM token_usage ${where}
  `).get(...params);

  const dailyStats = db.prepare(`
    SELECT
      DATE(created_at) as date,
      COUNT(*) as call_count,
      COALESCE(SUM(prompt_tokens), 0) as prompt_tokens,
      COALESCE(SUM(completion_tokens), 0) as completion_tokens,
      COALESCE(SUM(total_tokens), 0) as total_tokens
    FROM token_usage ${where}
    GROUP BY DATE(created_at)
    ORDER BY DATE(created_at) DESC
    LIMIT 30
  `).all(...params);

  const recentCalls = db.prepare(`
    SELECT t.model, t.prompt_tokens, t.completion_tokens, t.total_tokens, t.created_at, u.nickname
    FROM token_usage t
    LEFT JOIN users u ON t.user_id = u.id
    ${where.replace('created_at', 't.created_at')}
    ORDER BY t.created_at DESC
    LIMIT 50
  `).all(...params);

  res.json({ summary, dailyStats, recentCalls });
});

export default router;
