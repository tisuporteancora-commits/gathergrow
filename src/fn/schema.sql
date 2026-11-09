CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(64) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name VARCHAR(120) NOT NULL,
  role VARCHAR(32) NOT NULL CHECK (role IN ('super_admin', 'admin', 'supervisor', 'cashier')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(80) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  barcode VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(160) NOT NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  cost_price NUMERIC(12, 2) NOT NULL DEFAULT 0,
  sell_price NUMERIC(12, 2) NOT NULL DEFAULT 0,
  stock_qty NUMERIC(12, 3) NOT NULL DEFAULT 0,
  min_stock NUMERIC(12, 3) NOT NULL DEFAULT 0,
  expires_at DATE,
  image_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  document VARCHAR(32),
  phone VARCHAR(32),
  email VARCHAR(120),
  address TEXT,
  notes TEXT,
  credit_limit NUMERIC(12, 2) NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cash_sessions (
  id SERIAL PRIMARY KEY,
  register_code VARCHAR(32) NOT NULL DEFAULT 'PDV-01',
  operator_id INTEGER NOT NULL REFERENCES users(id),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  opening_cash NUMERIC(12, 2) NOT NULL DEFAULT 0,
  closing_cash_counted NUMERIC(12, 2),
  expected_cash NUMERIC(12, 2),
  cash_variance NUMERIC(12, 2),
  opening_notes TEXT,
  closing_notes TEXT,
  status VARCHAR(16) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'closed')),
  closed_by INTEGER REFERENCES users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_open_session_per_register
  ON cash_sessions (register_code)
  WHERE status = 'open';

CREATE UNIQUE INDEX IF NOT EXISTS uq_open_session_per_operator
  ON cash_sessions (operator_id)
  WHERE status = 'open';

CREATE TABLE IF NOT EXISTS cash_movements (
  id SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES cash_sessions(id) ON DELETE CASCADE,
  type VARCHAR(16) NOT NULL CHECK (type IN ('sangria', 'suprimento')),
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  reason TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  authorized_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sales (
  id SERIAL PRIMARY KEY,
  code VARCHAR(32) NOT NULL UNIQUE,
  operator_id INTEGER NOT NULL REFERENCES users(id),
  session_id INTEGER REFERENCES cash_sessions(id),
  customer_id INTEGER REFERENCES customers(id),
  subtotal NUMERIC(12, 2) NOT NULL,
  discount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  surcharge NUMERIC(12, 2) NOT NULL DEFAULT 0,
  total NUMERIC(12, 2) NOT NULL,
  notes TEXT,
  status VARCHAR(24) NOT NULL DEFAULT 'completed'
    CHECK (status IN ('completed', 'cancelled', 'refunded')),
  cancelled_at TIMESTAMPTZ,
  cancel_reason TEXT,
  cancelled_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sale_items (
  id SERIAL PRIMARY KEY,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty NUMERIC(12, 3) NOT NULL,
  unit_price NUMERIC(12, 2) NOT NULL,
  discount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  line_total NUMERIC(12, 2) NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  method VARCHAR(24) NOT NULL CHECK (method IN ('cash', 'pix', 'credit', 'debit', 'fiado')),
  amount NUMERIC(12, 2) NOT NULL,
  received_amount NUMERIC(12, 2),
  change_amount NUMERIC(12, 2) DEFAULT 0
);

CREATE TABLE IF NOT EXISTS financial_entries (
  id SERIAL PRIMARY KEY,
  type VARCHAR(16) NOT NULL CHECK (type IN ('income', 'expense')),
  description VARCHAR(200) NOT NULL,
  category VARCHAR(80) NOT NULL DEFAULT 'Geral',
  amount NUMERIC(12, 2) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'confirmed'
    CHECK (status IN ('confirmed', 'pending', 'cancelled')),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sale_id INTEGER REFERENCES sales(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS accounts (
  id SERIAL PRIMARY KEY,
  direction VARCHAR(16) NOT NULL CHECK (direction IN ('payable', 'receivable')),
  party_name VARCHAR(160) NOT NULL,
  account_kind VARCHAR(40) NOT NULL DEFAULT 'other'
    CHECK (account_kind IN ('fiado', 'crediario', 'card', 'boleto', 'utility', 'other')),
  document_code VARCHAR(120),
  description TEXT,
  amount NUMERIC(12, 2) NOT NULL,
  due_at DATE NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'overdue', 'paid', 'cancelled')),
  paid_at TIMESTAMPTZ,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  action VARCHAR(64) NOT NULL,
  entity_type VARCHAR(64) NOT NULL,
  entity_id INTEGER,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_financial_occurred_at ON financial_entries(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_accounts_due_at ON accounts(due_at);
CREATE INDEX IF NOT EXISTS idx_accounts_direction_status ON accounts(direction, status);
CREATE INDEX IF NOT EXISTS idx_cash_sessions_status ON cash_sessions(status);
CREATE INDEX IF NOT EXISTS idx_sales_session ON sales(session_id);
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
