import type { Issue } from '@cue-sheet/shared';

interface IssueListProps {
  issues: Issue[];
  onLocate?: (cueId: string) => void;
}

export function IssueList({ issues, onLocate }: IssueListProps) {
  if (issues.length === 0) {
    return (
      <div className="issue-ok">✓ 无冲突，可以发布。</div>
    );
  }
  const errors = issues.filter((i) => i.severity === 'error');
  const conflicts = issues.filter((i) => i.severity === 'conflict');

  const Group = ({ title, list, cls }: { title: string; list: Issue[]; cls: string }) => {
    if (list.length === 0) return null;
    return (
      <section className={`issue-group ${cls}`}>
        <h4>{title}（{list.length}）</h4>
        <ul>
          {list.map((issue, idx) => (
            <li key={`${issue.code}-${idx}`}>
              <span className="issue-msg">{issue.message}</span>
              {issue.cueIds && issue.cueIds.length > 0 && (
                <span className="issue-actions">
                  {issue.cueIds.map((id) => (
                    <button
                      key={id}
                      type="button"
                      className="locate-btn"
                      onClick={() => onLocate?.(id)}
                    >
                      定位 {id}
                    </button>
                  ))}
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>
    );
  };

  return (
    <div className="issue-list">
      <Group title="阻止保存的错误" list={errors} cls="group-error" />
      <Group title="冲突（可保存草稿，但不能发布）" list={conflicts} cls="group-conflict" />
    </div>
  );
}
