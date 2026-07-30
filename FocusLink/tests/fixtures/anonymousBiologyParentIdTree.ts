import type { SyncedTask, SyncedTaskProject } from '../../shared/sync/taskSnapshotProtocol';

// Only the parentId topology mirrors a standalone-task snapshot. Every identifier, title and
// metadata value is synthetic; this fixture deliberately contains no task body or personal text.
export const ANONYMOUS_BIOLOGY_PROJECTS: SyncedTaskProject[] = [
  {
    id: 'anonymous-biology-project',
    source: 'local',
    name: '匿名生物清单',
    color: null,
  },
];

export const ANONYMOUS_BIOLOGY_PARENT_ID_TASKS: SyncedTask[] = [
  anonymousTask('anonymous-root-a', '匿名主任务 A'),
  anonymousTask('anonymous-child-a-1', '匿名子任务 A-1', 'anonymous-root-a'),
  anonymousTask('anonymous-leaf-a-1-a', '匿名叶任务 A-1-a', 'anonymous-child-a-1'),
  anonymousTask('anonymous-deep-a-1-a-i', '匿名叶任务 A-1-a-i', 'anonymous-leaf-a-1-a'),
  anonymousTask('anonymous-child-a-2', '匿名子任务 A-2', 'anonymous-root-a'),
  anonymousTask('anonymous-root-b', '匿名主任务 B'),
  anonymousTask('anonymous-child-b-1', '匿名子任务 B-1', 'anonymous-root-b'),
];

export const ANONYMOUS_BIOLOGY_EXPECTED_PREORDER = [
  'anonymous-root-a',
  'anonymous-child-a-1',
  'anonymous-leaf-a-1-a',
  'anonymous-deep-a-1-a-i',
  'anonymous-child-a-2',
  'anonymous-root-b',
  'anonymous-child-b-1',
] as const;

function anonymousTask(id: string, title: string, parentId: string | null = null): SyncedTask {
  return {
    id,
    source: 'local',
    projectId: 'anonymous-biology-project',
    title,
    status: 'pending',
    priority: null,
    dueDate: null,
    tags: [],
    parentId,
    isCompleted: false,
    updatedAt: null,
  };
}
