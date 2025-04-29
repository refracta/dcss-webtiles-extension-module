import json, os, datetime
from django.contrib.admin.views.decorators import staff_member_required
from django.http import HttpResponse
from django.conf import settings
from .models import Matcher

@staff_member_required
def generate_matchers(request):
    """모든 Matcher → latest.json 덮어쓰기 + 버전 파일 저장"""
    def to_dict(m):
        d = {"category": m.category, "replaceValue": m.replace_value}
        if m.raw:
            d["raw"] = m.raw
        elif m.regex:
            d["regex"] = m.regex
        else:
            d["regex"] = {"pattern": m.regexp_source, "flags": m.regexp_flag or ""}
        if m.groups:
            d["groups"] = m.groups
        return d

    items = [to_dict(m) for m in Matcher.objects.all()]

    out_dir = os.path.join(settings.BUILD_ROOT, "matchers")
    os.makedirs(out_dir, exist_ok=True)

    # ① 최신본
    latest_path = os.path.join(out_dir, "latest.json")
    with open(latest_path, "w", encoding="utf-8") as fp:
        json.dump(items, fp, ensure_ascii=False, indent=2)

    # ② 버전 스냅샷
    ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    ver_path = os.path.join(out_dir, f"matchers_{ts}.json")
    with open(ver_path, "w", encoding="utf-8") as fp:
        json.dump(items, fp, ensure_ascii=False, indent=2)

    # 파일 다운로드 응답
    resp = HttpResponse(
        json.dumps(items, ensure_ascii=False, indent=2),
        content_type="application/json",
    )
    resp["Content-Disposition"] = 'attachment; filename="latest.json"'
    return resp
