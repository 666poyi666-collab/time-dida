// Icon 统一图标包装器 - v0.3.7
// 解决问题：lucide-react 默认 strokeWidth=2，在不同尺寸下视觉重量不一致。
// 本包装器：
// 1. 根据尺寸自动调整 strokeWidth（小图标更粗、大图标更细）
// 2. 统一光学尺寸对齐
// 3. 提供语义色调快捷映射
// 4. 强制 GPU 加速渲染

import React from 'react';

type IconSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
type IconTone =
  | 'default'
  | 'muted'
  | 'subtle'
  | 'accent'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info';

const SIZE_MAP: Record<IconSize, { px: number; stroke: number }> = {
  // 小尺寸用更粗描边保证可读，大尺寸用更细描边保证精致
  xs: { px: 12, stroke: 2.25 },
  sm: { px: 14, stroke: 2 },
  md: { px: 16, stroke: 1.75 },
  lg: { px: 18, stroke: 1.625 },
  xl: { px: 22, stroke: 1.5 },
};

const TONE_CLASS: Record<IconTone, string> = {
  default: 'text-fg',
  muted: 'text-fg-muted',
  subtle: 'text-fg-subtle',
  accent: 'text-accent',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  info: 'text-info',
};

export interface IconProps extends Omit<React.SVGProps<SVGSVGElement>, 'ref'> {
  size?: IconSize;
  tone?: IconTone;
  className?: string;
}

// HOC 工厂：将任意 lucide 图标组件包装为统一 Icon
export function createIcon<P extends Record<string, unknown>>(
  LucideComp: React.ComponentType<P>,
) {
  const Wrapped = React.forwardRef<SVGSVGElement, IconProps>(
    ({ size = 'md', tone, className = '', ...rest }, ref) => {
      const { px, stroke } = SIZE_MAP[size];
      const toneCls = tone ? TONE_CLASS[tone] : '';
      const mergedProps = {
        size: px,
        strokeWidth: stroke,
        className: `${toneCls} ${className}`.trim(),
      } as unknown as P;
      return (
        <LucideComp
          ref={ref as any}
          {...mergedProps}
          {...(rest as any)}
        />
      );
    },
  );
  Wrapped.displayName = `Icon.${LucideComp.displayName || 'Unknown'}`;
  return Wrapped;
}

// 预包装常用图标——统一描边、统一光学尺寸
import {
  Play,
  Pause,
  Square,
  Link2,
  Unlink,
  X,
  Star,
  Search,
  RefreshCw,
  Activity,
  Clock3,
  Coffee,
  Route,
  Timer,
  History,
  Settings,
  ListTodo,
  Minus,
  PanelRightClose,
  ChevronUp,
  ChevronDown,
  ChevronRight,
  Check,
  CheckCircle,
  Circle,
  Cloud,
  CloudOff,
  HardDrive,
  Terminal,
  Maximize2,
  Merge,
  CalendarDays,
  Filter,
  Trash2,
  Download,
  Upload,
  Plus,
  Pencil,
  Copy,
  AlertCircle,
  Info,
  Zap,
  Target,
  TrendingUp,
  Layers,
  Eye,
  EyeOff,
  Sun,
  Moon,
  Monitor,
  Keyboard,
  Palette,
  RotateCcw,
  ExternalLink,
  MoreHorizontal,
  GripVertical,
  ArrowRight,
  ArrowLeft,
  Inbox,
  Flag,
  Clock,
  CircleDot,
  Disc3,
} from 'lucide-react';

// 导出统一包装的图标集
export const Icon = {
  Play: createIcon(Play),
  Pause: createIcon(Pause),
  Square: createIcon(Square),
  Link: createIcon(Link2),
  Unlink: createIcon(Unlink),
  X: createIcon(X),
  Star: createIcon(Star),
  Search: createIcon(Search),
  Refresh: createIcon(RefreshCw),
  Activity: createIcon(Activity),
  Clock: createIcon(Clock3),
  Coffee: createIcon(Coffee),
  Route: createIcon(Route),
  Timer: createIcon(Timer),
  History: createIcon(History),
  Settings: createIcon(Settings),
  ListTodo: createIcon(ListTodo),
  Minus: createIcon(Minus),
  PanelClose: createIcon(PanelRightClose),
  ChevronUp: createIcon(ChevronUp),
  ChevronDown: createIcon(ChevronDown),
  ChevronRight: createIcon(ChevronRight),
  Check: createIcon(Check),
  CheckCircle: createIcon(CheckCircle),
  Circle: createIcon(Circle),
  Cloud: createIcon(Cloud),
  CloudOff: createIcon(CloudOff),
  HardDrive: createIcon(HardDrive),
  Terminal: createIcon(Terminal),
  Maximize: createIcon(Maximize2),
  Merge: createIcon(Merge),
  Calendar: createIcon(CalendarDays),
  Filter: createIcon(Filter),
  Trash: createIcon(Trash2),
  Download: createIcon(Download),
  Upload: createIcon(Upload),
  Plus: createIcon(Plus),
  Pencil: createIcon(Pencil),
  Copy: createIcon(Copy),
  AlertCircle: createIcon(AlertCircle),
  Info: createIcon(Info),
  Zap: createIcon(Zap),
  Target: createIcon(Target),
  TrendingUp: createIcon(TrendingUp),
  Layers: createIcon(Layers),
  Eye: createIcon(Eye),
  EyeOff: createIcon(EyeOff),
  Sun: createIcon(Sun),
  Moon: createIcon(Moon),
  Monitor: createIcon(Monitor),
  Keyboard: createIcon(Keyboard),
  Palette: createIcon(Palette),
  RotateCcw: createIcon(RotateCcw),
  ExternalLink: createIcon(ExternalLink),
  More: createIcon(MoreHorizontal),
  Grip: createIcon(GripVertical),
  ArrowRight: createIcon(ArrowRight),
  ArrowLeft: createIcon(ArrowLeft),
  Inbox: createIcon(Inbox),
  Flag: createIcon(Flag),
  ClockAlt: createIcon(Clock),
  CircleDot: createIcon(CircleDot),
  Disc: createIcon(Disc3),
};

export type { IconSize, IconTone };
