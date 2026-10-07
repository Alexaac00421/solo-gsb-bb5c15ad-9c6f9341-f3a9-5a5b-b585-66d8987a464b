import type { Cue } from '@cue-sheet/shared';

interface TimelineProps {
  cues: Cue[];
  /** 被标记为冲突/错误的动作 id 集合 */
  highlightedIds?: Set<string>;
  /** 点击某条动作时回调，用于定位 */
  onSelectCue?: (id: string) => void;
  selectedId?: string | null;
}

/** 计算时间轴总时长与按资源分泳道。 */
function layout(cues: Cue[]) {
  const lanes: { resource: string; cues: Cue[] }[] = [];
  const indexByResource = new Map<string, number>();
  let maxEnd = 0;
  for (const c of cues) {
    let laneIdx = indexByResource.get(c.resource);
    if (laneIdx === undefined) {
      laneIdx = lanes.length;
      indexByResource.set(c.resource, laneIdx);
      lanes.push({ resource: c.resource, cues: [] });
    }
    lanes[laneIdx].cues.push(c);
    if (Number.isFinite(c.start) && Number.isFinite(c.duration)) {
      maxEnd = Math.max(maxEnd, c.start + Math.max(0, c.duration));
    }
  }
  return { lanes, maxEnd };
}

function ticks(maxEnd: number): number[] {
  // 主刻度间隔：让刻度数保持在 8~15 个
  const rough = maxEnd / 10;
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800];
  const step = steps.find((s) => s >= rough) ?? 3600;
  const out: number[] = [];
  for (let t = 0; t <= maxEnd; t += step) out.push(t);
  if (out[out.length - 1] < maxEnd) out.push(Math.ceil(maxEnd / step) * step);
  return out;
}

export function fmtTime(sec: number): string {
  if (!Number.isFinite(sec)) return '—';
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return `${m}:${rest.toFixed(0).padStart(2, '0')}`;
}

export function Timeline({
  cues,
  highlightedIds,
  onSelectCue,
  selectedId,
}: TimelineProps) {
  const valid = cues.filter(
    (c) =>
      Number.isFinite(c.start) &&
      Number.isFinite(c.duration) &&
      c.start >= 0 &&
      c.duration > 0,
  );
  const { lanes, maxEnd } = layout(valid);
  const span = Math.max(maxEnd, 10);
  const scale = ticks(span);
  const spanPadded = scale[scale.length - 1] || span;

  if (cues.length === 0) {
    return <div className="timeline-empty">时间轴为空：还没有动作。</div>;
  }

  return (
    <div className="timeline">
      <div className="timeline-ruler">
        <div className="lane-label" />
        <div className="ruler-track">
          {scale.map((t) => (
            <div
              key={t}
              className="ruler-tick"
              style={{ left: `${(t / spanPadded) * 100}%` }}
            >
              {fmtTime(t)}
            </div>
          ))}
        </div>
      </div>
      {lanes.map((lane) => (
        <div className="timeline-lane" key={lane.resource}>
          <div className="lane-label" title={lane.resource}>
            {lane.resource}
          </div>
          <div className="lane-track">
            {scale.map((t) => (
              <div
                key={t}
                className="lane-grid"
                style={{ left: `${(t / spanPadded) * 100}%` }}
              />
            ))}
            {lane.cues.map((c) => {
              const left = (c.start / spanPadded) * 100;
              const width = Math.max((c.duration / spanPadded) * 100, 0.6);
              const hot = highlightedIds?.has(c.id);
              const selected = selectedId === c.id;
              return (
                <button
                  type="button"
                  key={c.id}
                  className={`cue-bar${hot ? ' hot' : ''}${selected ? ' selected' : ''}`}
                  style={{
                    left: `${left}%`,
                    width: `calc(${width}% - 2px)`,
                  }}
                  title={`${c.id} ${c.name ? '· ' + c.name : ''}
[${c.start}, ${c.start + c.duration}) 秒`}
                  onClick={() => onSelectCue?.(c.id)}
                >
                  <span className="cue-bar-id">{c.id}</span>
                  {c.name && <span className="cue-bar-name">{c.name}</span>}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <p className="timeline-note">区间均为左闭右开 [start, start+duration)，单位：秒</p>
    </div>
  );
}
