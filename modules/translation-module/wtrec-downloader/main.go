// main.go
package main

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
)

const (
	baseURL   = "https://wtrec-json.nemelex.cards/wtrec/"
	localRoot = "wtrecs"
)

var maxWorkers = runtime.NumCPU() * 2 // ✅

// ─────────── 유틸 ───────────
var invalid = regexp.MustCompile(`[<>:"/\\|?*]`)

func safeName(s string) string { return invalid.ReplaceAllString(s, "_") }

func listRemote(url string) ([]string, error) {
	resp, err := http.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d @ %s", resp.StatusCode, url)
	}
	var entries []struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&entries); err != nil {
		return nil, err
	}
	out := make([]string, 0, len(entries))
	for _, e := range entries {
		if e.Name != "" && e.Name != ".." {
			out = append(out, e.Name)
		}
	}
	return out, nil
}

// ─────────── 작업 정의 ───────────
type job struct {
	dirRaw  string
	fileRaw string
}

// 다운로드 1건 처리
func (j job) run() error {
	dirSafe := safeName(j.dirRaw)
	localDir := filepath.Join(localRoot, dirSafe)
	if err := os.MkdirAll(localDir, 0o755); err != nil {
		return err
	}

	jsonName := safeName(j.fileRaw)
	if strings.HasSuffix(jsonName, ".wtrec") {
		jsonName = strings.TrimSuffix(jsonName, ".wtrec") + ".json"
	}
	jsonPath := filepath.Join(localDir, jsonName)
	if _, err := os.Stat(jsonPath); err == nil {
		fmt.Printf("⏩  skip  %s/%s\n", j.dirRaw, jsonName)
		return nil
	}

	fmt.Printf("⬇  %s/%s\n", j.dirRaw, j.fileRaw)
	url := fmt.Sprintf("%s%s/%s", baseURL, j.dirRaw, j.fileRaw)
	resp, err := http.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("HTTP %d @ %s", resp.StatusCode, url)
	}
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}

	// ZIP 내부의 wtrec.json 추출
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return err
	}
	var content []byte
	for _, f := range zr.File {
		if f.Name == "wtrec.json" {
			rc, err := f.Open()
			if err != nil {
				return err
			}
			content, err = io.ReadAll(rc)
			rc.Close()
			if err != nil {
				return err
			}
			break
		}
	}
	if content == nil {
		return fmt.Errorf("wtrec.json not found in %s", j.fileRaw)
	}
	if err := os.WriteFile(jsonPath, content, 0o644); err != nil {
		return err
	}
	fmt.Printf("✅  saved %s/%s\n", j.dirRaw, jsonName)
	return nil
}

// ─────────── 메인 ───────────
func main() {
	if err := os.MkdirAll(localRoot, 0o755); err != nil {
		panic(err)
	}

	dirs, err := listRemote(baseURL)
	if err != nil {
		panic(err)
	}

	// job 큐 + 워커 풀
	jobs := make(chan job, 64)
	var wg sync.WaitGroup
	for i := 0; i < maxWorkers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := range jobs {
				if err := j.run(); err != nil {
					fmt.Printf("⚠  %v\n", err)
				}
			}
		}()
	}

	// 디렉터리/파일 탐색 → 큐 투입
	for _, dirRaw := range dirs {
		dirURL := baseURL + dirRaw + "/"
		files, err := listRemote(dirURL)
		if err != nil {
			fmt.Printf("⚠  listRemote: %v\n", err)
			continue
		}
		for _, fileRaw := range files {
			if strings.HasSuffix(fileRaw, ".wtrec") {
				jobs <- job{dirRaw, fileRaw}
			}
		}
	}
	close(jobs)
	wg.Wait()
	fmt.Println("🥳  all downloads finished")
}
