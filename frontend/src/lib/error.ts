// 服务商错误从 Wails 桥传来时是纯字符串，往往还带着
// HTML 响应体；要让 Toast 仍然可读。
export function describeError(error: unknown) {
  // 非字符串的异常对象直接 String() 会得到 [object Object]，
  // 对用户完全没有信息量。
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : '';
  const compact = raw.replace(/s+/g, ' ').trim();
  if (!compact) return '未知错误';
  return compact.length > 120 ? `${compact.slice(0, 120)}…` : compact;
}
