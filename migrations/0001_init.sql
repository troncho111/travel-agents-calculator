-- Agents table
CREATE TABLE IF NOT EXISTS agents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Insert 5 agents
INSERT OR IGNORE INTO agents (name) VALUES ('יהודה');
INSERT OR IGNORE INTO agents (name) VALUES ('גבריאל');
INSERT OR IGNORE INTO agents (name) VALUES ('אורי');
INSERT OR IGNORE INTO agents (name) VALUES ('רן');
INSERT OR IGNORE INTO agents (name) VALUES ('ארז');

-- Pricings table
CREATE TABLE IF NOT EXISTS pricings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  currency TEXT NOT NULL,
  items TEXT NOT NULL,
  total_cost REAL NOT NULL,
  markup_percentage REAL NOT NULL,
  final_price REAL NOT NULL,
  installments INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

-- Deals table
CREATE TABLE IF NOT EXISTS deals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id INTEGER NOT NULL,
  sale_amount REAL NOT NULL,
  sale_currency TEXT NOT NULL,
  profit_amount REAL NOT NULL,
  profit_currency TEXT NOT NULL,
  deal_date DATE NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

-- Exchange rates cache
CREATE TABLE IF NOT EXISTS exchange_rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  base_currency TEXT NOT NULL,
  rates TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
