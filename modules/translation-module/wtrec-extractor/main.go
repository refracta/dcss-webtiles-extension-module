package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"sync"
)

/* ─────────── A. 경로 설정 ─────────── */
const (
	localRoot = "../wtrec-downloader/wtrecs" // 입력 폴더
	tmpDir    = "units_tmp"                  // 중간 tmp
	outDir    = "output"                     // 결과 폴더
)

/* ─────────── B. 공통 유틸 ─────────── */
var invalid = regexp.MustCompile(`[<>:"/\\|?*]`)

func safeName(s string) string { return invalid.ReplaceAllString(s, "_") }

// 간단 토크나이저: <tag> 제거 후 텍스트만
var tagRE = regexp.MustCompile(`</?[a-z]+>`)

func tokenize(src string) []string {
	out := tagRE.ReplaceAllString(src, "\x00")
	parts := strings.Split(out, "\x00")
	res := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			res = append(res, p)
		}
	}
	return res
}

/* ─────────── C. processor 정의 ─────────── */
type processor struct {
	key     string
	match   func(map[string]any) bool
	extract func(map[string]any) []string
}

// JSON 헬퍼
func str(m map[string]any, k string) string {
	if v, ok := m[k]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}
func arr(m map[string]any, k string) []any {
	if v, ok := m[k]; ok {
		if a, ok := v.([]any); ok {
			return a
		}
	}
	return nil
}

// processor 전부 (14 개)
func processors() []processor {
	ps := []processor{
		// 1) msgs:messages[]
		{
			key: "msgs@messages[]",
			match: func(m map[string]any) bool {
				return str(m, "msg") == "msgs" && len(arr(m, "messages")) > 0
			},
			extract: func(m map[string]any) []string {
				var out []string
				for _, v := range arr(m, "messages") {
					if mm, ok := v.(map[string]any); ok {
						if t := str(mm, "text"); t != "" {
							out = append(out, t)
						}
					}
				}
				return out
			},
		},
		// 2) msgs:messages[]|tokenize
		{
			key: "msgs@messages[]#tokenize",
			match: func(m map[string]any) bool {
				return str(m, "msg") == "msgs" && len(arr(m, "messages")) > 0
			},
			extract: func(m map[string]any) []string {
				var out []string
				for _, v := range arr(m, "messages") {
					if mm, ok := v.(map[string]any); ok {
						if t := str(mm, "text"); t != "" {
							out = append(out, tokenize(t)...)
						}
					}
				}
				return out
			},
		},
		// 3) menu:items[]
		{
			key: "menu@items[]",
			match: func(m map[string]any) bool {
				return str(m, "msg") == "menu" && len(arr(m, "items")) > 0
			},
			extract: func(m map[string]any) []string {
				var out []string
				for _, v := range arr(m, "items") {
					if mm, ok := v.(map[string]any); ok {
						if t := str(mm, "text"); t != "" {
							out = append(out, t)
						}
					}
				}
				return out
			},
		},
	}

	// 4~6) ui-push 버튼(메인/서브) description·label
	addBtn := func(key, base, field string) {
		ps = append(ps, processor{
			key: key,
			match: func(m map[string]any) bool {
				if str(m, "msg") != "ui-push" {
					return false
				}
				if blk, ok := m[base].(map[string]any); ok {
					if btns, ok := blk["buttons"].([]any); ok {
						for _, v := range btns {
							if bb, ok := v.(map[string]any); ok && bb[field] != nil {
								return true
							}
						}
					}
				}
				return false
			},
			extract: func(m map[string]any) []string {
				var out []string
				if blk, ok := m[base].(map[string]any); ok {
					if btns, ok := blk["buttons"].([]any); ok {
						for _, v := range btns {
							if bb, ok := v.(map[string]any); ok {
								if s := str(bb, field); s != "" {
									out = append(out, s)
								}
							}
						}
					}
				}
				return out
			},
		})
	}
	addBtn("ui-push@main-items.buttons[].description", "main-items", "description")
	addBtn("ui-push@sub-items.buttons[].description", "sub-items", "description")
	addBtn("ui-push@sub-items.buttons[].label", "sub-items", "label")

	// 7) ui-push:main-items.buttons[].labels[]
	ps = append(ps, processor{
		key: "ui-push@main-items.buttons[].labels[]",
		match: func(m map[string]any) bool {
			if str(m, "msg") != "ui-push" {
				return false
			}
			if blk, ok := m["main-items"].(map[string]any); ok {
				if btns, ok := blk["buttons"].([]any); ok {
					for _, v := range btns {
						if bb, ok := v.(map[string]any); ok && bb["labels"] != nil {
							return true
						}
					}
				}
			}
			return false
		},
		extract: func(m map[string]any) []string {
			var out []string
			if blk, ok := m["main-items"].(map[string]any); ok {
				if btns, ok := blk["buttons"].([]any); ok {
					for _, v := range btns {
						if bb, ok := v.(map[string]any); ok {
							if ls, ok := bb["labels"].([]any); ok {
								for _, l := range ls {
									if s, ok := l.(string); ok {
										out = append(out, s)
									}
								}
							}
						}
					}
				}
			}
			return out
		},
	})

	// 8~12) ui-push 단일 필드
	for _, f := range []string{"title", "text", "body", "actions", "prompt"} {
		ff := f
		ps = append(ps, processor{
			key: "ui-push@" + ff,
			match: func(m map[string]any) bool {
				return str(m, "msg") == "ui-push" && m[ff] != nil
			},
			extract: func(m map[string]any) []string {
				return []string{str(m, ff)}
			},
		})
	}

	// 13) ui-state:text
	ps = append(ps, processor{
		key: "ui-state@text",
		match: func(m map[string]any) bool {
			return str(m, "msg") == "ui-state" && m["text"] != nil
		},
		extract: func(m map[string]any) []string { return []string{str(m, "text")} },
	})
	// 14) game_ended:message
	ps = append(ps, processor{
		key: "game_ended@message",
		match: func(m map[string]any) bool {
			return str(m, "msg") == "game_ended" && m["message"] != nil
		},
		extract: func(m map[string]any) []string { return []string{str(m, "message")} },
	})
	return ps
}

/* ─────────── D. tmp writer ─────────── */
type fileWriter struct {
	file   *os.File
	writer *bufio.Writer
}
type writerPool struct {
	mu   sync.Mutex
	open map[string]*fileWriter
}

func newWriterPool() *writerPool { return &writerPool{open: make(map[string]*fileWriter)} }
func (p *writerPool) write(key, val string) {
	p.mu.Lock()
	fw, ok := p.open[key]
	if !ok {
		f, _ := os.Create(filepath.Join(tmpDir, safeName(key)+".tmp"))
		fw = &fileWriter{file: f, writer: bufio.NewWriter(f)}
		p.open[key] = fw
	}
	if enc, err := json.Marshal(val); err == nil {
		fw.writer.Write(enc)
		fw.writer.WriteByte('\n')
	}
	p.mu.Unlock()
}
func (p *writerPool) closeAll() {
	p.mu.Lock()
	defer p.mu.Unlock()
	for _, fw := range p.open {
		fw.writer.Flush()
		fw.file.Close()
	}
}

/* ─────────── E. JSON 파일 처리 ─────────── */
func processFile(path string, procs []processor, pool *writerPool) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()

	var doc struct {
		Data []json.RawMessage `json:"data"`
	}
	if err := json.NewDecoder(f).Decode(&doc); err != nil {
		return err
	}
	for _, raw := range doc.Data {
		var m map[string]any
		if json.Unmarshal(raw, &m) != nil {
			continue
		}
		for _, p := range procs {
			if p.match(m) {
				for _, s := range p.extract(m) {
					if s != "" {
						pool.write(p.key, s)
					}
				}
			}
		}
	}
	return nil
}

/* ─────────── F. tmp → 정렬·중복 → 저장 ─────────── */
func sortUniq(lines []string) []string {
	sort.Strings(lines)
	out := make([]string, 0, len(lines))
	var prev string
	for _, l := range lines {
		if l != prev {
			out = append(out, l)
			prev = l
		}
	}
	return out
}
func flushTmp(parallel int) error {
	_ = os.MkdirAll(outDir, 0o755)

	ents, _ := os.ReadDir(tmpDir)
	sem := make(chan struct{}, parallel)
	var wg sync.WaitGroup

	for _, ent := range ents {
		if ent.IsDir() || !strings.HasSuffix(ent.Name(), ".tmp") {
			continue
		}
		ent := ent
		wg.Add(1)
		sem <- struct{}{}
		go func() {
			defer wg.Done()
			tmpPath := filepath.Join(tmpDir, ent.Name())
			f, err := os.Open(tmpPath)
			if err != nil {
				fmt.Println("⚠", err)
				<-sem
				return
			}
			var lines []string
			sc := bufio.NewScanner(f)
			for sc.Scan() {
				lines = append(lines, strings.TrimSpace(sc.Text()))
			}
			f.Close()

			lines = sortUniq(lines)
			outPath := filepath.Join(outDir, strings.TrimSuffix(ent.Name(), ".tmp")+".json")
			of, _ := os.Create(outPath)
			w := bufio.NewWriter(of)
			w.WriteString("[\n")
			for i, l := range lines {
				if i > 0 {
					w.WriteString(",\n")
				}
				w.WriteString("  " + l)
			}
			w.WriteString("\n]\n")
			w.Flush()
			of.Close()
			fmt.Printf("✅  %s (%d)\n", outPath, len(lines))
			<-sem
		}()
	}
	wg.Wait()
	return nil
}

/* ─────────── G. main ─────────── */
func main() {
	_ = os.MkdirAll(tmpDir, 0o755)

	// 1) 입력 파일 탐색
	var files []string
	filepath.WalkDir(localRoot, func(p string, d fs.DirEntry, err error) error {
		if err == nil && !d.IsDir() && strings.HasSuffix(d.Name(), ".json") {
			files = append(files, p)
		}
		return nil
	})
	if len(files) == 0 {
		fmt.Println("⚠  no json under", localRoot)
		return
	}
	sort.Strings(files)
	fmt.Printf("📄 %d files found\n", len(files))

	// 2) 병렬 파싱
	procs := processors()
	pool := newWriterPool()

	maxParse := runtime.NumCPU() * 4
	sem := make(chan struct{}, maxParse)
	var wg sync.WaitGroup

	for _, f := range files {
		f := f
		wg.Add(1)
		sem <- struct{}{}
		go func() {
			if err := processFile(f, procs, pool); err != nil {
				fmt.Println("⚠", err)
			}
			wg.Done()
			<-sem
		}()
	}
	wg.Wait()
	pool.closeAll()

	// 3) tmp → 결과
	if err := flushTmp(runtime.NumCPU() * 2); err != nil {
		fmt.Println("❌", err)
	}
	fmt.Println("🥳  done")
}
