import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Database as DB } from 'better-sqlite3';

export interface SceneRow {
  id: number;
  name: string;
  created_at: number;
  latest_version: number | null;
}

let db: DB;

export function openDatabase(path: string): DB {
  if (path !== ':memory:') {
    const dir = dirname(path);
    if (dir && dir !== '.') mkdirSync(dir, { recursive: true });
  }
  db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

export function getDb(): DB {
  if (!db) throw new Error('数据库尚未初始化');
  return db;
}

function migrate(database: DB): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS scenes (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    -- 每场至多一份草稿；rev 为乐观锁修订号，每次保存 +1
    CREATE TABLE IF NOT EXISTS drafts (
      scene_id   INTEGER PRIMARY KEY,
      cues_json  TEXT NOT NULL DEFAULT '[]',
      rev        INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (scene_id) REFERENCES scenes(id) ON DELETE CASCADE
    );

    -- 已发布版本只增不改；触发器强制不可变
    CREATE TABLE IF NOT EXISTS published_versions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      scene_id   INTEGER NOT NULL,
      version    INTEGER NOT NULL,
      cues_json  TEXT NOT NULL,
      published_at INTEGER NOT NULL,
      UNIQUE (scene_id, version),
      FOREIGN KEY (scene_id) REFERENCES scenes(id) ON DELETE CASCADE
    );

    CREATE TRIGGER IF NOT EXISTS trg_published_immutable_update
    BEFORE UPDATE ON published_versions
    BEGIN
      SELECT RAISE(ABORT, '已发布版本不可修改');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_published_immutable_delete
    BEFORE DELETE ON published_versions
    BEGIN
      SELECT RAISE(ABORT, '已发布版本不可删除');
    END;
  `);
}

/** 创建场次并同时建立 rev=0 的空草稿。 */
export function createScene(name: string): SceneRow {
  const now = Date.now();
  const tx = getDb().transaction(() => {
    const info = getDb()
      .prepare('INSERT INTO scenes (name, created_at) VALUES (?, ?)')
      .run(name, now);
    const sceneId = Number(info.lastInsertRowid);
    getDb()
      .prepare(
        `INSERT INTO drafts (scene_id, cues_json, rev, updated_at)
         VALUES (?, '[]', 0, ?)`,
      )
      .run(sceneId, now);
    return sceneId;
  });
  const id = tx();
  return getScene(id)!;
}

export function getScene(id: number): SceneRow | undefined {
  return getDb()
    .prepare(
      `SELECT s.id, s.name, s.created_at,
              (SELECT MAX(version) FROM published_versions pv WHERE pv.scene_id = s.id) AS latest_version
       FROM scenes s WHERE s.id = ?`,
    )
    .get(id) as SceneRow | undefined;
}

export function listScenes(): SceneRow[] {
  return getDb()
    .prepare(
      `SELECT s.id, s.name, s.created_at,
              (SELECT MAX(version) FROM published_versions pv WHERE pv.scene_id = s.id) AS latest_version
       FROM scenes s ORDER BY s.id ASC`,
    )
    .all() as SceneRow[];
}
