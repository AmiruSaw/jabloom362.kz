create table stores (
  id bigserial primary key,
  store_id text unique not null,
  store_name text not null,
  owner text not null,
  city text not null,
  plan text not null default 'Trial',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table users (
  id bigserial primary key,
  store_id bigint not null references stores(id),
  login text unique not null,
  password_hash text not null,
  name text not null,
  role text not null check (role in ('owner', 'manager', 'florist', 'courier', 'operator')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table sessions (
  token text primary key,
  user_id bigint not null references users(id) on delete cascade,
  csrf_token text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table store_settings (
  id bigserial primary key,
  store_id bigint not null references stores(id) unique,
  currency text not null default 'в‚ё',
  bonus_base_percent numeric(5, 2) not null default 5,
  bonus_vip_percent numeric(5, 2) not null default 10,
  low_stock_alert boolean not null default true,
  birthday_reminder_days integer not null default 7,
  sleepy_client_days integer not null default 30,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table clients (
  id bigserial primary key,
  store_id bigint not null references stores(id),
  name text not null,
  phone text not null,
  instagram text,
  address text,
  recipient text,
  relation text,
  flowers text,
  colors text,
  event_date date,
  budget numeric(12, 2) not null default 0,
  bonus numeric(12, 2) not null default 0,
  orders_count integer not null default 0,
  last_order_date date,
  channel text,
  status text,
  rating text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table cash_shifts (
  id bigserial primary key,
  store_id bigint not null references stores(id),
  opened_at timestamptz not null default now(),
  opened_by bigint references users(id),
  opening_cash numeric(12, 2) not null default 0,
  closed_at timestamptz,
  closed_by bigint references users(id),
  closing_cash numeric(12, 2) not null default 0,
  auto_opened boolean not null default false,
  created_at timestamptz not null default now()
);

create table orders (
  id bigserial primary key,
  store_id bigint not null references stores(id),
  client_id bigint references clients(id),
  cash_shift_id bigint references cash_shifts(id),
  order_date date not null,
  sum numeric(12, 2) not null default 0,
  reason text,
  bouquet text,
  photo_url text,
  channel text,
  status text not null default 'new',
  delivery_date date,
  delivery_time time,
  manager text,
  comment text,
  bonus numeric(12, 2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table leads (
  id bigserial primary key,
  store_id bigint not null references stores(id),
  name text not null,
  phone text,
  source text,
  need text,
  budget numeric(12, 2) not null default 0,
  status text not null check (status in ('new', 'wrote', 'negotiation', 'order', 'lost')),
  next_action text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table inventory_items (
  id bigserial primary key,
  store_id bigint not null references stores(id),
  name text not null,
  category text,
  qty numeric(12, 2) not null default 0,
  unit text not null default 'С€С‚',
  cost numeric(12, 2) not null default 0,
  min_qty numeric(12, 2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table inventory_moves (
  id bigserial primary key,
  store_id bigint not null references stores(id),
  item_id bigint references inventory_items(id),
  order_id bigint references orders(id),
  type text not null check (type in ('receipt', 'writeoff')),
  qty numeric(12, 2) not null,
  reason text,
  user_name text,
  created_at timestamptz not null default now()
);

create table order_items (
  id bigserial primary key,
  store_id bigint not null references stores(id),
  order_id bigint not null references orders(id) on delete cascade,
  inventory_item_id bigint not null references inventory_items(id),
  item_name text not null,
  qty numeric(12, 2) not null,
  unit text not null default 'С€С‚',
  cost numeric(12, 2) not null default 0,
  created_at timestamptz not null default now()
);

create table finance_entries (
  id bigserial primary key,
  store_id bigint not null references stores(id),
  entry_date date not null,
  type text not null check (type in ('revenue', 'expense')),
  category text not null,
  amount numeric(12, 2) not null,
  comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table return_tasks (
  id bigserial primary key,
  store_id bigint not null references stores(id),
  client_id bigint references clients(id),
  status text not null check (status in ('todo', 'contacted', 'returned')),
  suggested_message text,
  expected_revenue numeric(12, 2) not null default 0,
  earned numeric(12, 2) not null default 0,
  contacted_at timestamptz,
  returned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table audit_log (
  id bigserial primary key,
  store_id bigint references stores(id),
  user_id bigint references users(id),
  action text not null,
  entity text not null,
  entity_id text,
  label text,
  payload jsonb,
  created_at timestamptz not null default now()
);

create index idx_clients_store_active on clients(store_id) where deleted_at is null;
create index idx_sessions_user_expires on sessions(user_id, expires_at desc);
create index idx_cash_shifts_store_open on cash_shifts(store_id, opened_at desc);
create index idx_orders_store_active on orders(store_id) where deleted_at is null;
create index idx_orders_cash_shift on orders(cash_shift_id);
create index idx_orders_client on orders(client_id);
create index idx_order_items_order on order_items(order_id);
create index idx_inventory_moves_item_created on inventory_moves(item_id, created_at desc);
create index idx_leads_store_status on leads(store_id, status) where deleted_at is null;
create index idx_audit_store_created on audit_log(store_id, created_at desc);

