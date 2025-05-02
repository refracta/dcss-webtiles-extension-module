# views_build.py  ─ 수정 버전
from pathlib import Path
from urllib.parse import unquote   # ⬅️ 여기
from django.conf import settings
from django.http import FileResponse, Http404

BUILD_ROOT = Path(settings.BUILD_ROOT).resolve()

def serve_build(request, path):
    # 디렉터리 트래버설 방지
    full_path = (BUILD_ROOT / unquote(path)).resolve()
    if not full_path.is_file() or BUILD_ROOT not in full_path.parents:
        raise Http404()
    response = FileResponse(open(full_path, "rb"))
    response["Access-Control-Allow-Origin"] = "*"
    response["Cache-Control"] = "no-store"
    return response
