import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { validateCues } from '@cue-sheet/shared';
import { api, ApiError, type SceneSummary } from '../api.js';
import {
  cueToDraft,
  draftsToCues,
  emptyCue,
  type CueDraft,
} from '../cueDraft.js';
import { Timeline } from '../components/Timeline.js';
import { IssueList } from '../components/IssueList.js';

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; rev: number; at: number }
  | { kind: 'stale'; serverRev: number }
  | { kind: 'error'; message: string };

export function EditorPage() {
  const { id } = useParams();
  const sceneId = Number(id);

  const [scene, setScene] = useState<SceneSummary | null>(null);
  const [rows, setRows] = useState<CueDraft[]>([]);
  const [savedSnapshot, setSavedSnapshot] = useState<string>('');
  const [rev, setRev] = useState<number | null>(null);
  const [loadedAt, setLoadedAt] = useState<number>(0);
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishMsg, setPublishMsg] = useState<string | null>(null);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const seqRef = useRef(1);

  // 载入草稿（读取修订号）
  const reload = useCallback(
    async (sid: number) => {
      try {
        const [draft, scenes] = await Promise.all([
          api.getDraft(sid),
          api.listScenes(),
        ]);
        setScene(scenes.scenes.find((s) => s.id === sid) ?? null);
        setRows(draft.cues.map(cueToDraft));
        setSavedSnapshot(JSON.stringify(draft.cues));
        setRev(draft.rev);
        setLoadedAt(draft.updatedAt);
        setSaveState({ kind: 'idle' });
        setPublishMsg(null);
        setLoadingError(null);
        seqRef.current = draft.cues.length + 1;
      } catch (e) {
        setLoadingError(e instanceof Error ? e.message : '草稿加载失败');
      }
    },
    [],
  );

  useEffect(() => {
    if (Number.isInteger(sceneId)) reload(sceneId);
  }, [sceneId, reload]);

  // 本地实时校验（与后端共享同一套规则）
  const validation = useMemo(
    () => validateCues(draftsToCues(rows)),
    [rows],
  );
  const hotIds = useMemo(() => {
    const s = new Set<string>();
    for (const issue of validation.issues) {
      issue.cueIds?.forEach((c) => s.add(c));
    }
    return s;
  }, [validation]);

  const updateRow = (idx: number, patch: Partial<CueDraft>) => {
    setRows((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
    );
    setSaveState({ kind: 'idle' });
  };

  const addRow = () => {
    seqRef.current += 1;
    setRows((prev) => [...prev, emptyCue(seqRef.current)]);
  };

  const removeRow = (idx: number) => {
    setRows((prev) => prev.filter((_, i) => i !== idx));
  };

  const duplicateRow = (idx: number) => {
    seqRef.current += 1;
    setRows((prev) => {
      const copy: CueDraft = {
        ...prev[idx],
        id: `C${seqRef.current}`,
        prerequisite: '',
      };
      return [...prev.slice(0, idx + 1), copy, ...prev.slice(idx + 1)];
    });
  };

  const locate = useCallback((cueId: string) => {
    setSelectedId(cueId);
    const el = tableRef.current?.querySelector(
      `[data-cue-id="${CSS.escape(cueId)}"]`,
    );
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    (el as HTMLElement | null)?.focus?.();
  }, []);

  const handleSave = async () => {
    if (rev === null) return;
    setSaveState({ kind: 'saving' });
    setPublishMsg(null);
    try {
      const result = await api.saveDraft(sceneId, rev, draftsToCues(rows));
      setRev(result.rev);
      setLoadedAt(result.updatedAt);
      setSavedSnapshot(JSON.stringify(draftsToCues(rows)));
      setSaveState({ kind: 'saved', rev: result.rev, at: result.updatedAt });
      setScene((s) => (s ? { ...s } : s));
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setSaveState({
          kind: 'stale',
          serverRev: (e.body as any)?.currentRev ?? -1,
        });
      } else if (e instanceof ApiError && e.status === 422) {
        setSaveState({
          kind: 'error',
          message: '存在阻止保存的错误，服务器拒绝写入（见下方错误列表）。',
        });
      } else {
        setSaveState({
          kind: 'error',
          message: e instanceof Error ? e.message : '保存失败',
        });
      }
    }
  };

  const handlePublish = async () => {
    setPublishing(true);
    setPublishMsg(null);
    try {
      const result = await api.publish(sceneId);
      setPublishMsg(`✓ 已发布为不可变版本 v${result.version}`);
      const scenes = await api.listScenes();
      setScene(scenes.scenes.find((s) => s.id === sceneId) ?? null);
    } catch (e) {
      if (e instanceof ApiError) {
        setPublishMsg(`✗ 发布失败：${e.message}`);
      } else {
        setPublishMsg('✗ 发布失败');
      }
    } finally {
      setPublishing(false);
    }
  };

  if (loadingError) {
    return <div className="page-error">加载失败：{loadingError}</div>;
  }

  const dirty = useMemo(
    () => JSON.stringify(draftsToCues(rows)) !== savedSnapshot,
    [rows, savedSnapshot],
  );

  return (
    <div className="editor">
      <header className="page-header">
        <div>
          <Link to="/" className="back-link">← 场次列表</Link>
          <h2>{scene?.name ?? '场次加载中…'}（编导工作台）</h2>
          <div className="meta">
            <span>
              草稿修订号：<code>rev {rev ?? '—'}</code>
            </span>
            <span>最近保存：{loadedAt ? new Date(loadedAt).toLocaleString('zh-CN') : '—'}</span>
            <span>
              最新已发布版本：
              {scene?.latest_version ? (
                <Link to={`/rehearsal/${sceneId}`}>v{scene.latest_version}</Link>
              ) : (
                <em>尚未发布</em>
              )}
            </span>
          </div>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="btn primary"
            onClick={handleSave}
            disabled={rev === null || saveState.kind === 'saving' || validation.blocking}
            title={validation.blocking ? '存在阻止保存的错误' : ''}
          >
            {saveState.kind === 'saving' ? '保存中…' : '保存草稿'}
          </button>
          <button
            type="button"
            className="btn success"
            onClick={handlePublish}
            disabled={publishing || validation.hasIssues}
            title={validation.hasIssues ? '只有无冲突的草稿才能发布' : ''}
          >
            {publishing ? '发布中…' : '发布新版本'}
          </button>
          <Link className="btn ghost" to={`/rehearsal/${sceneId}`}>
            打开排练视图
          </Link>
        </div>
      </header>

      {saveState.kind === 'stale' && (
        <div className="banner banner-warn" role="alert">
          <strong>修订号过期：</strong>
          服务器上的草稿已更新到 rev {saveState.serverRev}，本次提交未覆盖任何内容。
          <button type="button" className="btn small" onClick={() => reload(sceneId)}>
            重新载入服务器草稿
          </button>
        </div>
      )}
      {saveState.kind === 'error' && (
        <div className="banner banner-error" role="alert">{saveState.message}</div>
      )}
      {saveState.kind === 'saved' && (
        <div className="banner banner-ok">
          草稿已保存（rev {saveState.rev}）
          {validation.hasIssues ? '，仍有冲突待解决。' : '，无冲突，可发布。'}
        </div>
      )}
      {publishMsg && (
        <div
          className={`banner ${publishMsg.startsWith('✓') ? 'banner-ok' : 'banner-error'}`}
        >
          {publishMsg}
        </div>
      )}

      <section className="panel">
        <h3>草稿时间轴{dirty && <span className="dirty-dot" title="有未保存修改">●</span>}</h3>
        <Timeline
          cues={draftsToCues(rows)}
          highlightedIds={hotIds}
          selectedId={selectedId}
          onSelectCue={locate}
        />
      </section>

      <section className="panel">
        <div className="panel-title-row">
          <h3>动作明细</h3>
          <button type="button" className="btn small" onClick={addRow}>+ 新增动作</button>
        </div>
        <div className="cue-table-wrap" ref={tableRef}>
          <table className="cue-table">
            <thead>
              <tr>
                <th>编号</th>
                <th>动作名称</th>
                <th>开始(秒)</th>
                <th>持续(秒)</th>
                <th>设备/岗位</th>
                <th>前置动作</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr
                  key={idx}
                  data-cue-id={row.id}
                  className={hotIds.has(row.id) ? 'row-hot' : ''}
                  tabIndex={-1}
                >
                  <td>
                    <input
                      value={row.id}
                      onChange={(e) => updateRow(idx, { id: e.target.value })}
                      className="input-id"
                    />
                  </td>
                  <td>
                    <input
                      value={row.name}
                      placeholder="如：追光收"
                      onChange={(e) => updateRow(idx, { name: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      value={row.start}
                      type="number"
                      onChange={(e) => updateRow(idx, { start: e.target.value })}
                      className={Number(row.start) < 0 ? 'input-bad' : ''}
                    />
                  </td>
                  <td>
                    <input
                      value={row.duration}
                      type="number"
                      onChange={(e) => updateRow(idx, { duration: e.target.value })}
                      className={Number(row.duration) <= 0 ? 'input-bad' : ''}
                    />
                  </td>
                  <td>
                    <input
                      value={row.resource}
                      list="resource-list"
                      placeholder="如：追光1 / 音效台"
                      onChange={(e) => updateRow(idx, { resource: e.target.value })}
                    />
                    <datalist id="resource-list">
                      {[...new Set(rows.map((r) => r.resource).filter(Boolean))].map(
                        (r) => (
                          <option key={r} value={r} />
                        ),
                      )}
                    </datalist>
                  </td>
                  <td>
                    <select
                      value={row.prerequisite}
                      onChange={(e) => updateRow(idx, { prerequisite: e.target.value })}
                    >
                      <option value="">（无）</option>
                      {rows
                        .filter((r, i) => i !== idx && r.id.trim())
                        .map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.id}
                          </option>
                        ))}
                    </select>
                  </td>
                  <td className="row-actions">
                    <button type="button" className="btn tiny" onClick={() => duplicateRow(idx)}>
                      复制
                    </button>
                    <button type="button" className="btn tiny danger" onClick={() => removeRow(idx)}>
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <p className="empty-hint">还没有动作，点击「新增动作」开始走台编排。</p>}
        </div>
      </section>

      <section className="panel">
        <h3>校验结果（按场次独立计算）</h3>
        <IssueList issues={validation.issues} onLocate={locate} />
        <ul className="rules-note">
          <li>时间区间左闭右开：[开始, 开始+持续)；同一设备/岗位不得重叠，首尾相接允许。</li>
          <li>前置动作必须先结束，本动作才能开始。</li>
          <li>负开始时刻、非正时长、缺失引用、环形依赖会阻止保存。</li>
        </ul>
      </section>
    </div>
  );
}
