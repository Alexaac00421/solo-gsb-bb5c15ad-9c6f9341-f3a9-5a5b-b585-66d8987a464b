import type { Cue, Issue, ValidationResult } from './types.js';

/** 判定一个值是否为有限数（拒绝 NaN / Infinity / 字符串数字以外的类型）。 */
function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * 半开区间 [aStart, aEnd) 与 [bStart, bEnd) 是否重叠。
 * 首尾相接（aEnd === bStart）不算重叠。
 */
export function overlaps(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * 在依赖图中找出所有简单环节点（每个环归一化到“最小 id 开头”后去重）。
 * 前置关系：cue -> prerequisite。
 */
function findCycles(ids: string[], prereqOf: Map<string, string>): string[][] {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>(ids.map((id) => [id, WHITE]));
  const cycles = new Map<string, string[]>();

  const normalize = (cyc: string[]): string => {
    // 以最小 id 为起点旋转，再按字典序作为去重键
    const minIdx = cyc.reduce(
      (acc, id, i) => (id < cyc[acc] ? i : acc),
      0,
    );
    const rotated = [...cyc.slice(minIdx), ...cyc.slice(0, minIdx)];
    return rotated.join(' -> ') + ` -> ${rotated[0]}`;
  };

  const dfs = (start: string) => {
    // 迭代 DFS；每个节点至多一条出边（单一前置），用边游标区分“进入”与“收尾”
    color.set(start, GRAY);
    const stack: string[] = [start];
    const edgeDone = new Map<string, boolean>([[start, false]]);

    while (stack.length > 0) {
      const id = stack[stack.length - 1];
      const next = prereqOf.get(id);

      if (!edgeDone.get(id) && next !== undefined) {
        edgeDone.set(id, true);
        const nextColor = color.get(next);
        if (nextColor === GRAY) {
          // 回边：在当前路径上找到环
          const idx = stack.indexOf(next);
          if (idx >= 0) {
            const cyc = stack.slice(idx);
            cycles.set(normalize(cyc), cyc);
          }
        } else if (nextColor === WHITE) {
          color.set(next, GRAY);
          edgeDone.set(next, false);
          stack.push(next);
        }
        // BLACK：指向已完成节点，无环
      } else {
        // 出边已处理（或没有出边）：收尾
        color.set(id, BLACK);
        stack.pop();
        edgeDone.delete(id);
      }
    }
  };

  for (const id of ids) {
    if (color.get(id) === WHITE) dfs(id);
  }
  return [...cycles.values()];
}

/**
 * 校验一个场次的全部动作。
 *
 * 规则：
 * - 结构性错误（severity=error，阻止保存）：
 *   条目格式错误、缺失/重复 id、负开始时刻、非正时长、缺失资源、
 *   前置引用缺失、前置依赖成环。
 * - 冲突（severity=conflict，可存草稿但阻止发布）：
 *   同一资源的左闭右开区间重叠；前置动作未结束本动作即开始。
 */
export function validateCues(input: unknown): ValidationResult {
  const issues: Issue[] = [];

  if (!Array.isArray(input)) {
    return {
      blocking: true,
      hasIssues: true,
      publishable: false,
      issues: [
        {
          code: 'MALFORMED_CUE',
          severity: 'error',
          message: '动作列表格式错误：应为数组。',
        },
      ],
    };
  }

  // ---- 第一遍：逐条结构性检查 ----
  const seen = new Set<string>();
  const valid: Cue[] = [];

  input.forEach((raw, index) => {
    const at = `第 ${index + 1} 条`;
    if (typeof raw !== 'object' || raw === null) {
      issues.push({
        code: 'MALFORMED_CUE',
        severity: 'error',
        message: `${at}动作格式错误：应为对象。`,
      });
      return;
    }
    const c = raw as Record<string, unknown>;

    const id = typeof c.id === 'string' ? c.id.trim() : '';
    if (!id) {
      issues.push({
        code: 'MISSING_ID',
        severity: 'error',
        message: `${at}动作缺少唯一编号（id）。`,
      });
      return;
    }
    if (seen.has(id)) {
      issues.push({
        code: 'DUPLICATE_ID',
        severity: 'error',
        message: `动作编号 "${id}" 重复，每个动作编号在场次内必须唯一。`,
        cueIds: [id],
      });
      return;
    }
    seen.add(id);

    let bad = false;
    if (!isFiniteNumber(c.start)) {
      issues.push({
        code: 'MALFORMED_CUE',
        severity: 'error',
        message: `动作 "${id}" 的开始秒数不是有效数字。`,
        cueIds: [id],
      });
      bad = true;
    } else if (c.start < 0) {
      issues.push({
        code: 'NEGATIVE_START',
        severity: 'error',
        message: `动作 "${id}" 的开始时刻为 ${c.start} 秒，不能为负数。`,
        cueIds: [id],
      });
      bad = true;
    }

    if (!isFiniteNumber(c.duration)) {
      issues.push({
        code: 'MALFORMED_CUE',
        severity: 'error',
        message: `动作 "${id}" 的持续秒数不是有效数字。`,
        cueIds: [id],
      });
      bad = true;
    } else if (c.duration <= 0) {
      issues.push({
        code: 'NON_POSITIVE_DURATION',
        severity: 'error',
        message: `动作 "${id}" 的持续时长为 ${c.duration} 秒，必须为正数。`,
        cueIds: [id],
      });
      bad = true;
    }

    const resource =
      typeof c.resource === 'string' ? c.resource.trim() : '';
    if (!resource) {
      issues.push({
        code: 'MISSING_RESOURCE',
        severity: 'error',
        message: `动作 "${id}" 未填写占用的设备或岗位。`,
        cueIds: [id],
      });
      bad = true;
    }

    if (bad) {
      // 结构有问题的条目不参与后续引用 / 冲突计算
      return;
    }

    const prereqRaw =
      c.prerequisite === undefined || c.prerequisite === null
        ? null
        : typeof c.prerequisite === 'string'
          ? c.prerequisite.trim()
          : null;

    valid.push({
      id,
      name: typeof c.name === 'string' ? c.name.trim() : '',
      start: c.start as number,
      duration: c.duration as number,
      resource,
      prerequisite: prereqRaw === '' ? null : prereqRaw,
    });
  });

  // ---- 第二遍：前置引用完整性 ----
  const byId = new Map(valid.map((c) => [c.id, c]));
  const prereqOf = new Map<string, string>();
  for (const c of valid) {
    if (c.prerequisite) {
      if (!byId.has(c.prerequisite)) {
        issues.push({
          code: 'PREREQ_MISSING',
          severity: 'error',
          message: `动作 "${c.id}" 的前置动作 "${c.prerequisite}" 不存在（引用缺失）。`,
          cueIds: [c.id],
        });
      } else if (c.prerequisite === c.id) {
        issues.push({
          code: 'PREREQ_CYCLE',
          severity: 'error',
          message: `动作 "${c.id}" 不能把自身设为前置动作（环形依赖）。`,
          cueIds: [c.id],
        });
      } else {
        prereqOf.set(c.id, c.prerequisite);
      }
    }
  }

  // ---- 第三遍：环形依赖 ----
  const cycles = findCycles(
    valid.map((c) => c.id),
    prereqOf,
  );
  for (const cyc of cycles) {
    issues.push({
      code: 'PREREQ_CYCLE',
      severity: 'error',
      message: `前置动作存在环形依赖：${[...cyc, cyc[0]].join(' → ')}。`,
      cueIds: cyc,
    });
  }

  const blocking = issues.some((i) => i.severity === 'error');

  // 存在结构性错误时，冲突报告不再可靠，直接返回。
  if (blocking) {
    return { blocking, hasIssues: true, publishable: false, issues };
  }

  // ---- 第四遍：同资源区间重叠（左闭右开） ----
  const byResource = new Map<string, Cue[]>();
  for (const c of valid) {
    const list = byResource.get(c.resource) ?? [];
    list.push(c);
    byResource.set(c.resource, list);
  }
  for (const [resource, list] of byResource) {
    const sorted = [...list].sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const a = sorted[i];
        const b = sorted[j];
        if (b.start >= a.start + a.duration) break; // 排序后后面的更不可能重叠
        if (overlaps(a.start, a.start + a.duration, b.start, b.start + b.duration)) {
          issues.push({
            code: 'RESOURCE_OVERLAP',
            severity: 'conflict',
            resource,
            cueIds: [a.id, b.id],
            message:
              `资源「${resource}」冲突：动作 "${a.id}" ` +
              `[${a.start}, ${a.start + a.duration}) 与 "${b.id}" ` +
              `[${b.start}, ${b.start + b.duration}) 时间重叠。`,
          });
        }
      }
    }
  }

  // ---- 第五遍：前置动作时序 ----
  for (const c of valid) {
    if (!c.prerequisite) continue;
    const pre = byId.get(c.prerequisite);
    if (!pre) continue;
    if (c.start < pre.start + pre.duration) {
      issues.push({
        code: 'PREREQ_ORDER',
        severity: 'conflict',
        cueIds: [pre.id, c.id],
        message:
          `动作 "${c.id}" 于 ${c.start} 秒开始，但其前置动作 "${pre.id}" ` +
          `要到 ${pre.start + pre.duration} 秒才结束（前置须先结束）。`,
      });
    }
  }

  const hasIssues = issues.length > 0;
  return {
    blocking: false,
    hasIssues,
    publishable: !hasIssues,
    issues,
  };
}
