// Zustand 全局状态 - 计时器快照 + 任务 + 导航
import { create } from 'zustand';
import type { TimerSnapshot, Task, Project, AppSettings, SyncQueueItem } from '@shared/types';

interface ToastItem {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

export type View = 'timer' | 'tasks' | 'history' | 'settings';

interface AppState {
  snapshot: TimerSnapshot | null;
  ticktickTasks: Task[];
  ticktickProjects: Project[];
  settings: AppSettings | null;
  syncQueue: SyncQueueItem[];
  view: View;
  pendingTask: Task | null;
  taskPickerRequest: number;
  toasts: ToastItem[];

  setSnapshot: (s: TimerSnapshot) => void;
  setTicktickTasks: (t: Task[]) => void;
  setTicktickProjects: (p: Project[]) => void;
  setSettings: (s: AppSettings) => void;
  setSyncQueue: (q: SyncQueueItem[]) => void;
  setView: (v: View) => void;
  setPendingTask: (task: Task | null) => void;
  requestTaskPicker: () => void;
  consumeTaskPickerRequest: () => void;
  addToast: (message: string, type?: ToastItem['type']) => void;
  removeToast: (id: string) => void;
}

export const useStore = create<AppState>((set) => ({
  snapshot: null,
  ticktickTasks: [],
  ticktickProjects: [],
  settings: null,
  syncQueue: [],
  view: 'timer',
  pendingTask: null,
  taskPickerRequest: 0,
  toasts: [],

  setSnapshot: (s) => set({ snapshot: s }),
  setTicktickTasks: (t) => set({ ticktickTasks: t }),
  setTicktickProjects: (p) => set({ ticktickProjects: p }),
  setSettings: (s) => set({ settings: s }),
  setSyncQueue: (q) => set({ syncQueue: q }),
  setView: (v) => set({ view: v }),
  setPendingTask: (pendingTask) => set({ pendingTask }),
  requestTaskPicker: () => set((state) => ({ taskPickerRequest: state.taskPickerRequest + 1 })),
  consumeTaskPickerRequest: () => set({ taskPickerRequest: 0 }),
  addToast: (message, type = 'info') => {
    const id = Math.random().toString(36).slice(2);
    let added = false;
    set((st) => {
      if (st.toasts.some((toast) => toast.message === message && toast.type === type)) return st;
      added = true;
      return { toasts: [...st.toasts, { id, message, type }] };
    });
    if (!added) return;
    setTimeout(() => {
      set((st) => ({ toasts: st.toasts.filter((t) => t.id !== id) }));
    }, 3200);
  },
  removeToast: (id) => set((st) => ({ toasts: st.toasts.filter((t) => t.id !== id) })),
}));
