// Error Boundary - 捕获 React 渲染错误，防止白屏
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Icon } from './Icon';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[FocusLink ErrorBoundary] Render error caught:', error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div
          className="flex h-full w-full flex-col items-center justify-center gap-4 p-8"
          style={{ background: 'rgb(var(--app-bg))' }}
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-danger/10 text-danger">
            <Icon.AlertCircle size="lg" />
          </div>
          <div className="text-center">
            <h3 className="text-[14px] font-semibold text-fg">界面渲染出错</h3>
            <p className="mt-1 max-w-[360px] text-[11px] text-fg-muted">
              {this.state.error?.message ?? '发生了未知错误'}
            </p>
          </div>
          <div className="flex gap-2">
            <button className="btn-outline motion-press" onClick={this.handleRetry}>
              <Icon.Refresh size="xs" />
              重试
            </button>
            <button className="btn-primary motion-press" onClick={this.handleReload}>
              重新加载
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
