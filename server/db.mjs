import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
create table if not exists invites(
  code text primary key,
  created_at integer not null,
  note text,
  issued_by integer,
  user_id integer,
  redeemed_at integer
);
create table if not exists users(
  id integer primary key autoincrement,
  created_at integer not null,
  invite_code text,
  wishes_total integer not null default 3
);
create table if not exists sessions(
  token_hash text primary key,
  user_id integer not null,
  created_at integer not null,
  last_seen integer
);
create index if not exists sessions_user on sessions(user_id);
create table if not exists checks(
  id text primary key,
  user_id integer not null,
  text text not null,
  verdict text not null,
  question_json text,
  created_at integer not null,
  used integer not null default 0
);
create table if not exists wishes(
  id text primary key,
  user_id integer not null,
  text text,
  question_json text not null,
  kind text not null,
  status text not null,
  forecast_id text,
  launch_attempts integer not null default 0,
  retries integer not null default 0,
  result_json text,
  share_token text unique,
  created_at integer not null,
  sealed_at integer,
  done_at integer,
  revealed_at integer,
  refunded integer not null default 0,
  error text,
  notified integer not null default 0
);
create index if not exists wishes_user on wishes(user_id);
create index if not exists wishes_status on wishes(status);
create table if not exists pushes(
  endpoint text primary key,
  user_id integer not null,
  sub_json text not null,
  created_at integer not null
);
`;

export function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('pragma journal_mode = wal; pragma foreign_keys = on; pragma busy_timeout = 5000;');
  db.exec(SCHEMA);
  try {
    db.exec('alter table wishes add column retries integer not null default 0');
  } catch {
    /* already there */
  }
  return db;
}

/** Runs fn inside BEGIN IMMEDIATE; commits, or rolls back and rethrows. fn must be synchronous. */
export function tx(db, fn) {
  db.exec('begin immediate');
  try {
    const out = fn();
    db.exec('commit');
    return out;
  } catch (err) {
    try {
      db.exec('rollback');
    } catch {
      /* already rolled back */
    }
    throw err;
  }
}
