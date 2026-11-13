package desktop

import "testing"

func TestTrayBubbleMenuStateFollowsVisibleMode(t *testing.T) {
	cases := []struct {
		mode       string
		showHidden bool
		hideHidden bool
	}{
		// 主窗口没有悬浮球：两项都不能出现，否则“隐藏悬浮球”会把
		// 主窗口一起收走。
		{ModeMain, true, true},
		// 悬浮球可见时只保留“隐藏”。
		{ModeBubble, true, false},
		// 只剩托盘或胶囊时才需要“显示悬浮球”。
		{ModeHidden, false, true},
		{ModeOverlay, false, true},
		{"", false, true},
	}
	for _, tc := range cases {
		got := trayBubbleMenuStateFor(tc.mode)
		if got.showHidden != tc.showHidden || got.hideHidden != tc.hideHidden {
			t.Fatalf("mode %q menu state = %+v, want showHidden=%v hideHidden=%v",
				tc.mode, got, tc.showHidden, tc.hideHidden)
		}
	}
}
