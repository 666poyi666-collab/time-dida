// Icon 统一图标包装器 - v0.3.10
// 解决问题：lucide-react 默认 strokeWidth=2，在不同尺寸下视觉重量不一致。
// 本包装器：
// 1. 根据尺寸自动调整 strokeWidth（小图标更粗、大图标更细）
// 2. 统一光学尺寸对齐
// 3. 提供语义色调快捷映射
// 4. hover 微动效：scale(1.12) + spring 曲线
// 5. spin 旋转动画：加载/刷新场景
// 6. 强制 GPU 加速渲染

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
  /** hover 时 scale(1.12) 微动效 */
  hover?: boolean;
  /** 持续旋转动画（加载/刷新场景） */
  spin?: boolean;
}

// HOC 工厂：将任意 lucide 图标组件包装为统一 Icon
export function createIcon<P extends Record<string, unknown>>(
  LucideComp: React.ComponentType<P>,
) {
  const Wrapped = React.forwardRef<SVGSVGElement, IconProps>(
    ({ size = 'md', tone, className = '', hover, spin, ...rest }, ref) => {
      const { px, stroke } = SIZE_MAP[size];
      const toneCls = tone ? TONE_CLASS[tone] : '';
      const motionCls = hover ? 'icon-hover' : '';
      const spinCls = spin ? 'motion-spin' : '';
      const finalClass = [toneCls, motionCls, spinCls, className]
        .filter(Boolean)
        .join(' ');
      const mergedProps = {
        size: px,
        strokeWidth: stroke,
        className: finalClass,
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
  CheckCircle2,
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
  MoreVertical,
  GripVertical,
  ArrowRight,
  ArrowLeft,
  Inbox,
  Flag,
  Clock,
  CircleDot,
  Disc3,
  // v0.3.10 新增图标
  Loader2,
  BarChart3,
  LogOut,
  Stethoscope,
  ListChecks,
  ListTree,
  Layers3,
  ChevronLeft,
  Save,
  FileText,
  Sparkles,
  Gauge,
  Lock,
  Unlock,
  Wifi,
  WifiOff,
  Bell,
  Volume2,
  VolumeX,
  Power,
  Menu,
} from 'lucide-react';

// 导出统一包装的图标集
export const Icon = {
  // 基础操作
  Play: createIcon(Play),
  Pause: createIcon(Pause),
  Square: createIcon(Square),
  X: createIcon(X),
  Check: createIcon(Check),
  Plus: createIcon(Plus),
  Minus: createIcon(Minus),
  Search: createIcon(Search),
  Filter: createIcon(Filter),
  Copy: createIcon(Copy),
  Pencil: createIcon(Pencil),
  Trash: createIcon(Trash2),
  Download: createIcon(Download),
  Upload: createIcon(Upload),
  Save: createIcon(Save),
  ExternalLink: createIcon(ExternalLink),
  Refresh: createIcon(RefreshCw),
  RotateCcw: createIcon(RotateCcw),
  Merge: createIcon(Merge),

  // 导航
  ChevronUp: createIcon(ChevronUp),
  ChevronDown: createIcon(ChevronDown),
  ChevronLeft: createIcon(ChevronLeft),
  ChevronRight: createIcon(ChevronRight),
  ArrowRight: createIcon(ArrowRight),
  ArrowLeft: createIcon(ArrowLeft),
  Menu: createIcon(Menu),

  // 状态
  Circle: createIcon(Circle),
  CircleDot: createIcon(CircleDot),
  CheckCircle: createIcon(CheckCircle),
  CheckCircleFilled: createIcon(CheckCircle2),
  AlertCircle: createIcon(AlertCircle),
  Info: createIcon(Info),
  Star: createIcon(Star),
  Flag: createIcon(Flag),
  Zap: createIcon(Zap),

  // 专注/计时
  Timer: createIcon(Timer),
  Clock: createIcon(Clock3),
  ClockAlt: createIcon(Clock),
  Activity: createIcon(Activity),
  Coffee: createIcon(Coffee),
  Route: createIcon(Route),
  Gauge: createIcon(Gauge),
  Target: createIcon(Target),
  TrendingUp: createIcon(TrendingUp),
  Disc: createIcon(Disc3),

  // 任务
  ListTodo: createIcon(ListTodo),
  ListChecks: createIcon(ListChecks),
  ListTree: createIcon(ListTree),
  Link: createIcon(Link2),
  Unlink: createIcon(Unlink),
  Inbox: createIcon(Inbox),
  Layers: createIcon(Layers),
  Layers3: createIcon(Layers3),

  // 导航视图
  History: createIcon(History),
  Settings: createIcon(Settings),
  Calendar: createIcon(CalendarDays),
  BarChart: createIcon(BarChart3),
  PanelClose: createIcon(PanelRightClose),
  Maximize: createIcon(Maximize2),

  // 云/同步
  Cloud: createIcon(Cloud),
  CloudOff: createIcon(CloudOff),
  HardDrive: createIcon(HardDrive),
  Terminal: createIcon(Terminal),
  Wifi: createIcon(Wifi),
  WifiOff: createIcon(WifiOff),

  // 主题/外观
  Sun: createIcon(Sun),
  Moon: createIcon(Moon),
  Monitor: createIcon(Monitor),
  Palette: createIcon(Palette),
  Eye: createIcon(Eye),
  EyeOff: createIcon(EyeOff),
  Sparkles: createIcon(Sparkles),

  // 快捷键/输入
  Keyboard: createIcon(Keyboard),
  Grip: createIcon(GripVertical),

  // 系统/设置
  LogOut: createIcon(LogOut),
  Loader: createIcon(Loader2),
  Stethoscope: createIcon(Stethoscope),
  FileText: createIcon(FileText),
  Lock: createIcon(Lock),
  Unlock: createIcon(Unlock),
  Power: createIcon(Power),
  Bell: createIcon(Bell),
  Volume2: createIcon(Volume2),
  VolumeX: createIcon(VolumeX),

  // 更多
  More: createIcon(MoreHorizontal),
  MoreVertical: createIcon(MoreVertical),
};

// ── Spinner：加载旋转组件 ──
export function Spinner({ size = 'md', tone, className = '' }: Pick<IconProps, 'size' | 'tone' | 'className'>) {
  return <Icon.Loader size={size} tone={tone} spin className={className} />;
}

export type { IconSize, IconTone };
