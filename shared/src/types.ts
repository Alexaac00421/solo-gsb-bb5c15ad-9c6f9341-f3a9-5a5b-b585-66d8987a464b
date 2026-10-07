/**
 * 走台提示动作（单条 Cue）。
 * 时间均以“秒”为单位；占用区间 [start, start+duration) 为左闭右开。
 */
export interface Cue {
  /** 本场次内唯一标识 */
  id: string;
  /** 动作名称 / 说明 */
  name?: string;
  /** 开始秒数（不得为负） */
  start: number;
  /** 持续秒数（必须为正） */
  duration: number;
  /** 占用的一项设备或岗位（同一资源的时间区间不得重叠） */
  resource: string;
  /** 前置动作 id：前置动作须结束后本动作才能开始；可空 */
  prerequisite?: string | null;
}

export type IssueCode =
  // 结构性错误：阻止保存草稿
  | 'MALFORMED_CUE'
  | 'MISSING_ID'
  | 'DUPLICATE_ID'
  | 'NEGATIVE_START'
  | 'NON_POSITIVE_DURATION'
  | 'MISSING_RESOURCE'
  | 'PREREQ_MISSING'
  | 'PREREQ_CYCLE'
  // 可定位的冲突：允许存草稿，但阻止发布
  | 'RESOURCE_OVERLAP'
  | 'PREREQ_ORDER';

export type Severity = 'error' | 'conflict';

export interface Issue {
  code: IssueCode;
  severity: Severity;
  message: string;
  /** 相关动作 id，便于在编辑器中定位 */
  cueIds?: string[];
  /** 资源名称（资源冲突时存在） */
  resource?: string;
}

export interface ValidationResult {
  /** 存在结构性错误：不允许保存草稿 */
  blocking: boolean;
  /** 存在任意问题（结构性错误或冲突） */
  hasIssues: boolean;
  /** 无冲突可发布（结构性错误与冲突都不存在时） */
  publishable: boolean;
  issues: Issue[];
}
