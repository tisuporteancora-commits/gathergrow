-- Contas bancárias e caixas (idempotente)

CREATE TABLE IF NOT EXISTS bank_accounts (
  id SERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  kind VARCHAR(24) NOT NULL DEFAULT 'bank'
    CHECK (kind IN ('cash', 'bank', 'digital')),
  bank_name VARCHAR(120),
  agency VARCHAR(32),
  account_number VARCHAR(64),
  balance NUMERIC(12, 2) NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_accounts_default
  ON bank_accounts ((is_default))
  WHERE is_default = TRUE;

ALTER TABLE financial_entries
  ADD COLUMN IF NOT EXISTS bank_account_id INTEGER REFERENCES bank_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS origin VARCHAR(40);

CREATE INDEX IF NOT EXISTS idx_financial_bank ON financial_entries(bank_account_id);
CREATE INDEX IF NOT EXISTS idx_financial_status_occurred ON financial_entries(status, occurred_at DESC);

INSERT INTO bank_accounts (name, kind, balance, is_default)
SELECT 'Caixa PDV', 'cash', 0, TRUE
WHERE NOT EXISTS (SELECT 1 FROM bank_accounts WHERE is_default = TRUE);

INSERT INTO bank_accounts (name, kind, balance, is_default)
SELECT 'Conta Corrente', 'bank', 0, FALSE
WHERE NOT EXISTS (SELECT 1 FROM bank_accounts WHERE name = 'Conta Corrente');
