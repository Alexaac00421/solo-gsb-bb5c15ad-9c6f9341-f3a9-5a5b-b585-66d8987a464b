import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateCues, overlaps } from './validation.ts';

const cue = (o: Record<string, unknown>) => ({
  name: '',
  start: 0,
  duration: 1,
  resource: 'R',
  prerequisite: null,
  ...o,
});

test('左闭右开：首尾相接不重叠，严格相交才冲突', () => {
  assert.equal(overlaps(0, 5, 5, 10), false);
  assert.equal(overlaps(0, 6, 5, 10), true);
});

test('干净场次可发布', () => {
  const r = validateCues([
    cue({ id: 'A', start: 0, duration: 5, resource: '灯' }),
    cue({ id: 'B', start: 5, duration: 5, resource: '灯', prerequisite: 'A' }),
  ]);
  assert.equal(r.blocking, false);
  assert.equal(r.publishable, true);
});

test('负数时刻与非正时长阻止保存', () => {
  const r = validateCues([
    cue({ id: 'A', start: -1, duration: 2 }),
    cue({ id: 'B', start: 0, duration: 0 }),
  ]);
  assert.equal(r.blocking, true);
  assert.ok(r.issues.some((i) => i.code === 'NEGATIVE_START'));
  assert.ok(r.issues.some((i) => i.code === 'NON_POSITIVE_DURATION'));
});

test('同资源首尾相接合法，真正重叠报冲突', () => {
  const r = validateCues([
    cue({ id: 'A', start: 0, duration: 5, resource: '追光' }),
    cue({ id: 'B', start: 5, duration: 2, resource: '追光' }),
    cue({ id: 'C', start: 6, duration: 1, resource: '追光' }),
  ]);
  assert.equal(r.blocking, false);
  assert.equal(r.publishable, false);
  assert.deepEqual(
    r.issues.filter((i) => i.code === 'RESOURCE_OVERLAP').map((i) => i.cueIds),
    [['B', 'C']],
  );
});

test('不同资源同时段不算冲突', () => {
  const r = validateCues([
    cue({ id: 'A', start: 0, duration: 5, resource: '灯' }),
    cue({ id: 'B', start: 0, duration: 5, resource: '音响' }),
  ]);
  assert.equal(r.publishable, true);
});

test('前置未结束就开始报冲突（首尾相接合法）', () => {
  const r1 = validateCues([
    cue({ id: 'A', start: 0, duration: 5, resource: 'R1' }),
    cue({ id: 'B', start: 4, duration: 1, resource: 'R2', prerequisite: 'A' }),
  ]);
  assert.ok(r1.issues.some((i) => i.code === 'PREREQ_ORDER'));

  const r2 = validateCues([
    cue({ id: 'A', start: 0, duration: 5, resource: 'R1' }),
    cue({ id: 'B', start: 5, duration: 1, resource: 'R2', prerequisite: 'A' }),
  ]);
  assert.equal(r2.publishable, true);
});

test('缺失引用阻止保存', () => {
  const r = validateCues([
    cue({ id: 'A', start: 0, duration: 1, prerequisite: 'X' }),
  ]);
  assert.equal(r.blocking, true);
  assert.ok(r.issues.some((i) => i.code === 'PREREQ_MISSING'));
});

test('自依赖阻止保存', () => {
  const r = validateCues([
    cue({ id: 'A', start: 0, duration: 1, prerequisite: 'A' }),
  ]);
  assert.ok(r.issues.some((i) => i.code === 'PREREQ_CYCLE'));
});

test('环形依赖只报告一次', () => {
  const r = validateCues([
    cue({ id: 'A', start: 0, duration: 1, resource: 'RA', prerequisite: 'C' }),
    cue({ id: 'B', start: 1, duration: 1, resource: 'RB', prerequisite: 'A' }),
    cue({ id: 'C', start: 2, duration: 1, resource: 'RC', prerequisite: 'B' }),
  ]);
  assert.equal(r.blocking, true);
  assert.equal(r.issues.filter((i) => i.code === 'PREREQ_CYCLE').length, 1);
  assert.deepEqual(r.issues[0].cueIds, ['A', 'C', 'B']);
});

test('重复 id 与缺失资源阻止保存', () => {
  const r = validateCues([
    cue({ id: 'A', start: 0, duration: 1, resource: '灯' }),
    cue({ id: 'A', start: 2, duration: 1, resource: '光' }),
    cue({ id: 'B', start: 0, duration: 1, resource: '' }),
  ]);
  assert.equal(r.blocking, true);
  assert.ok(r.issues.some((i) => i.code === 'DUPLICATE_ID'));
  assert.ok(r.issues.some((i) => i.code === 'MISSING_RESOURCE'));
});

test('非数组输入安全失败', () => {
  const r = validateCues({ nope: true });
  assert.equal(r.blocking, true);
  assert.equal(r.publishable, false);
});
