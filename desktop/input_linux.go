package desktop

import (
	"context"
	"os/exec"
	"strings"
	"time"
)

// AT-SPI 提供编辑焦点；无辅助功能服务时保留结果让用户复制。
const focusedInputScript = `
import pyatspi
for app in pyatspi.Registry.getDesktop(0):
    for frame in app:
        if frame is None or not frame.getState().contains(pyatspi.STATE_ACTIVE):
            continue
        def editable(item):
            state = item.getState()
            return state.contains(pyatspi.STATE_EDITABLE) and state.contains(pyatspi.STATE_FOCUSED) and item.getRole() != pyatspi.ROLE_PASSWORD_TEXT
        item = pyatspi.findDescendant(frame, editable)
        if item is not None:
            print(str(app.get_process_id()) + ':' + item.path)
            raise SystemExit
`

func focusedInputTarget() string {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "python3", "-c", focusedInputScript).Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}
