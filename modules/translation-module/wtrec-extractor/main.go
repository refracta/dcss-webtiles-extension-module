// go:build 1.22
// main.go  – DSL-driven extractor + hooks (TRANAPP)
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
	"sync/atomic"
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

// HTML 태그 제거용 간단 토크나이저
var tagRE = regexp.MustCompile(`</?[a-z]+>`)

func tokenize(src string) []string {
	out := tagRE.ReplaceAllString(src, "\x00")
	parts := strings.Split(out, "\x00")
	res := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			res = append(res, p)
		}
	}
	return res
}

/* ─────────── C. DSL & 훅 구현 ─────────── */

type pathSeg struct {
	key        string
	isArray    bool
	isObjArray bool
}

type processor struct {
	key     string
	msgType string
	path    []pathSeg
	option  string
	extract func(map[string]any) []string
	match   func(map[string]any) bool
}

/* ---- 1) 훅 정의 ---- */

type hookFn func(string) []string

var (
	hookTokenize hookFn = func(s string) []string { return tokenize(s) }

	hookQuoteRE        = regexp.MustCompile(`(?s)_{10,}\n\n<.+?>(.+?)\n<.+?>`)
	hookQuote   hookFn = func(s string) []string {
		if m := hookQuoteRE.FindStringSubmatch(s); len(m) == 2 {
			return []string{m[1]}
		}
		return nil
	}

	hookLines hookFn = func(s string) []string { return strings.Split(s, "\n") }

	hooks = map[string]hookFn{
		"tokenize": hookTokenize,
		"quote":    hookQuote,
		"lines":    hookLines,
	}
)

/* ---- 2) DSL 파서 ---- */

func parseSpec(spec string) (msgType string, path []pathSeg, option string) {
	headTail := strings.SplitN(spec, "@", 2)
	msgType, tail := headTail[0], headTail[1]

	pathPart := tail
	if i := strings.Index(tail, "#"); i != -1 {
		pathPart, option = tail[:i], tail[i+1:]
	}

	for _, seg := range strings.Split(pathPart, ".") {
		ps := pathSeg{key: seg}
		switch {
		case strings.HasSuffix(seg, "[]"):
			ps.key, ps.isArray = seg[:len(seg)-2], true
		case strings.HasSuffix(seg, "[o]"):
			ps.key, ps.isArray, ps.isObjArray = seg[:len(seg)-3], true, true
		}
		path = append(path, ps)
	}
	return
}

/* ---- 3) 값 수집 ---- */

func collectValues(node any, path []pathSeg) []any {
	if node == nil {
		return nil
	}
	if len(path) == 0 {
		return []any{node}
	}
	seg, rest := path[0], path[1:]

	m, ok := node.(map[string]any)
	if !ok {
		return nil
	}
	child, ok := m[seg.key]
	if !ok {
		return nil
	}

	var nextNodes []any
	switch {
	case seg.isArray && seg.isObjArray:
		if objArr, ok := child.(map[string]any); ok {
			for _, v := range objArr {
				nextNodes = append(nextNodes, v)
			}
		}
	case seg.isArray:
		if arr, ok := child.([]any); ok {
			nextNodes = append(nextNodes, arr...)
		}
	default:
		nextNodes = []any{child}
	}

	var out []any
	for _, n := range nextNodes {
		out = append(out, collectValues(n, rest)...)
	}
	return out
}

/* ---- 4) Processor 팩토리 ---- */

func makeProcessor(spec string) processor {
	msgType, path, option := parseSpec(spec)
	hook := hooks[option]

	return processor{
		key:     spec,
		msgType: msgType,
		path:    path,
		option:  option,
		match: func(m map[string]any) bool {
			return m["msg"] == msgType && len(collectValues(m, path)) > 0
		},
		extract: func(m map[string]any) []string {
			vals := collectValues(m, path)
			var out []string
			for _, v := range vals {
				if s, ok := v.(string); ok && s != "" {
					if hook != nil {
						out = append(out, hook(s)...)
					} else {
						out = append(out, s)
					}
				}
			}
			return out
		},
	}
}

/* ---- 5) 전체 스펙 → processors ---- */

func processors() []processor {
	specs := []string{
		"game_ended@message",
		"map@cells[].mon.name",
		"map@cells[].mon.plural",
		"menu@alt_more",
		"menu@items[].text",
		"menu@more",
		"menu@title.text",
		"msgs@messages[].text",
		"msgs@messages[].text#tokenize",
		"player@god",
		"player@inv[o].inscription",
		"player@inv[o].name",
		"player@inv[o].qty_field",
		"player@inv[o].action_verb",
		"player@place",
		"player@quiver_desc",
		"player@species",
		"player@status[].desc",
		"player@status[].light",
		"player@status[].text",
		"player@title",
		"player@unarmed_attack",
		"txt@lines[o]",
		"ui-push@actions",
		"ui-push@body",
		"ui-push@body#quote",
		"ui-push@body#lines",
		"ui-push@highlight",
		"ui-push@main-items.buttons[].description",
		"ui-push@main-items.buttons[].labels[]",
		"ui-push@main-items.labels[].label",
		"ui-push@more",
		"ui-push@prompt",
		"ui-push@quote",
		"ui-push@spellset[].label",
		"ui-push@spellset[].spells[].effect",
		"ui-push@spellset[].spells[].letter",
		"ui-push@spellset[].spells[].range_string",
		"ui-push@spellset[].spells[].schools",
		"ui-push@spellset[].spells[].title",
		"ui-push@sub-items.buttons[].description",
		"ui-push@sub-items.buttons[].label",
		"ui-push@text",
		"ui-push@text#lines",
		"ui-push@text#tokenize",
		"ui-push@title",
		"ui-push@feats[].title",
		"ui-push@teats[].body",
		"ui-state@highlight",
		"ui-state@text",
		"update_menu@alt_more",
		"update_menu@more",
		"update_menu@title.text",
		"update_menu_items@items[].text",
		"init_input@prompt",
		"version@text",
	}

	ps := make([]processor, 0, len(specs))
	for _, s := range specs {
		ps = append(ps, makeProcessor(s))
	}
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
					pool.write(p.key, s)
				}
			}
		}
	}
	return nil
}

/* ─────────── F. tmp → 중복 제거·정렬 → 저장 ─────────── */

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

	/* 1) 입력 파일 스캔 */
	var files []string
	filepath.WalkDir(localRoot, func(p string, d fs.DirEntry, err error) error {
		if err == nil && !d.IsDir() && strings.HasSuffix(d.Name(), ".json") {
			files = append(files, p)
		}
		return nil
	})
	total := len(files)
	if total == 0 {
		fmt.Println("⚠  no json under", localRoot)
		return
	}
	sort.Strings(files)
	fmt.Printf("📄 %d files found\n", total)

	/* 2) 병렬 파싱 */
	procs := processors()
	pool := newWriterPool()

	maxParse := runtime.NumCPU() * 4
	sem := make(chan struct{}, maxParse)
	var wg sync.WaitGroup

	var done int32 // <= 처리된 파일 수

	logProgress := func() {
		d := atomic.AddInt32(&done, 1)     // 완료 개수
		if d%100 == 0 || int(d) == total { // 100개마다 또는 끝에서만
			fmt.Printf("   … %d / %d done  (%d remaining)\n",
				d, total, total-int(d))
		}
	}

	for _, f := range files {
		f := f
		wg.Add(1)
		sem <- struct{}{}
		go func() {
			if err := processFile(f, procs, pool); err != nil {
				fmt.Println("⚠", err)
			}
			logProgress() // ← 여기!
			wg.Done()
			<-sem
		}()
	}
	wg.Wait()
	pool.closeAll()

	/* 3) tmp → 결과 */
	if err := flushTmp(runtime.NumCPU() * 2); err != nil {
		fmt.Println("❌", err)
	}
	fmt.Println("🥳  done")
}
