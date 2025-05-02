from pathlib import Path

ROOT = Path.cwd()           # 스크립트를 실행한 위치
OUT  = ROOT / "code.txt"    # 결과 파일

with OUT.open("w", encoding="utf-8") as fout:
    for path in sorted(ROOT.rglob("*.py")):
        # code.txt 자체는 건너뜀
        if path.resolve() == OUT.resolve():
            continue

        rel = path.relative_to(ROOT).as_posix()   # a/b/c.py 같은 상대 경로
        fout.write(f"[{rel}]\n")
        fout.write(path.read_text(encoding="utf-8"))
        fout.write("\n\n")        # 파일 사이 한 줄 공백

print(f"✅ {OUT} created ({OUT.stat().st_size} bytes)")
