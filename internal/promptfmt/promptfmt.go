// Package promptfmt 负责 backend/prompts/*.tmpl 的排版与校验。
//
// gofmt 只管 Go 源码，模板里的自然语言没有人管：一行三百多字时既难读，
// 评审也看不出改了哪一句。这里定几条机械规则：
//
//   - UTF-8、LF 换行、行首行尾不留空白、文件以一个换行结尾；
//   - 段落之间最多一个空行，文件首尾不留空行；
//   - 单行显示宽度不超过 MaxColumns（中文按两列算），超宽的行在空格或
//     中文字符边界折行，绝不拆开 {{ ... }} 动作和英文单词；
//   - 收尾标点不放到行首，开括号不留在行尾。
//
// 规则只做「折行」不做「并句」：作者用换行表达语义分组，格式化不会把
// 它抹平，因此可以反复运行，结果稳定。
package promptfmt

import "strings"

// MaxColumns 是一行提示词的显示宽度上限。中文按两列算，约等于一行
// 40 个汉字，接近中文排版的舒适宽度。
const MaxColumns = 80

// Issue 描述一处需要人工处理的排版问题。
type Issue struct {
	Line    int
	Message string
}

// Format 返回规范化后的文本，以及无法自动修复的问题。调用方负责决定
// 是写回还是只报告。
func Format(src string) (string, []Issue) {
	src = strings.TrimPrefix(src, "\ufeff")
	src = strings.ReplaceAll(src, "\r\n", "\n")
	src = strings.ReplaceAll(src, "\r", "\n")
	if strings.TrimSpace(src) == "" {
		return "", nil
	}

	var issues []Issue
	lines := make([]string, 0, 16)
	for i, raw := range strings.Split(src, "\n") {
		// 模板里没有需要保留的缩进，制表符一律换成空格。
		line := strings.TrimSpace(strings.ReplaceAll(raw, "\t", " "))
		if hasUnclosedAction(line) {
			issues = append(issues, Issue{Line: i + 1, Message: "模板动作 {{ ... }} 必须写在同一行内"})
		}
		if line == "" {
			// 连续空行压成一个，文件开头不留空行。
			if len(lines) == 0 || lines[len(lines)-1] == "" {
				continue
			}
			lines = append(lines, "")
			continue
		}
		wrapped, wrapIssues := wrapLine(line, i+1)
		lines = append(lines, wrapped...)
		issues = append(issues, wrapIssues...)
	}
	for len(lines) > 0 && lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}
	return strings.Join(lines, "\n") + "\n", issues
}

// wrapLine 把一行超宽文本折成多行；宽度够的行原样返回。
func wrapLine(line string, lineNo int) ([]string, []Issue) {
	if displayWidth(line) <= MaxColumns {
		return []string{line}, nil
	}
	atoms := splitAtoms(line)
	for _, a := range atoms {
		// 单个片段（超长链接、没有空格的英文长词）拆不开，只能请作者处理。
		if a.width > MaxColumns {
			return []string{line}, []Issue{{
				Line:    lineNo,
				Message: "这一行超过宽度上限且没有可断开的位置，请手动折行",
			}}
		}
	}

	lines := make([]string, 0, 2)
	current := ""
	width := 0
	for _, a := range atoms {
		extra := a.width
		if current != "" && a.spaceBefore {
			extra++
		}
		if current != "" && width+extra > MaxColumns && a.canBreak {
			lines = append(lines, current)
			current = ""
			width = 0
			extra = a.width
		}
		if current != "" && a.spaceBefore {
			current += " "
			width++
		}
		current += a.text
		width += a.width
	}
	if current != "" {
		lines = append(lines, current)
	}
	return lines, nil
}

// atom 是折行的最小单位：一个 {{ ... }} 动作、一个汉字，或一个不含
// 空白的英文词。宽度按源码计算，动作渲染后会更短，略偏保守。
type atom struct {
	text        string
	width       int
	spaceBefore bool
	canBreak    bool
}

func splitAtoms(line string) []atom {
	runes := []rune(line)
	atoms := make([]atom, 0, len(runes)/2)
	space := false
	var previous rune
	for i := 0; i < len(runes); {
		r := runes[i]
		if r == ' ' {
			space = true
			i++
			continue
		}
		var text string
		switch {
		case r == '{' && i+1 < len(runes) && runes[i+1] == '{':
			end := actionEnd(runes, i)
			if end < 0 {
				text = string(runes[i:])
				i = len(runes)
			} else {
				text = string(runes[i : end+1])
				i = end + 1
			}
		case isWide(r):
			text = string(r)
			i++
		default:
			start := i
			for i < len(runes) && runes[i] != ' ' && !isWide(runes[i]) {
				if runes[i] == '{' && i+1 < len(runes) && runes[i+1] == '{' {
					break
				}
				i++
			}
			text = string(runes[start:i])
		}
		runesOfText := []rune(text)
		atoms = append(atoms, atom{
			text:        text,
			width:       displayWidth(text),
			spaceBefore: space && len(atoms) > 0,
			canBreak:    len(atoms) > 0 && breakable(previous, runesOfText[0]),
		})
		previous = runesOfText[len(runesOfText)-1]
		space = false
	}
	return atoms
}

// actionEnd 返回从 start 开始的 {{ ... }} 动作的结束下标（第二个 }）。
func actionEnd(runes []rune, start int) int {
	for i := start + 2; i+1 < len(runes); i++ {
		if runes[i] == '}' && runes[i+1] == '}' {
			return i + 1
		}
	}
	return -1
}

func hasUnclosedAction(line string) bool {
	runes := []rune(line)
	for i := 0; i < len(runes); i++ {
		if runes[i] == '{' && i+1 < len(runes) && runes[i+1] == '{' {
			end := actionEnd(runes, i)
			if end < 0 {
				return true
			}
			i = end
		}
	}
	return false
}

// breakable 判断能否在前后两个字符之间换行：收尾标点不能落到行首，
// 开括号不能留在行尾。
func breakable(previous, next rune) bool {
	return !isOpener(previous) && !isCloser(next)
}

func isOpener(r rune) bool {
	switch r {
	case '（', '【', '《', '〈', '「', '『', '“', '‘', '(', '[', '{', '<':
		return true
	}
	return false
}

func isCloser(r rune) bool {
	switch r {
	case '。', '，', '、', '；', '：', '！', '？', '）', '】', '》', '〉', '」', '』', '”', '’', '…', '%',
		'.', ',', ';', ':', '!', '?', ')', ']', '}':
		return true
	}
	return false
}

func displayWidth(text string) int {
	width := 0
	for _, r := range text {
		width += runeWidth(r)
	}
	return width
}

// runeWidth 给出字符的显示宽度：中日韩文字与全角符号占两列，其余一列。
func runeWidth(r rune) int {
	switch {
	case r < 0x1100:
		return 1
	case r <= 0x115f, // 谚文字母
		r >= 0x2e80 && r <= 0xa4cf, // 部首、假名、汉字
		r >= 0xac00 && r <= 0xd7a3, // 谚文音节
		r >= 0xf900 && r <= 0xfaff, // 汉字兼容表意
		r >= 0xfe30 && r <= 0xfe4f, // 竖排与兼容标点
		r >= 0xff00 && r <= 0xff60, // 全角 ASCII
		r >= 0xffe0 && r <= 0xffe6,
		r >= 0x1f300 && r <= 0x1f9ff: // 表情符号
		return 2
	}
	return 1
}

func isWide(r rune) bool {
	return runeWidth(r) == 2
}
