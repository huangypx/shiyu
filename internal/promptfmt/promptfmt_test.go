package promptfmt

import (
	"strings"
	"testing"
)

// 宽度检查用同一份实现，测试只关心「有没有超宽的行」。
func tooWide(line string) bool {
	return displayWidth(line) > MaxColumns
}

func TestFormatWrapsWideChineseLines(t *testing.T) {
	input := strings.Repeat("口", 100)
	out, issues := Format(input)
	if len(issues) != 0 {
		t.Fatalf("issues = %+v", issues)
	}
	lines := strings.Split(strings.TrimSuffix(out, "\n"), "\n")
	if len(lines) < 2 {
		t.Fatalf("long line was not wrapped: %q", out)
	}
	for _, line := range lines {
		if tooWide(line) {
			t.Fatalf("line is too wide: %q", line)
		}
	}
	// 折行不能丢字。
	if strings.ReplaceAll(out, "\n", "") != input {
		t.Fatalf("wrapping lost content: %q", out)
	}
	// 再跑一次结果不变。
	again, _ := Format(out)
	if again != out {
		t.Fatalf("format is not idempotent:\n%q\n%q", out, again)
	}
}

func TestFormatWrapsEnglishAtSpaces(t *testing.T) {
	input := strings.Repeat("alpha beta gamma delta epsilon zeta eta theta ", 4)
	out, issues := Format(input)
	if len(issues) != 0 {
		t.Fatalf("issues = %+v", issues)
	}
	for _, line := range strings.Split(strings.TrimSuffix(out, "\n"), "\n") {
		if tooWide(line) {
			t.Fatalf("line is too wide: %q", line)
		}
	}
	// 英文只在空格处折行，单词不能被拆开。
	if got, want := strings.Fields(out), strings.Fields(input); strings.Join(got, " ") != strings.Join(want, " ") {
		t.Fatalf("words changed:\n got %q\nwant %q", got, want)
	}
}

func TestFormatKeepsTemplateActionsIntact(t *testing.T) {
	input := strings.Repeat("前缀", 30) + "{{ .language }}" + strings.Repeat("后缀", 30)
	out, issues := Format(input)
	if len(issues) != 0 {
		t.Fatalf("issues = %+v", issues)
	}
	if strings.Count(out, "{{ .language }}") != 1 {
		t.Fatalf("template action was split: %q", out)
	}
	for _, line := range strings.Split(strings.TrimSuffix(out, "\n"), "\n") {
		if strings.Count(line, "{{") != strings.Count(line, "}}") {
			t.Fatalf("line has an unbalanced action: %q", line)
		}
	}
}

func TestFormatNormalizesWhitespace(t *testing.T) {
	input := "第一行  \r\n\r\n\r\n第二行\t\n\n\n"
	out, issues := Format(input)
	if len(issues) != 0 {
		t.Fatalf("issues = %+v", issues)
	}
	if want := "第一行\n\n第二行\n"; out != want {
		t.Fatalf("formatted = %q, want %q", out, want)
	}
}

func TestFormatReportsUnbreakableLine(t *testing.T) {
	input := strings.Repeat("x", MaxColumns+20)
	out, issues := Format(input)
	if len(issues) != 1 {
		t.Fatalf("issues = %+v", issues)
	}
	// 问题行保持原样，交给作者手动折行。
	if out != input+"\n" {
		t.Fatalf("unbreakable line was changed: %q", out)
	}
}

func TestFormatReportsUnclosedAction(t *testing.T) {
	_, issues := Format("语言：{{ .language")
	if len(issues) != 1 {
		t.Fatalf("issues = %+v", issues)
	}
}

func TestFormatNeverStartsLineWithPunctuation(t *testing.T) {
	input := strings.Repeat("一二三四五六七八九十", 10) + "。"
	out, _ := Format(input)
	for _, line := range strings.Split(strings.TrimSuffix(out, "\n"), "\n") {
		if strings.HasPrefix(line, "。") {
			t.Fatalf("line starts with closing punctuation: %q", out)
		}
	}
}
