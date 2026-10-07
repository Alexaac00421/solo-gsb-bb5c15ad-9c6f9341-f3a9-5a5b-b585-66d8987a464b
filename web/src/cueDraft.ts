import type { Cue } from '@cue-sheet/shared';

/** 编辑器内部表单行：数值字段用字符串承载，允许输入过程中为空/负号 */
export interface CueDraft {
  id: string;
  name: string;
  start: string;
  duration: string;
  resource: string;
  prerequisite: string; // '' 表示无前置
}

export function cueToDraft(c: Cue): CueDraft {
  return {
    id: c.id,
    name: c.name ?? '',
    start: String(c.start),
    duration: String(c.duration),
    resource: c.resource,
    prerequisite: c.prerequisite ?? '',
  };
}

/** 尽力把表单行转为领域 Cue；无法解析的数值交给共享校验器报错。 */
export function draftToCue(d: CueDraft): Cue {
  return {
    id: d.id.trim(),
    name: d.name.trim(),
    start: Number(d.start),
    duration: Number(d.duration),
    resource: d.resource.trim(),
    prerequisite: d.prerequisite.trim() ? d.prerequisite.trim() : null,
  };
}

export function draftsToCues(list: CueDraft[]): Cue[] {
  return list.map(draftToCue);
}

export function emptyCue(seq: number): CueDraft {
  return {
    id: `C${seq}`,
    name: '',
    start: '0',
    duration: '5',
    resource: '',
    prerequisite: '',
  };
}
