import { BarChart3, ListTodo, Settings, Timer } from 'lucide-react';

export type MobileView = 'focus' | 'tasks' | 'history' | 'settings';

const ITEMS = [
  { id: 'focus', label: '专注', code: '01', icon: Timer },
  { id: 'tasks', label: '任务', code: '02', icon: ListTodo },
  { id: 'history', label: '统计', code: '03', icon: BarChart3 },
  { id: 'settings', label: '设置', code: '04', icon: Settings },
] as const;

interface AppNavigationProps {
  activeView: MobileView;
  onChange: (view: MobileView) => void;
}

export function AppNavigation({ activeView, onChange }: AppNavigationProps) {
  return (
    <nav className="app-navigation" aria-label="主要功能">
      {ITEMS.map((item) => {
        const Icon = item.icon;
        return (
          <button
            type="button"
            key={item.id}
            className={activeView === item.id ? 'is-active' : ''}
            aria-current={activeView === item.id ? 'page' : undefined}
            onClick={() => onChange(item.id)}
          >
            <small aria-hidden="true">{item.code}</small>
            <Icon aria-hidden="true" />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
