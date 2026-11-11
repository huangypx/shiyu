// 界面上的时间与问候语。桌面外壳没有路由刷新，
// 这些值只在渲染时计算一次即可。

export function getGreeting() {
  const hour = new Date().getHours();
  return hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好';
}

export function formatDate() {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(new Date());
}

// formatRelativeTime 给历史列表用：今天显示时刻，今年显示月日，
// 更早显示年月日。SQLite 里存的是 UTC 时间戳，这里统一按本地时区渲染。
export function formatRelativeTime(iso?: string) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) {
    return new Intl.DateTimeFormat('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }
  if (date.getFullYear() === now.getFullYear()) {
    return new Intl.DateTimeFormat('zh-CN', {
      month: 'numeric',
      day: 'numeric',
    }).format(date);
  }
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).format(date);
}
