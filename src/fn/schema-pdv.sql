-- Extensões PDV (idempotente)

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('super_admin', 'admin', 'supervisor', 'cashier'));

CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  document VARCHAR(32),
  phone VARCHAR(32),
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

ALTER TABLE sales ADD COLUMN IF NOT EXISTS session_id INTEGER REFERENCES cash_sessions(id);
ALTER TABLE sales ADD COLUMN IF NOT EXISTS customer_id INTEGER REFERENCES customers(id);
ALTER TABLE sales ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS cancel_reason TEXT;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS cancelled_by INTEGER REFERENCES users(id);

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_method_check;
ALTER TABLE payments ADD CONSTRAINT payments_method_check
  CHECK (method IN ('cash', 'pix', 'credit', 'debit', 'fiado'));

CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  action VARCHAR(64) NOT NULL,
  entity_type VARCHAR(64) NOT NULL,
  entity_id INTEGER,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cash_sessions_status ON cash_sessions(status);
CREATE INDEX IF NOT EXISTS idx_cash_movements_session ON cash_movements(session_id);
CREATE INDEX IF NOT EXISTS idx_sales_session ON sales(session_id);
CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer_id);
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
