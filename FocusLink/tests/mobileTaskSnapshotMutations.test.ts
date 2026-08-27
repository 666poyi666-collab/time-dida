import { describe, expect, it } from 'vitest';
import type { TaskSnapshotPayload } from '../shared/sync/taskSnapshotProtocol';
import {
  createEmptyTaskSnapshot,
  moveTaskSnapshotSubtree,
  updateTaskSnapshotProject,
} from '../src/mobile/taskSnapshotMutations';

const snapshot: TaskSnapshotPayload = {
  publishedAt: 10,
  projects: [
    { id: 'local-inbox', source: 'local', name: '收件箱', color: '#16899f' },
    { id: 'study', source: 'local', name: '学习', color: '#2f6fed' },
    { id: 'life', source: 'local', name: '生活', color: '#c56a2d' },
  ],
  tasks: [
    makeTask('parent', 'study'),
    { ...makeTask('child', 'study'), parentId: 'parent' },
    { ...makeTask('leaf', 'study'), parentId: 'child' },
  ],
};

describe('mobile task snapshot mutations', () => {
  it('creates the canonical inbox so a newly paired device can create its first task', () => {
    expect(createEmptyTaskSnapshot(15)).toEqual({
      publishedAt: 15,
      projects: [{ id: 'local-inbox', source: 'local', name: '收件箱', color: '#16899f' }],
      tasks: [],
    });
  });

  it('updates one regular list without mutating another list', () => {
    const next = updateTaskSnapshotProject(
      snapshot,
      snapshot.projects[1],
      { name: '高数', color: '#7957c7' },
      20,
    );
    expect(next.publishedAt).toBe(20);
    expect(next.projects[1]).toMatchObject({ name: '高数', color: '#7957c7' });
    expect(next.projects[2]).toEqual(snapshot.projects[2]);
    expect(snapshot.projects[1].name).toBe('学习');
  });

  it('moves a parent and its descendants into exactly one target list', () => {
    const next = moveTaskSnapshotSubtree(snapshot, 'parent', 'life', 30);
    expect(next.tasks.map((task) => task.projectId)).toEqual(['life', 'life', 'life']);
    expect(next.tasks.map((task) => task.parentId)).toEqual([null, 'parent', 'child']);
    expect(next.tasks.every((task) => task.updatedAt === 30)).toBe(true);
  });

  it('detaches a moved child subtree and rejects unknown targets', () => {
    const next = moveTaskSnapshotSubtree(snapshot, 'child', null, 40);
    expect(next.tasks[0]).toEqual(snapshot.tasks[0]);
    expect(next.tasks[1]).toMatchObject({ projectId: 'local-inbox', parentId: null });
    expect(next.tasks[2]).toMatchObject({ projectId: 'local-inbox', parentId: 'child' });
    expect(() => moveTaskSnapshotSubtree(snapshot, 'parent', 'missing', 50)).toThrow(/不存在/);
  });
});

function makeTask(id: string, projectId: string) {
  return {
    id,
    source: 'local' as const,
    projectId,
    title: id,
    status: 'incomplete',
    priority: null,
    dueDate: null,
    tags: [],
    parentId: null,
    isCompleted: false,
    updatedAt: 10,
  };
}
