// 异步请求序号门闩（纯函数）：只有最新发出的请求允许落地，
// 晚到的旧响应永远不得覆盖更新请求的结果（范围切换/行展开竞态防护）。
export type RequestGate = {
  /** 发出新请求：返回其序号，同时使所有更早的序号失效。 */
  issue(): number;
  /** 该序号是否仍是当前最新请求。 */
  isCurrent(id: number): boolean;
  /** 使全部未完成请求失效（组件卸载或路由离开时调用）。 */
  invalidate(): void;
};

export function createRequestGate(): RequestGate {
  let current = 0;
  return {
    issue() {
      current += 1;
      return current;
    },
    isCurrent(id: number) {
      return id === current;
    },
    invalidate() {
      current += 1;
    },
  };
}
