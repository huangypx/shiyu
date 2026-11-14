package backend

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"path"
	"strings"
	"time"
)

// TranscriptRequest 描述一次交给 ASR 服务商的音频负载。
type TranscriptRequest struct {
	Audio    []byte
	Filename string
	MimeType string
	Language string
	Prompt   string
	// Stream 请求服务商以 SSE 返回结果；仅对话接口支持，其余模式
	// 会忽略它。
	Stream bool
	// OnDelta 在流式返回时收到累计文本（不是增量），因此丢帧只会
	// 让界面晚一拍，不会拼错。为 nil 时不启用流式。
	OnDelta func(text string)
}

type TranscriptResult struct {
	Text string `json:"text"`
	// Call 携带产出这段文本的那次调用的耗时与 token 用量，失败
	// 的调用同样记录。
	Call CallRecord `json:"call"`
}

type ASRProvider interface {
	Transcribe(context.Context, TranscriptRequest) (TranscriptResult, error)
}

// PolishRequest 包含待整理文本，以及给整理模型的可选指令。
// SystemPrompt 是解析出的预设提示词；为空时 provider 依次回落到
// 配置里的 systemPrompt 和内置默认值。
type PolishRequest struct {
	// Text 是原始识别文本；provider 会把它包进 <transcript> 标签，
	// 作为 user 消息发送，避免被当成指令执行。
	Text         string
	Instructions string
	Language     string
	SystemPrompt string
	// ConfiguredPrompt 是配置里的兜底提示词；SystemPrompt 为空时
	// 由它接手，两者都没有才回落到内置默认值。
	ConfiguredPrompt string
}

// PolishResult 是整理后的文本，外加产出该结果的
// 那次调用记录。
type PolishResult struct {
	Text string     `json:"text"`
	Call CallRecord `json:"call"`
}

type LLMProvider interface {
	Polish(context.Context, PolishRequest) (PolishResult, error)
}

// HTTPError 保留服务商的状态码和截断后的响应体，让界面能给出
// 有用的错误信息，又不会把任意大的负载留在内存里。
type HTTPError struct {
	StatusCode int    `json:"statusCode"`
	Status     string `json:"status"`
	Body       string `json:"body"`
}

func (e *HTTPError) Error() string {
	if e.Body == "" {
		return fmt.Sprintf("provider returned %s", e.Status)
	}
	return fmt.Sprintf("provider returned %s: %s", e.Status, e.Body)
}

type openAIClient struct {
	baseURL string
	apiKey  string
	http    *http.Client
}

func newOpenAIClient(baseURL, apiKey string, httpClient *http.Client) (*openAIClient, error) {
	baseURL = strings.TrimSpace(baseURL)
	if baseURL == "" {
		return nil, errors.New("provider base URL is empty")
	}
	u, err := url.Parse(baseURL)
	if err != nil || u.Scheme == "" || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
		return nil, fmt.Errorf("invalid provider base URL %q", baseURL)
	}
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 2 * time.Minute}
	}
	return &openAIClient{baseURL: strings.TrimRight(baseURL, "/"), apiKey: apiKey, http: httpClient}, nil
}

func (c *openAIClient) endpoint(endpoint string) string {
	u, err := url.Parse(c.baseURL)
	if err != nil {
		return c.baseURL + "/" + endpoint
	}
	// base URL 可能带 /v1 前缀；替换已经是完整端点的路径
	// 时保留该前缀。
	if strings.HasSuffix(strings.TrimRight(u.Path, "/"), "/"+endpoint) {
		return c.baseURL
	}
	return c.baseURL + "/" + endpoint
}

// httpResult 记录一次请求往返的传输事实。
// 即使请求失败也会填写，因此失败的调用仍能报告
// 状态码和耗时。
type httpResult struct {
	Body          []byte
	StatusCode    int
	Status        string
	Duration      time.Duration
	ResponseBytes int
	RequestID     string
}

// finish 把传输事实复制到调用记录上。
func (r *CallRecord) finish(res httpResult, err error) {
	r.DurationMS = res.Duration.Milliseconds()
	r.StatusCode = res.StatusCode
	r.RequestID = res.RequestID
	r.ResponseBytes = res.ResponseBytes
	r.OK = err == nil
	if err != nil {
		r.Error = truncate(err.Error(), maxErrorBytes)
	}
}

func (c *openAIClient) do(req *http.Request) (httpResult, error) {
	if c.apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.apiKey)
	}
	started := time.Now()
	resp, err := c.http.Do(req)
	if err != nil {
		return httpResult{Duration: time.Since(started)}, fmt.Errorf("provider request: %w", err)
	}
	defer resp.Body.Close()
	body, readErr := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	result := httpResult{
		Body:          body,
		StatusCode:    resp.StatusCode,
		Status:        resp.Status,
		Duration:      time.Since(started),
		ResponseBytes: len(body),
		RequestID:     responseRequestID(resp.Header),
	}
	if readErr != nil {
		return result, fmt.Errorf("read provider response: %w", readErr)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return result, &HTTPError{StatusCode: resp.StatusCode, Status: resp.Status, Body: strings.TrimSpace(string(body))}
	}
	return result, nil
}

// isEventStream 判断响应是不是 SSE。多数网关会照 `stream` 参数
// 返回事件流，但也有网关直接忽略它回一份完整 JSON。
func isEventStream(contentType string) bool {
	return strings.Contains(strings.ToLower(contentType), "text/event-stream")
}

// ssePayload 从一行 SSE 文本里取出 data 字段。注释行、event 行与
// 空行按协议跳过。
func ssePayload(line []byte) ([]byte, bool) {
	line = bytes.TrimRight(line, "\r")
	if !bytes.HasPrefix(line, []byte("data:")) {
		return nil, false
	}
	payload := bytes.TrimSpace(line[len("data:"):])
	if len(payload) == 0 {
		return nil, false
	}
	return payload, true
}

// doEventStream 以事件流的方式读取响应。返回的 streamed 为 false
// 表示服务商没有按事件流作答（或状态码非 2xx），此时 body 已经
// 读完，调用方应按普通 JSON 处理，从而做到「开了流式也不会坏」。
func (c *openAIClient) doEventStream(req *http.Request, onEvent func([]byte) error) (httpResult, bool, error) {
	if c.apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.apiKey)
	}
	req.Header.Set("Accept", "text/event-stream")
	started := time.Now()
	resp, err := c.http.Do(req)
	if err != nil {
		return httpResult{Duration: time.Since(started)}, false, fmt.Errorf("provider request: %w", err)
	}
	defer resp.Body.Close()
	result := httpResult{
		StatusCode: resp.StatusCode,
		Status:     resp.Status,
		RequestID:  responseRequestID(resp.Header),
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
		result.Body = body
		result.ResponseBytes = len(body)
		result.Duration = time.Since(started)
		return result, false, &HTTPError{StatusCode: resp.StatusCode, Status: resp.Status, Body: strings.TrimSpace(string(body))}
	}
	if !isEventStream(resp.Header.Get("Content-Type")) {
		body, readErr := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
		result.Body = body
		result.ResponseBytes = len(body)
		result.Duration = time.Since(started)
		if readErr != nil {
			return result, false, fmt.Errorf("read provider response: %w", readErr)
		}
		return result, false, nil
	}
	read := 0
	scanner := bufio.NewScanner(resp.Body)
	// 单条事件可能远大于默认的 64KB 行缓冲，放宽到与整体响应同样的上限。
	scanner.Buffer(make([]byte, 0, 64<<10), 4<<20)
	for scanner.Scan() {
		line := scanner.Bytes()
		read += len(line) + 1
		payload, ok := ssePayload(line)
		if !ok {
			continue
		}
		if string(payload) == "[DONE]" {
			break
		}
		if err := onEvent(payload); err != nil {
			result.ResponseBytes = read
			result.Duration = time.Since(started)
			return result, true, err
		}
	}
	result.ResponseBytes = read
	result.Duration = time.Since(started)
	if err := scanner.Err(); err != nil {
		return result, true, fmt.Errorf("read provider stream: %w", err)
	}
	return result, true, nil
}

// chatStreamChunk 是对话接口在流式模式下的一个分块。不同网关会把
// 用量和结束原因放在同一块或最后一块里，因此每个字段都按可选处理。
type chatStreamChunk struct {
	ID      string          `json:"id"`
	Usage   json.RawMessage `json:"usage"`
	Choices []struct {
		Delta struct {
			Content string `json:"content"`
		} `json:"delta"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
}

// noTextError 用服务商实际返回的细节解释空回答，
// 从而区分“回答被截断”与“模型什么都没说”
// 这两种情况。
func noTextError(kind string, call CallRecord) error {
	message := kind + " response contained no text"
	details := make([]string, 0, 2)
	if call.FinishReason != "" {
		details = append(details, "finish_reason="+call.FinishReason)
	}
	if call.Usage.ReasoningTokens > 0 {
		details = append(details, fmt.Sprintf("reasoning_tokens=%d", call.Usage.ReasoningTokens))
	}
	if len(details) == 0 {
		return errors.New(message)
	}
	return fmt.Errorf("%s (%s)", message, strings.Join(details, ", "))
}

// markFailed 在传输层成功但结果不可用时把记录标记为失败，
// 例如解码出错或回答为空。
func markFailed(record *CallRecord, err error) {
	record.OK = false
	record.Error = truncate(err.Error(), maxErrorBytes)
}

func responseRequestID(header http.Header) string {
	for _, key := range []string{"X-Request-Id", "Request-Id", "Openai-Request-Id"} {
		if value := strings.TrimSpace(header.Get(key)); value != "" {
			return value
		}
	}
	return ""
}

// OpenAICompatibleASR 以 multipart/form-data 请求 /audio/transcriptions。
type OpenAICompatibleASR struct {
	client   *openAIClient
	provider string
	model    string
	mode     string
	// stream 只在对话接口下打开：转写接口对 stream 的支持各网关
	// 差异太大，统一按阻塞式处理。
	stream bool
}

func NewOpenAICompatibleASR(cfg ASRConfig, httpClient *http.Client) (*OpenAICompatibleASR, error) {
	client, err := newOpenAIClient(cfg.BaseURL, cfg.APIKey, httpClient)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(cfg.Model) == "" {
		return nil, errors.New("asr model is empty")
	}
	mode := cfg.NormalizedASRMode()
	return &OpenAICompatibleASR{
		client:   client,
		provider: cfg.Provider,
		model:    cfg.Model,
		mode:     mode,
		stream:   cfg.Stream && mode == ASRModeChat,
	}, nil
}

// Transcribe 无论成功与否都会记录一次调用；返回结果总带着这条
// 记录，界面因此能展示耗时和 token 用量。
func (p *OpenAICompatibleASR) Transcribe(ctx context.Context, req TranscriptRequest) (TranscriptResult, error) {
	call := newCallRecord(CallKindASR, p.provider, p.model)
	call.Mode = p.mode
	call.RequestBytes = len(req.Audio)
	call.AudioSeconds = wavDurationSeconds(req.Audio)
	if len(req.Audio) == 0 {
		err := errors.New("audio is empty")
		call.finish(httpResult{}, err)
		return TranscriptResult{Call: call}, err
	}
	if p.mode == ASRModeChat {
		return p.transcribeViaChat(ctx, req, call)
	}
	return p.transcribeViaTranscriptions(ctx, req, call)
}

// transcribeViaTranscriptions 把音频以 multipart 形式发到 Whisper 风格
// 端点，OpenAI 和多数 OpenAI 兼容网关都使用这种接口。
func (p *OpenAICompatibleASR) transcribeViaTranscriptions(ctx context.Context, req TranscriptRequest, call CallRecord) (TranscriptResult, error) {
	call.Endpoint = sanitizeEndpoint(p.client.endpoint("audio/transcriptions"))
	filename := req.Filename
	if filename == "" {
		filename = "recording.webm"
	}
	mimeType := req.MimeType
	if mimeType == "" {
		mimeType = "audio/webm"
	}
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	header := make(textproto.MIMEHeader)
	// 绝不能让界面传来的文件名里的 CR/LF 或引号改写
	// multipart 头部。
	safeFilename := strings.NewReplacer(`"`, "", "\r", "", "\n", "").Replace(filename)
	header.Set("Content-Disposition", fmt.Sprintf(`form-data; name="file"; filename="%s"`, safeFilename))
	header.Set("Content-Type", mimeType)
	part, err := form.CreatePart(header)
	if err != nil {
		return TranscriptResult{}, fmt.Errorf("create audio form: %w", err)
	}
	if _, err := part.Write(req.Audio); err != nil {
		return TranscriptResult{}, fmt.Errorf("write audio form: %w", err)
	}
	if err := form.WriteField("model", p.model); err != nil {
		return TranscriptResult{}, fmt.Errorf("write model form: %w", err)
	}
	if req.Language != "" {
		if err := form.WriteField("language", req.Language); err != nil {
			return TranscriptResult{}, fmt.Errorf("write language form: %w", err)
		}
	}
	if req.Prompt != "" {
		if err := form.WriteField("prompt", req.Prompt); err != nil {
			return TranscriptResult{}, fmt.Errorf("write prompt form: %w", err)
		}
	}
	if err := form.Close(); err != nil {
		return TranscriptResult{}, fmt.Errorf("close audio form: %w", err)
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, p.client.endpoint("audio/transcriptions"), &body)
	if err != nil {
		return TranscriptResult{}, fmt.Errorf("create transcription request: %w", err)
	}
	httpReq.Header.Set("Content-Type", form.FormDataContentType())
	raw, err := p.client.do(httpReq)
	call.finish(raw, err)
	if err != nil {
		return TranscriptResult{Call: call}, err
	}
	var response struct {
		ID        string          `json:"id"`
		Text      string          `json:"text"`
		Usage     json.RawMessage `json:"usage"`
		ElapsedMS int64           `json:"elapsed_ms"`
	}
	if err := json.Unmarshal(raw.Body, &response); err != nil {
		decodeErr := fmt.Errorf("decode transcription response: %w", err)
		markFailed(&call, decodeErr)
		return TranscriptResult{Call: call}, decodeErr
	}
	call.ResponseID = strings.TrimSpace(response.ID)
	call.Usage = parseUsage(response.Usage)
	call.ServerMS = response.ElapsedMS
	return TranscriptResult{Text: strings.TrimSpace(response.Text), Call: call}, nil
}

// transcribeViaChat 把音频作为聊天消息里的 input_audio 片段发送。
// 多模态聊天模型就是用这种方式暴露语音识别能力，而不是
// 提供专门的转写接口。
func (p *OpenAICompatibleASR) transcribeViaChat(ctx context.Context, req TranscriptRequest, call CallRecord) (TranscriptResult, error) {
	call.Endpoint = sanitizeEndpoint(p.client.endpoint("chat/completions"))
	format, ok := audioContainerFormat(req.MimeType, req.Filename)
	if !ok {
		formatErr := fmt.Errorf(
			"chat ASR needs wav or mp3 audio, got %q",
			firstNonEmpty(req.MimeType, req.Filename, "unknown"),
		)
		call.finish(httpResult{}, formatErr)
		return TranscriptResult{Call: call}, formatErr
	}
	payload := map[string]any{
		"model": p.model,
		"messages": []any{map[string]any{
			"role": "user",
			"content": []any{map[string]any{
				"type": "input_audio",
				"input_audio": map[string]any{
					"data":   base64.StdEncoding.EncodeToString(req.Audio),
					"format": format,
				},
			}},
		}},
	}
	// 流式只改变结果的读取方式：音频依旧整段上传一次，因此识别
	// 内容与非流式逐字相同，不存在切分带来的歧义。
	streaming := p.stream && req.OnDelta != nil
	if streaming {
		payload["stream"] = true
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return TranscriptResult{}, fmt.Errorf("encode chat transcription request: %w", err)
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, p.client.endpoint("chat/completions"), bytes.NewReader(body))
	if err != nil {
		return TranscriptResult{}, fmt.Errorf("create chat transcription request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	call.RequestBytes = len(body)
	if !streaming {
		raw, err := p.client.do(httpReq)
		call.finish(raw, err)
		if err != nil {
			return TranscriptResult{Call: call}, err
		}
		return decodeChatTranscript(raw, call)
	}
	accumulator := &chatStreamAccumulator{}
	raw, streamed, err := p.client.doEventStream(httpReq, func(event []byte) error {
		accumulator.consume(event, req.OnDelta)
		return nil
	})
	call.finish(raw, err)
	if err != nil {
		return TranscriptResult{Call: call}, err
	}
	if !streamed {
		// 网关忽略了 stream 参数，直接把完整结果写成普通 JSON。
		return decodeChatTranscript(raw, call)
	}
	call.ResponseID = accumulator.responseID
	call.Usage = parseUsage(accumulator.usage)
	call.FinishReason = accumulator.finishReason
	return TranscriptResult{Text: strings.TrimSpace(accumulator.body.String()), Call: call}, nil
}

// chatStreamAccumulator 累积流式分块里的正文、用量与结束原因；
// 空文本的判定留给服务层，两条路径因此共用同一套错误说明。
type chatStreamAccumulator struct {
	body         strings.Builder
	responseID   string
	usage        json.RawMessage
	finishReason string
}

// consume 解析一块 SSE 负载。单块解码失败按协议噪声处理：宁可少
// 一帧，也不要因为网关多写了一个字段就让整次识别失败。
func (a *chatStreamAccumulator) consume(event []byte, onDelta func(string)) {
	var chunk chatStreamChunk
	if err := json.Unmarshal(event, &chunk); err != nil {
		return
	}
	if id := strings.TrimSpace(chunk.ID); id != "" {
		a.responseID = id
	}
	if len(chunk.Usage) > 0 && string(chunk.Usage) != "null" {
		a.usage = chunk.Usage
	}
	if len(chunk.Choices) == 0 {
		return
	}
	choice := chunk.Choices[0]
	if reason := strings.TrimSpace(choice.FinishReason); reason != "" {
		a.finishReason = reason
	}
	if choice.Delta.Content == "" {
		return
	}
	a.body.WriteString(choice.Delta.Content)
	if onDelta == nil {
		return
	}
	if text := strings.TrimSpace(a.body.String()); text != "" {
		onDelta(text)
	}
}

// decodeChatTranscript 解析阻塞式的聊天补全响应；流式路径在网关
// 无视 stream 参数时也走这里。
func decodeChatTranscript(raw httpResult, call CallRecord) (TranscriptResult, error) {
	var response struct {
		ID        string          `json:"id"`
		ElapsedMS int64           `json:"elapsed_ms"`
		Usage     json.RawMessage `json:"usage"`
		Choices   []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
			FinishReason string `json:"finish_reason"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(raw.Body, &response); err != nil {
		decodeErr := fmt.Errorf("decode chat transcription response: %w", err)
		markFailed(&call, decodeErr)
		return TranscriptResult{Call: call}, decodeErr
	}
	call.ResponseID = strings.TrimSpace(response.ID)
	call.Usage = parseUsage(response.Usage)
	call.ServerMS = response.ElapsedMS
	if len(response.Choices) == 0 {
		emptyErr := errors.New("chat transcription returned no choices")
		markFailed(&call, emptyErr)
		return TranscriptResult{Call: call}, emptyErr
	}
	call.FinishReason = strings.TrimSpace(response.Choices[0].FinishReason)
	return TranscriptResult{Text: strings.TrimSpace(response.Choices[0].Message.Content), Call: call}, nil
}

// audioContainerFormat 按服务商在 input_audio 片段中期望的写法
// 命名容器格式；聊天接口只接受 wav 和 mp3。
func audioContainerFormat(mimeType, filename string) (string, bool) {
	base := strings.ToLower(strings.TrimSpace(strings.Split(mimeType, ";")[0]))
	switch base {
	case "audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave":
		return "wav", true
	case "audio/mpeg", "audio/mp3":
		return "mp3", true
	}
	switch strings.ToLower(path.Ext(filename)) {
	case ".wav":
		return "wav", true
	case ".mp3":
		return "mp3", true
	}
	return "", false
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

// OpenAICompatibleLLM 调用 /chat/completions 并取出第一个 choice。
// 兜底提示词不放在这里：它属于配置里的 section，切换模型时不该
// 连带换掉用户写的提示词。
type OpenAICompatibleLLM struct {
	client      *openAIClient
	provider    string
	model       string
	temperature float64
}

func NewOpenAICompatibleLLM(cfg LLMConfig, httpClient *http.Client) (*OpenAICompatibleLLM, error) {
	client, err := newOpenAIClient(cfg.BaseURL, cfg.APIKey, httpClient)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(cfg.Model) == "" {
		return nil, errors.New("llm model is empty")
	}
	return &OpenAICompatibleLLM{client: client, provider: cfg.Provider, model: cfg.Model, temperature: cfg.Temperature}, nil
}

func (p *OpenAICompatibleLLM) Polish(ctx context.Context, req PolishRequest) (PolishResult, error) {
	call := newCallRecord(CallKindLLM, p.provider, p.model)
	call.Endpoint = sanitizeEndpoint(p.client.endpoint("chat/completions"))
	if strings.TrimSpace(req.Text) == "" {
		err := errors.New("text is empty")
		call.finish(httpResult{}, err)
		return PolishResult{Call: call}, err
	}
	system := polishSystemPrompt(req.SystemPrompt, req.ConfiguredPrompt, req.Language)
	if req.Instructions != "" {
		system += " Additional instructions: " + req.Instructions
	}
	// 守卫句永远排在最后：原文只是待整理的数据，口述里的请求、问题、
	// 命令都不该被执行。
	system += " " + transcriptGuard
	payload := struct {
		Model       string        `json:"model"`
		Messages    []chatMessage `json:"messages"`
		Temperature float64       `json:"temperature,omitempty"`
	}{
		Model: p.model,
		// 原文包进固定标签：裸文本会被模型当成对话指令执行。
		Messages:    []chatMessage{{Role: "system", Content: system}, {Role: "user", Content: transcriptMessage(req.Text)}},
		Temperature: p.temperature,
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		encodeErr := fmt.Errorf("encode polish request: %w", err)
		call.finish(httpResult{}, encodeErr)
		return PolishResult{Call: call}, encodeErr
	}
	call.RequestBytes = len(encoded)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, p.client.endpoint("chat/completions"), bytes.NewReader(encoded))
	if err != nil {
		requestErr := fmt.Errorf("create polish request: %w", err)
		call.finish(httpResult{}, requestErr)
		return PolishResult{Call: call}, requestErr
	}
	httpReq.Header.Set("Content-Type", "application/json")
	raw, err := p.client.do(httpReq)
	call.finish(raw, err)
	if err != nil {
		return PolishResult{Call: call}, err
	}
	var response struct {
		ID        string          `json:"id"`
		ElapsedMS int64           `json:"elapsed_ms"`
		Usage     json.RawMessage `json:"usage"`
		Choices   []struct {
			Message struct {
				Content json.RawMessage `json:"content"`
			} `json:"message"`
			FinishReason string `json:"finish_reason"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(raw.Body, &response); err != nil {
		decodeErr := fmt.Errorf("decode polish response: %w", err)
		markFailed(&call, decodeErr)
		return PolishResult{Call: call}, decodeErr
	}
	call.ResponseID = strings.TrimSpace(response.ID)
	call.Usage = parseUsage(response.Usage)
	call.ServerMS = response.ElapsedMS
	if len(response.Choices) > 0 {
		call.FinishReason = strings.TrimSpace(response.Choices[0].FinishReason)
	}
	if len(response.Choices) == 0 {
		emptyErr := noTextError("polish", call)
		markFailed(&call, emptyErr)
		return PolishResult{Call: call}, emptyErr
	}
	text, err := decodeMessageContent(response.Choices[0].Message.Content)
	if err != nil {
		markFailed(&call, err)
		return PolishResult{Call: call}, err
	}
	if strings.TrimSpace(text) == "" {
		emptyErr := noTextError("polish", call)
		markFailed(&call, emptyErr)
		return PolishResult{Call: call}, emptyErr
	}
	return PolishResult{Text: strings.TrimSpace(text), Call: call}, nil
}

// polishSystemPrompt 组装真正发给模型的 system 消息。提示词优先级为
// 预设 → provider 配置 → 内置默认值，因此预设为空时行为与旧版本一致。
// 选中的文本按 text/template 渲染，模板里可以写 {{ .language }} 这类
// 变量；模板完全没提到语言时在末尾补一句英文，保持旧版行为。
func polishSystemPrompt(presetPrompt, configuredPrompt, language string) string {
	text := strings.TrimSpace(firstNonEmpty(presetPrompt, configuredPrompt, defaultSystemPrompt))
	data := promptVariables(language, time.Now())
	system, err := renderPrompt(text, data)
	if err != nil {
		// 手改坏的历史配置不该让整理整体失败：退回原文按纯文本发送。
		// 新写的模板错误由保存配置时的校验拦住。
		system = text
	}
	// 模板提到 .language 或 .languageCode，说明语言要求由用户自己安排；
	// 两个都没提时才追加，避免同一句话被说两遍。
	if !strings.Contains(text, ".language") {
		if code := data["languageCode"]; code != "" {
			system += " Return the result in " + code + "."
		}
	}
	return strings.TrimSpace(system)
}

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

func decodeMessageContent(raw json.RawMessage) (string, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return "", nil
	}
	var text string
	if raw[0] == '"' {
		if err := json.Unmarshal(raw, &text); err != nil {
			return "", fmt.Errorf("decode polish content: %w", err)
		}
		return text, nil
	}
	// 部分 OpenAI 兼容网关会返回多模态的 content 片段。
	var parts []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	if err := json.Unmarshal(raw, &parts); err != nil {
		return "", fmt.Errorf("decode polish content: %w", err)
	}
	var result strings.Builder
	for _, part := range parts {
		if part.Type == "text" || part.Type == "" {
			result.WriteString(part.Text)
		}
	}
	return result.String(), nil
}

// endpointPath 供需要在诊断中查看服务商 URL 的调用方使用，
// 且不会暴露凭据。
func endpointPath(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	return path.Clean(u.Path)
}
