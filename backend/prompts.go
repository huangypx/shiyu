package backend

import (
	"embed"
	"fmt"
	"io/fs"
	"strings"
	"text/template"
	"time"
)

// 提示词以模板文件的形式放在 prompts/ 下，后端 embed 进二进制；前端用
// Vite 的 ?raw 导入同一份文件，仓库里因此只有一份文本。改一句提示词
// 不需要在 Go 字符串和 TypeScript 常量之间同步。
//
//go:embed prompts/*.tmpl
var promptFS embed.FS

// promptTexts 是嵌入提示词的唯一读取入口。模板随二进制发布，读不到
// 属于构建错误，因此在包初始化时直接 panic，由
// TestEmbeddedPromptsLoadAndRender 保证它不会真的触发。
var promptTexts = mustLoadPrompts()

func mustLoadPrompts() map[string]string {
	names, err := fs.Glob(promptFS, "prompts/*.tmpl")
	if err != nil {
		panic(fmt.Sprintf("list embedded prompts: %v", err))
	}
	texts := make(map[string]string, len(names))
	for _, name := range names {
		data, err := promptFS.ReadFile(name)
		if err != nil {
			panic(fmt.Sprintf("read embedded prompt %s: %v", name, err))
		}
		key := strings.TrimSuffix(strings.TrimPrefix(name, "prompts/"), ".tmpl")
		texts[key] = strings.TrimSpace(string(data))
	}
	return texts
}

// promptText 取一份内置模板的原文。
func promptText(name string) string {
	text, ok := promptTexts[name]
	if !ok {
		panic("embedded prompt is missing: " + name)
	}
	return text
}

// promptVariables 构造渲染变量。用 map 而不是结构体：模板里能写用户
// 友好的小写键（{{ .language }}），将来把用户自定义变量并进来也不必
// 改渲染器。
func promptVariables(language string, now time.Time) map[string]string {
	name := strings.TrimSpace(language)
	if name == "" {
		// 自动识别没有具体语言名，但模板里的括号不能空着。
		name = "自动识别"
	}
	return map[string]string{
		// language 是界面上的语言名，模板里永远不会渲染成空串。
		"language": name,
		// languageCode 是服务商用的语言代码，自动识别时为空。
		"languageCode": languageCode(language),
		// date 让「会议纪要」这类预设可以换算「今天/明天」。
		"date": now.Format("2006-01-02"),
	}
}

// renderPrompt 渲染一份提示词模板。missingkey=error 让拼错的变量名直接
// 报错，而不是静默渲染成空串；保存配置时会先校验一次。
func renderPrompt(text string, data map[string]string) (string, error) {
	tmpl, err := template.New("prompt").Option("missingkey=error").Parse(text)
	if err != nil {
		return "", err
	}
	var out strings.Builder
	if err := tmpl.Execute(&out, data); err != nil {
		return "", err
	}
	return out.String(), nil
}

// validatePrompt 在保存配置时校验模板：解析后用样例数据试渲染一次，
// 变量名拼错、花括号不配对这类问题在保存阶段就能拦住。
func validatePrompt(text string) error {
	_, err := renderPrompt(text, promptVariables("zh", time.Unix(0, 0)))
	return err
}

// transcriptTag 是包住识别原文的标签名。固定一个口述里不会出现的英文
// 标签，模型才能分清「待整理的文本」和「发给它自己的指令」。
const transcriptTag = "transcript"

// transcriptMessage 把原文包成 user 消息。外壳属于请求协议（要转义），
// 因此留在代码里；自然语言提示都在 prompts/*.tmpl。
func transcriptMessage(text string) string {
	return "<" + transcriptTag + ">\n" + escapeTranscriptClosers(text) + "\n</" + transcriptTag + ">"
}

// escapeTranscriptClosers 在原文出现闭合标签时插入反斜杠，避免原文提前
// 结束数据块。正常口述不会出现，只有粘贴代码之类的输入才会。
func escapeTranscriptClosers(text string) string {
	closing := "</" + transcriptTag
	lower := strings.ToLower(text)
	if !strings.Contains(lower, closing) {
		return text
	}
	var out strings.Builder
	offset := 0
	for {
		index := strings.Index(lower[offset:], closing)
		if index < 0 {
			break
		}
		index += offset
		// 保留 '<'，只在它后面插一个反斜杠，大小写与其余内容都不动。
		out.WriteString(text[offset : index+1])
		out.WriteByte('\\')
		offset = index + 1
	}
	out.WriteString(text[offset:])
	return out.String()
}
