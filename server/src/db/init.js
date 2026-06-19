import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { mkdirSync } from 'fs';
import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const DATA_DIR = process.env.ERP_DATA_DIR
  ? resolve(process.env.ERP_DATA_DIR)
  : join(__dirname, '../../data');
const DB_PATH = join(DATA_DIR, 'erp.db');
// 图片上传目录：优先用挂载盘（ERP_UPLOADS_DIR），否则回退到数据目录
export const UPLOADS_DIR = process.env.ERP_UPLOADS_DIR
  ? resolve(process.env.ERP_UPLOADS_DIR)
  : join(DATA_DIR, 'uploads');

let db = null;

export function getDb() {
  if (!db) {
    mkdirSync(DATA_DIR, { recursive: true });
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

export function initDb() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      nickname TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'operator',
      status INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS shops (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      platform TEXT NOT NULL DEFAULT '',
      real_name TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      account TEXT NOT NULL DEFAULT '',
      password TEXT NOT NULL DEFAULT '',
      sub_account TEXT NOT NULL DEFAULT '',
      sub_password TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      status INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_no TEXT NOT NULL,
      product_name TEXT NOT NULL DEFAULT '',
      quantity INTEGER NOT NULL DEFAULT 1,
      shop_id INTEGER NOT NULL,
      price REAL NOT NULL DEFAULT 0,
      cost REAL NOT NULL DEFAULT 0,
      tracking_no TEXT NOT NULL DEFAULT '',
      supplier_tracking_no TEXT NOT NULL DEFAULT '',
      comfort_tracking_no TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'unprocessed',
      refund_amount REAL NOT NULL DEFAULT 0,
      refund_note TEXT NOT NULL DEFAULT '',
      handler_id INTEGER NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (shop_id) REFERENCES shops(id),
      FOREIGN KEY (handler_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shop_id INTEGER NOT NULL,
      category TEXT NOT NULL DEFAULT 'other',
      amount REAL NOT NULL DEFAULT 0,
      description TEXT NOT NULL DEFAULT '',
      handler_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (shop_id) REFERENCES shops(id),
      FOREIGN KEY (handler_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS factory_products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL DEFAULT '',
      product_code TEXT NOT NULL DEFAULT '',
      main_image TEXT NOT NULL DEFAULT '',
      factory_id INTEGER NOT NULL DEFAULT 0,
      factory_quote REAL NOT NULL DEFAULT 0,
      effect_images TEXT NOT NULL DEFAULT '[]',
      base_images TEXT NOT NULL DEFAULT '[]',
      note TEXT NOT NULL DEFAULT '',
      status INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS collector_tasks (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      collector_shop_id TEXT NOT NULL DEFAULT '',
      payload TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending',
      result TEXT,
      error TEXT,
      created_by INTEGER,
      claimed_at DATETIME,
      finished_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_collector_tasks_status
      ON collector_tasks(status, created_at);

    CREATE TABLE IF NOT EXISTS factory_product_aliases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      item_id TEXT NOT NULL DEFAULT '',
      sku_id TEXT NOT NULL DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(item_id, sku_id)
    );

    CREATE INDEX IF NOT EXISTS idx_product_aliases_item
      ON factory_product_aliases(item_id, sku_id);

    CREATE TABLE IF NOT EXISTS token_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model TEXT NOT NULL,
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      user_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS order_sync_ignores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_no TEXT NOT NULL,
      shop_id INTEGER NOT NULL DEFAULT 0,
      collector_shop_id TEXT NOT NULL DEFAULT '',
      platform TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL DEFAULT 'deleted_in_erp',
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(order_no, collector_shop_id)
    );

    CREATE INDEX IF NOT EXISTS idx_order_sync_ignores_shop
      ON order_sync_ignores(order_no, shop_id);

    CREATE TABLE IF NOT EXISTS collector_shop_deletions (
      collector_shop_id TEXT PRIMARY KEY,
      platform TEXT NOT NULL DEFAULT '',
      shop_name TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL DEFAULT 'deleted_in_erp',
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS collector_issues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT NOT NULL DEFAULT 'error',
      source TEXT NOT NULL DEFAULT 'collector',
      title TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL DEFAULT '',
      collector_shop_id TEXT NOT NULL DEFAULT '',
      shop_id INTEGER,
      platform TEXT NOT NULL DEFAULT '',
      details TEXT NOT NULL DEFAULT '',
      resolved INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      resolved_at DATETIME
    );

    CREATE INDEX IF NOT EXISTS idx_collector_issues_created
      ON collector_issues(created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_collector_issues_shop
      ON collector_issues(collector_shop_id, resolved);
  `);

  migrateDb(db);

  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
  if (userCount.count === 0) {
    const password = process.env.ERP_DEFAULT_ADMIN_PASSWORD || randomBytes(6).toString('hex');
    const hashedPassword = bcrypt.hashSync(password, 10);
    db.prepare(
      'INSERT INTO users (username, password, nickname, role) VALUES (?, ?, ?, ?)'
    ).run('admin', hashedPassword, '管理员', 'admin');

    console.log('');
    console.log('============================================');
    console.log('  首次启动，已创建管理员账号：');
    console.log(`  用户名: admin`);
    console.log(`  密码: ${password}`);
    console.log('  请登录后立即修改密码！');
    console.log('============================================');
    console.log('');
  }

  console.log('Database initialized successfully');
  return db;
}

function migrateDb(db) {
  const addColumn = (table, column, definition) => {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((item) => item.name);
    if (!columns.includes(column)) {
      db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
    }
  };

  addColumn('shops', 'collector_shop_id', 'TEXT NOT NULL DEFAULT ""');
  addColumn('shops', 'collector_status', 'TEXT NOT NULL DEFAULT "unknown"');
  addColumn('shops', 'last_login_check_at', 'DATETIME');
  addColumn('shops', 'last_collect_at', 'DATETIME');

  addColumn('orders', 'buyer_nick', 'TEXT NOT NULL DEFAULT ""');
  addColumn('orders', 'supplier_tracking_no', 'TEXT NOT NULL DEFAULT ""');
  addColumn('orders', 'comfort_tracking_no', 'TEXT NOT NULL DEFAULT ""');
  addColumn('orders', 'receiver_name', 'TEXT NOT NULL DEFAULT ""');
  addColumn('orders', 'receiver_phone', 'TEXT NOT NULL DEFAULT ""');
  addColumn('orders', 'receiver_address', 'TEXT NOT NULL DEFAULT ""');
  addColumn('orders', 'main_image_url', 'TEXT NOT NULL DEFAULT ""');
  addColumn('orders', 'platform_status', 'TEXT NOT NULL DEFAULT ""');
  addColumn('orders', 'status_description', 'TEXT NOT NULL DEFAULT ""');
  addColumn('orders', 'platform_created_at', 'TEXT NOT NULL DEFAULT ""');
  addColumn('orders', 'ship_deadline_text', 'TEXT NOT NULL DEFAULT ""');
  addColumn('orders', 'ship_deadline_at', 'TEXT NOT NULL DEFAULT ""');
  addColumn('orders', 'collector_shop_id', 'TEXT NOT NULL DEFAULT ""');
  addColumn('orders', 'raw_json', 'TEXT NOT NULL DEFAULT ""');

  // 工厂协作字段
  addColumn('orders', 'factory_id', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('orders', 'factory_status', 'TEXT NOT NULL DEFAULT ""');
  addColumn('orders', 'factory_quote', 'REAL NOT NULL DEFAULT 0');
  addColumn('orders', 'factory_quote_note', 'TEXT NOT NULL DEFAULT ""');
  addColumn('orders', 'factory_reject_reason', 'TEXT NOT NULL DEFAULT ""');
  addColumn('orders', 'factory_tracking_no', 'TEXT NOT NULL DEFAULT ""');
  addColumn('orders', 'factory_spec', 'TEXT NOT NULL DEFAULT ""');
  addColumn('orders', 'factory_quantity', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('orders', 'factory_effect_images', 'TEXT NOT NULL DEFAULT "[]"');
  addColumn('orders', 'factory_base_images', 'TEXT NOT NULL DEFAULT "[]"');
  addColumn('orders', 'factory_pushed_at', 'DATETIME');
  addColumn('orders', 'factory_pushed_by', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('orders', 'factory_updated_at', 'DATETIME');

  // 订单分类与成品关联
  addColumn('orders', 'item_id', 'TEXT NOT NULL DEFAULT ""');
  addColumn('orders', 'sku_id', 'TEXT NOT NULL DEFAULT ""');
  addColumn('orders', 'factory_product_id', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('orders', 'order_category', 'TEXT NOT NULL DEFAULT ""');
  addColumn('orders', 'receiver_raw', 'TEXT NOT NULL DEFAULT ""');
  addColumn('orders', 'factory_size', 'TEXT NOT NULL DEFAULT ""');
  addColumn('orders', 'factory_print', 'TEXT NOT NULL DEFAULT ""');

  backfillItemIds(db);

  // 工厂流程简化：旧的报价/制作中等中间态统一并入"已推送(待发货)"，保留 shipped
  db.prepare(`
    UPDATE orders SET factory_status = 'pushed'
    WHERE factory_status IN ('pending_quote', 'quoted', 'confirmed', 'in_production', 'rejected')
  `).run();

  db.prepare(`
    UPDATE orders
    SET status = 'unprocessed'
    WHERE status IS NULL
      OR status = ''
      OR status IN ('pending', 'shipped', 'refunded', 'cancelled', 'closed')
  `).run();
}

// 存量订单：从 raw_json.Items[0] 回填 item_id / sku_id
function backfillItemIds(db) {
  const rows = db.prepare(`
    SELECT id, raw_json FROM orders
    WHERE COALESCE(item_id, '') = '' AND COALESCE(raw_json, '') <> ''
  `).all();
  if (rows.length === 0) return;

  const upd = db.prepare('UPDATE orders SET item_id = ?, sku_id = ? WHERE id = ?');
  const tx = db.transaction(() => {
    let filled = 0;
    for (const row of rows) {
      try {
        const json = JSON.parse(row.raw_json);
        const item = Array.isArray(json.Items) && json.Items.length > 0 ? json.Items[0] : null;
        if (!item) continue;
        const itemId = String(item.ItemId ?? item.itemId ?? '');
        const skuId = String(item.SkuId ?? item.skuId ?? '');
        if (itemId) {
          upd.run(itemId, skuId, row.id);
          filled += 1;
        }
      } catch {
        // 跳过坏数据
      }
    }
    if (filled > 0) console.log(`Backfilled item_id for ${filled} orders`);
  });
  tx();
}
