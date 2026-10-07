import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Cue } from '@cue-sheet/shared';
import { api, type SceneSummary } from '../api.js';
import { Timeline, fmtTime } from '../components/Timeline.js';

/** 排练视图：只读最新已发布版本，轮询检测新版本；草稿永远不在这里出现。 */
export function RehearsalPage() {
  const { id } = useParams();
  const sceneId = Number(id);
  const [scene, setScene] = useState<SceneSummary | null>(null);
  const [version, setVersion] = useState<number | null>(null);
  const [publishedAt, setPublishedAt] = useState<number | null>(null);
  const [cues, setCues] = useState<Cue[] | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const versionRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(
    async (showSameVersion: boolean) => {
      try {
        const [pub, scenes] = await Promise.all([
          api.getLatestPublished(sceneId),
          api.listScenes(),
        ]);
        setScene(scenes.scenes.find((s) => s.id === sceneId) ?? null);
        if (pub.published && pub.version !== undefined) {
          setCues(pub.cues ?? []);
          setPublishedAt(pub.publishedAt ?? null);
          const prevVersion = versionRef.current;
          if (prevVersion !== null && pub.version !== prevVersion) {
            setNotice(`检测到新版本 v${pub.version}，已自动切换。`);
          } else if (showSameVersion) {
            setNotice(`已确认最新：v${pub.version}`);
          }
          versionRef.current = pub.version;
          setVersion(pub.version);
        } else {
          versionRef.current = null;
          setCues(null);
          setVersion(null);
        }
        setLoaded(true);
      } catch {
        setNotice('与服务器通信失败，将继续重试。');
      }
    },
    [sceneId],
  );

  useEffect(() => {
    refresh(false);
    timerRef.current = setInterval(() => refresh(false), 5000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneId]);

  return (
    <div className="rehearsal">
      <header className="page-header">
        <div>
          <Link to="/" className="back-link">← 场次列表</Link>
          <h2>{scene?.name ?? '场次加载中…'} · 排练视图</h2>
          <div className="meta">
            {version !== null && (
              <>
                <span className="tag tag-published">只读 · 已发布 v{version}</span>
                <span>发布时间：{publishedAt ? new Date(publishedAt).toLocaleString('zh-CN') : '—'}</span>
              </>
            )}
            <span>每 5 秒自动检查新版本</span>
          </div>
        </div>
        <div className="header-actions">
          <button type="button" className="btn small" onClick={() => refresh(true)}>
            立即刷新
          </button>
          <Link className="btn ghost" to={`/scenes/${sceneId}`}>返回编辑器</Link>
        </div>
      </header>

      {notice && <div className="banner banner-ok">{notice}</div>}

      {!loaded ? (
        <p className="empty-hint">加载中…</p>
      ) : cues === null ? (
        <section className="panel empty-state">
          <div className="empty-state-icon">🎭</div>
          <h3>尚未发布任何版本</h3>
          <p>
            排练视图只显示编导正式发布的、不可变的版本。
            请先在编辑器中完成走台编排、消除全部冲突并点击「发布新版本」。
          </p>
          <Link className="btn primary" to={`/scenes/${sceneId}`}>前往编辑器发布</Link>
        </section>
      ) : (
        <>
          <section className="panel">
            <h3>正式时间轴（v{version}，不可变）</h3>
            <Timeline cues={cues} />
          </section>
          <section className="panel">
            <h3>Cue 单</h3>
            <table className="cue-table readonly">
              <thead>
                <tr>
                  <th>编号</th>
                  <th>动作</th>
                  <th>开始</th>
                  <th>结束</th>
                  <th>设备/岗位</th>
                  <th>前置</th>
                </tr>
              </thead>
              <tbody>
                {[...cues]
                  .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id))
                  .map((c) => (
                    <tr key={c.id}>
                      <td><code>{c.id}</code></td>
                      <td>{c.name || '—'}</td>
                      <td>{fmtTime(c.start)}（{c.start}s）</td>
                      <td>{fmtTime(c.start + c.duration)}（{c.start + c.duration}s）</td>
                      <td>{c.resource}</td>
                      <td>{c.prerequisite ?? '—'}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {cues.length === 0 && <p className="empty-hint">该版本是一个空场次。</p>}
          </section>
        </>
      )}
    </div>
  );
}
