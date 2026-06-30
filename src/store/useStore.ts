// Zustand 全局状态 - 计时器快照 + 任务 + 导航
import { create } from 'zustand';
import type { TimerSnapshot, Task, Project, AppSettings, SyncQueueItem } from '@shared/types';

interface ToastItem {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

type View = 'timer' | 'history' | 'settings';

interface AppState {
  snapshot: TimerSnapshot | null;
  localTasks: Task[];
  ticktickTasks: Task[];
  ticktickProjects: Project[];
  ticktickConnected: boolean;
  ticktickRegion: string;
  settings: AppSettings | null;
  syncQueue: SyncQueueItem[];
  selectedTaskId: string | null;
  view: View;
  toasts: ToastItem[];
  loading: boolean;

  setSnapshot: (s: TimerSnapshot) => void;
  setLocalTasks: (t: Task[]) => void;
  setTicktickTasks: (t: Task[]) => void;
  setTicktickProjects: (p: Project[]) => void;
  setTicktickStatus: (connected: boolean, region: string) => void;
  setSettings: (s: AppSettings) => void;
  setSyncQueue: (q: SyncQueueItem[]) => void;
  setSelectedTask: (id: string | null) => void;
  setView: (v: View) => void;
  setLoading: (b: boolean) => void;
  addToast: (message: string, type?: ToastItem['type']) => void;
  removeToast: (id: string) => void;
}

export const useStore = create<AppState>((set) => ({
  snapshot: null,
  localTasks: [],
  ticktickTasks: [],
  ticktickProjects: [],
  ticktickConnected: false,
  ticktickRegion: 'dida365',
  settings: null,
  syncQueue: [],
  selectedTaskId: null,
  view: 'timer',
  toasts: [],
  loading: false,

  setSnapshot: (s) => set({ snapshot: s }),
  setLocalTasks: (t) => set({ localTasks: t }),
  setTicktickTasks: (t) => set({ ticktickTasks: t }),
  setTicktickProjects: (p) => set({ ticktickProjects: p }),
  setTicktickStatus: (connected, region) =>
    set({ ticktickConnected: connected, ticktickRegion: region }),
  setSettings: (s) => set({ settings: s }),
  setSyncQueue: (q) => set({ syncQueue: q }),
  setSelectedTask: (id) => set({ selectedTaskId: id }),
  setView: (v) => set({ view: v }),
  setLoading: (b) => set({ loading: b }),
  addToast: (message, type = 'info') => {
    const id = Math.random().toString(36).slice(2);
    set((st) => ({ toasts: [...st.toasts, { id, message, type }] }));
    setTimeout(() => {
      set((st) => ({ toasts: st.toasts.filter((t) => t.id !== id) }));
    }, 3200);
  },
  removeToast: (id) => set((st) => ({ toasts: st.toasts.filter((t) => t.id !== id) })),
}));
