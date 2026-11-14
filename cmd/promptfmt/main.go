// promptfmt 校验或重排提示词模板（backend/prompts/*.tmpl）。
//
// gofmt 覆盖不到模板文件，排版规则由 internal/promptfmt 定义：
//
//	go run ./cmd/promptfmt        # 校验，需要重排或有问题时退出码非 0
//	go run ./cmd/promptfmt -w     # 就地重排
package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"sort"

	"github.com/huangypx/shiyu/internal/promptfmt"
)

func main() {
	write := flag.Bool("w", false, "把重排结果写回文件")
	flag.Usage = func() {
		out := flag.CommandLine.Output()
		fmt.Fprintln(out, "用法: promptfmt [-w] [目录或文件...]，默认 backend/prompts")
		flag.PrintDefaults()
	}
	flag.Parse()

	targets := flag.Args()
	if len(targets) == 0 {
		targets = []string{"backend/prompts"}
	}
	files, err := collect(targets)
	if err != nil {
		fmt.Fprintln(os.Stderr, "promptfmt:", err)
		os.Exit(1)
	}

	blocked := false
	unformatted := false
	for _, file := range files {
		raw, err := os.ReadFile(file)
		if err != nil {
			fmt.Fprintln(os.Stderr, "promptfmt:", err)
			blocked = true
			continue
		}
		formatted, issues := promptfmt.Format(string(raw))
		for _, issue := range issues {
			fmt.Printf("%s:%d: %s\n", file, issue.Line, issue.Message)
			blocked = true
		}
		if formatted == string(raw) {
			continue
		}
		unformatted = true
		if !*write {
			continue
		}
		if err := os.WriteFile(file, []byte(formatted), 0o644); err != nil {
			fmt.Fprintln(os.Stderr, "promptfmt:", err)
			blocked = true
			continue
		}
		fmt.Println("已重排", file)
	}
	if blocked {
		os.Exit(1)
	}
	if unformatted && !*write {
		fmt.Println("有模板需要重排：运行 make prompts-format")
		os.Exit(1)
	}
}

// collect 展开命令行参数：目录取其中的 *.tmpl，文件原样收下。
func collect(targets []string) ([]string, error) {
	files := make([]string, 0, len(targets))
	for _, target := range targets {
		info, err := os.Stat(target)
		if err != nil {
			return nil, err
		}
		if !info.IsDir() {
			files = append(files, target)
			continue
		}
		matches, err := filepath.Glob(filepath.Join(target, "*.tmpl"))
		if err != nil {
			return nil, err
		}
		files = append(files, matches...)
	}
	sort.Strings(files)
	return files, nil
}
