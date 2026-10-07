import express, { type Request, type Response, type NextFunction } from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { validateCues, type Cue, type Issue } from '@cue-sheet/shared';
import {
  createScene,
  getDb,
  getScene,
  listScenes,
} from './db.js';

export function createApp(staticDir?: string): express.Express {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  // ---------- 场次 ----------
  app.get('/api/scenes', (_req, res) => {
    res.json({ scenes: listScenes() });
  });

  app.post('/api/scenes', (req, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name) {
      res.status(400).json({ error: '场次名称不能为空' });
      return;
    }
    res.status(201).json({ scene: createScene(name) });
  });

  function loadSceneOr404(res: Response, sceneId: number) {
    const scene = getScene(sceneId);
    if (!scene) {
      res.status(404).json({ error: '场次不存在' });
      return undefined;
    }
    return scene;
  }

  // ---------- 草稿读取（带修订号） ----------
  app.get('/api/scenes/:id/draft', (req, res) => {
    const sceneId = Number(req.params.id);
    if (!loadSceneOr404(res, sceneId)) return;

    const row = getDb()
      .prepare('SELECT cues_json, rev, updated_at FROM drafts WHERE scene_id = ?')
      .get(sceneId) as { cues_json: string; rev: number; updated_at: number };

    const validation = validateCues(JSON.parse(row.cues_json));
    res.json({
      rev: row.rev,
      cues: JSON.parse(row.cues_json),
      updatedAt: row.updated_at,
      validation,
    });
  });

  // ---------- 草稿保存（乐观锁 + 独立校验） ----------
  app.put('/api/scenes/:id/draft', (req, res) => {
    const sceneId = Number(req.params.id);
    if (!loadSceneOr404(res, sceneId)) return;

    const baseRev = Number(req.body?.baseRev);
    if (!Number.isInteger(baseRev) || baseRev < 0) {
      res.status(400).json({ error: '缺少有效的草稿修订号 baseRev' });
      return;
    }
    if (!Array.isArray(req.body?.cues)) {
      res.status(400).json({ error: 'cues 必须是动作数组' });
      return;
    }

    const cues = sanitizeCues(req.body.cues);
    const validation = validateCues(cues);

    // 结构性错误：阻止保存，草稿保持原样
    if (validation.blocking) {
      res.status(422).json({
        error: '校验未通过，草稿未保存',
        reason: 'blocking',
        validation,
      });
      return;
    }

    const current = getDb()
      .prepare('SELECT rev FROM drafts WHERE scene_id = ?')
      .get(sceneId) as { rev: number };

    // 过期提交：返回冲突，绝不覆盖较新草稿
    if (baseRev !== current.rev) {
      res.status(409).json({
        error: '草稿已被其他人修改（修订号过期），请刷新后重试',
        reason: 'stale',
        currentRev: current.rev,
      });
      return;
    }

    getDb()
      .prepare(
        `UPDATE drafts
            SET cues_json = ?, rev = rev + 1, updated_at = ?
          WHERE scene_id = ? AND rev = ?`,
      )
      .run(JSON.stringify(cues), Date.now(), sceneId, baseRev);

    const saved = getDb()
      .prepare('SELECT rev, updated_at FROM drafts WHERE scene_id = ?')
      .get(sceneId) as { rev: number; updated_at: number };

    res.json({
      ok: true,
      rev: saved.rev,
      updatedAt: saved.updated_at,
      validation,
    });
  });

  // ---------- 仅校验（不落库，编辑器实时检查可用） ----------
  app.post('/api/scenes/:id/validate', (req, res) => {
    const sceneId = Number(req.params.id);
    if (!loadSceneOr404(res, sceneId)) return;
    if (!Array.isArray(req.body?.cues)) {
      res.status(400).json({ error: 'cues 必须是动作数组' });
      return;
    }
    const cues = sanitizeCues(req.body.cues);
    res.json({ validation: validateCues(cues) });
  });

  // ---------- 发布：仅无冲突草稿可成为不可变版本 ----------
  app.post('/api/scenes/:id/publish', (req, res) => {
    const sceneId = Number(req.params.id);
    const scene = loadSceneOr404(res, sceneId);
    if (!scene) return;

    const result = getDb().transaction(() => {
      const draft = getDb()
        .prepare('SELECT cues_json, rev FROM drafts WHERE scene_id = ?')
        .get(sceneId) as { cues_json: string; rev: number };

      const cues = JSON.parse(draft.cues_json) as Cue[];
      const validation = validateCues(cues);

      if (validation.blocking || !validation.publishable) {
        return { ok: false as const, validation };
      }

      const nextVersion =
        (scene.latest_version ?? 0) + 1;
      getDb()
        .prepare(
          `INSERT INTO published_versions (scene_id, version, cues_json, published_at)
           VALUES (?, ?, ?, ?)`,
        )
        .run(sceneId, nextVersion, draft.cues_json, Date.now());

      return {
        ok: true as const,
        version: nextVersion,
        rev: draft.rev,
        validation,
      };
    })();

    if (!result.ok) {
      // 发布失败：不写入任何新版本，排练视图不受影响
      res.status(422).json({
        error:
          result.validation.blocking
            ? '草稿存在阻止保存的错误，无法发布'
            : '草稿仍有冲突，只有无冲突的草稿才能发布',
        reason: result.validation.blocking ? 'blocking' : 'conflicts',
        validation: result.validation,
      });
      return;
    }

    res.status(201).json({
      ok: true,
      version: result.version,
      rev: result.rev,
      validation: result.validation,
    });
  });

  // ---------- 已发布版本（排练视图只读取这里） ----------
  app.get('/api/scenes/:id/published/latest', (req, res) => {
    const sceneId = Number(req.params.id);
    if (!loadSceneOr404(res, sceneId)) return;

    const row = getDb()
      .prepare(
        `SELECT version, cues_json, published_at
           FROM published_versions
          WHERE scene_id = ?
          ORDER BY version DESC LIMIT 1`,
      )
      .get(sceneId) as
      | { version: number; cues_json: string; published_at: number }
      | undefined;

    if (!row) {
      res.json({ published: false });
      return;
    }
    res.json({
      published: true,
      version: row.version,
      publishedAt: row.published_at,
      cues: JSON.parse(row.cues_json),
    });
  });

  app.get('/api/scenes/:id/published', (req, res) => {
    const sceneId = Number(req.params.id);
    if (!loadSceneOr404(res, sceneId)) return;
    const rows = getDb()
      .prepare(
        `SELECT version, published_at,
                json_array_length(cues_json) AS cue_count
           FROM published_versions WHERE scene_id = ? ORDER BY version DESC`,
      )
      .all(sceneId);
    res.json({ versions: rows });
  });

  // ---------- 错误处理 ----------
  app.use(
    (
      err: unknown,
      _req: Request,
      res: Response,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _next: NextFunction,
    ) => {
      // JSON 解析失败等
      if (err instanceof SyntaxError) {
        res.status(400).json({ error: '请求体不是合法 JSON' });
        return;
      }
      console.error(err);
      res.status(500).json({ error: '服务器内部错误' });
    },
  );

  // ---------- 前端静态资源 ----------
  if (staticDir && existsSync(staticDir)) {
    app.use(express.static(staticDir));
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.sendFile(path.join(staticDir, 'index.html'));
    });
  }

  return app;
}

/** 入库前规整：保留白名单字段、统一数值与空白处理。 */
function sanitizeCues(rawCues: unknown[]): Cue[] {
  const out: Cue[] = [];
  for (const raw of rawCues) {
    if (typeof raw !== 'object' || raw === null) continue;
    const c = raw as Record<string, unknown>;
    const prereq =
      c.prerequisite === undefined || c.prerequisite === null
        ? null
        : String(c.prerequisite).trim();
    out.push({
      id: String(c.id ?? '').trim(),
      name: typeof c.name === 'string' ? c.name.trim() : '',
      start: Number(c.start),
      duration: Number(c.duration),
      resource: String(c.resource ?? '').trim(),
      prerequisite: prereq === '' ? null : prereq,
    });
  }
  return out;
}

export type { Issue };
