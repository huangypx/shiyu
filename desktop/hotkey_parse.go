package desktop

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
)

// hotkeyModifiers 用位掩码记录组合键里的修饰键，各平台适配器
// 再把它翻译成 Carbon 或 Win32 的常量。
type hotkeyModifiers uint32

const (
	modCtrl hotkeyModifiers = 1 << iota
	modShift
	modAlt
	modMeta
)

// hotkeySpec 是跨平台的热键解析结果。parts 保留输入顺序，
// 供 Linux xbindkeys 表达式原样输出；平台适配器只用
// Modifiers 与 Key。
type hotkeySpec struct {
	Modifiers hotkeyModifiers
	Key       string
	parts     []string
}

// parseHotkeySpec 把 "Option+Space" 这类写法解析成修饰键掩码与
// 归一化键名。别名规则与前端 hotkey.ts 保持一致：ctrl/control、
// alt/option、cmd/command/meta/super/win/windows 等价。全局热键
// 必须带至少一个修饰键，裸键会劫持正常打字。
func parseHotkeySpec(raw string) (hotkeySpec, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return hotkeySpec{}, errors.New("desktop hotkey is empty")
	}
	parts := strings.Split(raw, "+")
	if len(parts) < 2 {
		return hotkeySpec{}, errors.New("desktop hotkey needs a modifier and a key")
	}

	var spec hotkeySpec
	normalized := make([]string, 0, len(parts))
	for i, part := range parts {
		token := strings.ToLower(strings.TrimSpace(part))
		if token == "" {
			return hotkeySpec{}, errors.New("desktop hotkey contains an empty key")
		}
		if i == len(parts)-1 {
			key, err := normalizeHotkeyKey(token)
			if err != nil {
				return hotkeySpec{}, err
			}
			spec.Key = key
			normalized = append(normalized, key)
			continue
		}
		switch token {
		case "ctrl", "control":
			spec.Modifiers |= modCtrl
			normalized = append(normalized, "control")
		case "shift":
			spec.Modifiers |= modShift
			normalized = append(normalized, "shift")
		case "alt", "option":
			spec.Modifiers |= modAlt
			normalized = append(normalized, "alt")
		case "cmd", "command", "meta", "super", "win", "windows":
			spec.Modifiers |= modMeta
			normalized = append(normalized, "mod4")
		default:
			return hotkeySpec{}, fmt.Errorf("desktop hotkey has an unknown modifier %q", token)
		}
	}
	if spec.Modifiers == 0 {
		return hotkeySpec{}, errors.New("desktop hotkey needs at least one modifier")
	}
	spec.parts = normalized
	return spec, nil
}

// normalizeHotkeyKey 把键名收进各平台都能映射的键表：
// Space/Enter/Tab/Escape、A-Z、0-9、F1-F12。
func normalizeHotkeyKey(token string) (string, error) {
	switch token {
	case "esc", "escape":
		return "escape", nil
	case "return", "enter":
		return "enter", nil
	case "space", "tab":
		return token, nil
	}
	if len(token) == 1 {
		ch := token[0]
		if (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') {
			return token, nil
		}
	}
	if len(token) >= 2 && token[0] == 'f' {
		if n, err := strconv.Atoi(token[1:]); err == nil && n >= 1 && n <= 12 {
			return "f" + strconv.Itoa(n), nil
		}
	}
	return "", fmt.Errorf("this key combination is not supported: %s", token)
}

// linuxExpression 输出 xbindkeys 的键位表达式，修饰键顺序与
// 用户输入一致，保持旧配置的行为不变。
func (s hotkeySpec) linuxExpression() string {
	return strings.Join(s.parts, "+")
}
