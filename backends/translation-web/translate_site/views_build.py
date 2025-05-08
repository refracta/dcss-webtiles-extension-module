# views_build.py  ─ 수정 버전
from pathlib import Path
from urllib.parse import unquote  # ⬅️ 여기
from django.conf import settings
from django.http import FileResponse, Http404
from django.http import FileResponse, Http404, HttpResponseNotModified
from django.utils.http import http_date, parse_http_date_safe

BUILD_ROOT = Path(settings.BUILD_ROOT).resolve()


def serve_build(request, path):
    # 디렉터리 트래버설 방지
    full_path = (BUILD_ROOT / unquote(path)).resolve()
    if not full_path.is_file() or BUILD_ROOT not in full_path.parents:
        raise Http404()
    stat = full_path.stat()
    last_mtime = stat.st_mtime
    last_modified = http_date(last_mtime)  # Fri, 09 May 2025 04:12:30 GMT
    etag = f'W/"{int(last_mtime)}-{stat.st_size}"'  # Weak ETag 예시

    # ── 조건부 GET 처리 ─────────────────────────────
    ims = request.headers.get("If-Modified-Since")
    inm = request.headers.get("If-None-Match")

    not_modified = (
            (ims and parse_http_date_safe(ims) >= int(last_mtime)) or
            (inm == etag)
    )
    if not_modified:
        resp = HttpResponseNotModified()
        resp["ETag"] = etag
        resp["Last-Modified"] = last_modified
        resp["Access-Control-Allow-Origin"] = "*"
        return resp

    # ── 정상 200 응답 ───────────────────────────────
    resp = FileResponse(open(full_path, "rb"))
    resp["ETag"] = etag
    resp["Last-Modified"] = last_modified
    resp["Cache-Control"] = "public, max-age=0, must-revalidate"
    resp["Access-Control-Allow-Origin"] = "*"
    return resp
