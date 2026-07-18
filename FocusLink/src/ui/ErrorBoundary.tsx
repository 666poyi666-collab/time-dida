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
          className="state-block tone-error h-full w-full"
          style={{ background: 'rgb(var(--app-bg))' }}
          role="alert"
        >
          <div className="state-block-icon">
            <Icon.AlertCircle size="lg" />
          </div>
          <h3 className="state-block-title">界面渲染出错</h3>
          <p className="state-block-desc">{this.state.error?.message ?? '发生了未知错误'}</p>
          <div className="state-block-actions">
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
