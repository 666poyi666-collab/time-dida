// 老 WebView 兼容层：必须在任何业务模块之前导入。
//
// 手表（OPPO OWW221）的系统 WebView 停在 Chrome 83（2020-05），不会再更新。
// esbuild 的 target 只能降语法，运行时 API 缺了就是缺了——crypto.randomUUID
// 是 Chrome 92 才有的，而 deviceId、commandId、离线会话 id 全靠它，缺席时
// 首次渲染直接抛 TypeError，整个应用白屏。
//
// getRandomValues 自古就有；按 RFC 4122 v4 补齐 version/variant 位即可等价。
if (typeof crypto !== 'undefined' && typeof crypto.randomUUID !== 'function') {
  (crypto as { randomUUID?: () => string }).randomUUID = function randomUUID(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };
}

export {};
