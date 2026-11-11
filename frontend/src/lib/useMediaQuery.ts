import { useEffect, useState } from 'react';

// 断点不只决定样式，也决定交互：宽度小于 680px 时侧栏变成覆盖层抽屉，
// 同一个按钮要负责「关闭抽屉」而不是「折叠侧栏」。CSS 里读不到这个
// 状态，所以在 JS 里保持一份订阅。
export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(
    () => window.matchMedia(query).matches,
  );

  useEffect(() => {
    const media = window.matchMedia(query);
    const sync = () => setMatches(media.matches);
    // 初始 state 可能在挂载与订阅之间过期，挂载时补读一次。
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, [query]);

  return matches;
}
