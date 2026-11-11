type Props = {
  size?: number;
  className?: string;
};

// 品牌标记「声纹成字」：三根竖条是声纹，右侧两条横线是整理后的文字，
// 与应用图标同源，权威几何在 build/icons/app-icon.svg。
//
// 这里是小尺寸精简版：删掉第三根短柱，只留两柱两线。14–18px 下五根
// 元素之间的缝隙不足 1px，五元素版会糊成一块灰，两柱版反而能看清
// 「左边说话、右边出字」的方向。改这个文件之前先看 SVG，两边的
// 节奏（柱宽=线高、竖组与横组左对齐）必须一致。
//
// 单色 currentColor：界面里强调色只给焦点和链接，彩色标记会抢走
// 导航项的注意力，因此应用内不带靛蓝，只有图标成品才用双色。
export default function BrandMark({ size = 16, className }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      {/* 24 网格：柱宽=线高=3.4，竖组间隔 2.6，横线在 y=5.6 / y=15 与最高柱对齐。
          横线取 7.0 / 5.6 的长度，是 15px 下逐稿比对的结果：再短就只剩两个点，
          和竖条挤成「冒号」，看不出「右边是文字」。 */}
      <rect x="2.2" y="7.6" width="3.4" height="8.8" rx="1.7" />
      <rect x="8.2" y="5.6" width="3.4" height="12.8" rx="1.7" />
      <rect x="14.8" y="5.6" width="7" height="3.4" rx="1.7" />
      <rect x="14.8" y="15" width="5.6" height="3.4" rx="1.7" />
    </svg>
  );
}
