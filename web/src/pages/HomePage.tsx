import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type SceneSummary } from '../api.js';

export function HomePage() {
  const [scenes, setScenes] = useState<SceneSummary[]>([]);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const res = await api.listScenes();
    setScenes(res.scenes);
  };

  useEffect(() => {
    load();
  }, []);

  const create = async () => {
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const { scene } = await api.createScene(name.trim());
      setName('');
      window.location.href = `/scenes/${scene.id}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建失败');
      setCreating(false);
    }
  };

  return (
    <div className="home">
      <header className="page-header">
        <div>
          <h1>走台提示计划</h1>
          <p className="subtitle">按场次编排设备/岗位提示动作，校验冲突，发布给排练现场使用。</p>
        </div>
      </header>

      <section className="panel">
        <h3>新建场次</h3>
        <div className="create-row">
          <input
            value={name}
            placeholder="场次名称，如：第三幕 · 雨夜重逢"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()}
          />
          <button type="button" className="btn primary" onClick={create} disabled={creating || !name.trim()}>
            {creating ? '创建中…' : '创建并进入编辑器'}
          </button>
        </div>
        {error && <div className="banner banner-error">{error}</div>}
      </section>

      <section className="panel">
        <h3>场次列表</h3>
        {scenes.length === 0 ? (
          <p className="empty-hint">暂无场次。</p>
        ) : (
          <table className="scene-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>名称</th>
                <th>最新已发布版本</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {scenes.map((s) => (
                <tr key={s.id}>
                  <td>{s.id}</td>
                  <td>{s.name}</td>
                  <td>
                    {s.latest_version ? (
                      <span className="tag tag-published">v{s.latest_version}</span>
                    ) : (
                      <span className="tag tag-draft">未发布</span>
                    )}
                  </td>
                  <td className="row-actions">
                    <Link className="btn small" to={`/scenes/${s.id}`}>编导编辑</Link>
                    <Link className="btn small ghost" to={`/rehearsal/${s.id}`}>排练视图</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
