import json
import os
import datetime
from pathlib import Path
from urllib.parse import quote

from django.http import HttpResponse, HttpResponseRedirect
from django.urls import reverse
from django.contrib.admin.views.decorators import staff_member_required
from django.conf import settings

from .models import Matcher

from django.contrib.contenttypes.models import ContentType
# ─────────────────────────────────────────────────────────
# helper: Matcher → dict
# ─────────────────────────────────────────────────────────
def _to_dict(m: Matcher) -> dict:
    d = {"category": m.category, "replaceValue": m.replace_value}
    if m.raw:
        d["raw"] = m.raw
    else:
        d["regex"] = (
            {"pattern": m.regexp_source, "flags": m.regexp_flag}
            if m.regexp_flag else m.regexp_source
        )
    if m.groups:
        d["groups"] = m.groups
    return d

from collections import Counter
from django.contrib.admin.models import LogEntry, ADDITION, CHANGE, DELETION
from django.contrib.auth import get_user_model
from django.contrib.admin.views.decorators import staff_member_required
from django.http import HttpResponse
from django.urls import reverse

User = get_user_model()

@staff_member_required
def user_activity_report(request):
    # ① 최근 90 일만 보려면 filter(action_time__gte=…)
    logs = LogEntry.objects.filter(
        action_flag__in=[ADDITION, CHANGE, DELETION]
    ).values_list("user_id", "action_flag")

    # ② Counter( (user_id, flag) )
    add_cnt   = Counter(uid for uid, flag in logs if flag == ADDITION)
    edit_cnt  = Counter(uid for uid, flag in logs if flag == CHANGE)
    delete_cnt  = Counter(uid for uid, flag in logs if flag == DELETION)

    # ③ 모든 유저 id 집합
    user_ids  = add_cnt.keys() | edit_cnt.keys()
    users     = {u.pk: u for u in User.objects.filter(id__in=user_ids)}

    # ④ HTML 테이블 렌더
    rows = []
    for uid in sorted(user_ids, key=lambda x: users[x].username.lower()):
        u = users[uid]
        rows.append(
            f"<tr>"
            f"<td>{u.username}</td>"
            f"<td style='text-align:right;'>{add_cnt.get(uid,0):,}</td>"
            f"<td style='text-align:right;'>{edit_cnt.get(uid,0):,}</td>"
            f"<td style='text-align:right;'>{delete_cnt.get(uid,0):,}</td>"
            f"</tr>"
        )

    html = (
            "<h2>User statistics (last all time)</h2>"
            "<table class='table table-striped'><thead>"
            "<tr><th>User</th><th>Created</th><th>Edited</th><th>Deleted</th></tr>"
            "</thead><tbody>"
            + "".join(rows) +
            "</tbody></table>"
            f"<p><a href='#' onclick='history.back();return false;' >← Back</a></p>"
    )
    return HttpResponse(html)

# ─────────────────────────────────────────────────────────
# 1) matcher 파일 목록 페이지  /builds/
# ─────────────────────────────────────────────────────────
@staff_member_required
def list_translation_files(request):
    root = Path(settings.BUILD_ROOT)
    files = []

    # latest.json 최우선
    latest = root / "latest.json"
    if latest.exists():
        files.append(latest)

    # matchers_*.json 내림차순
    files.extend(sorted(root.glob("translation_file_*.json"), reverse=True))

    # HTML 작성
    rows = []
    for fp in files:
        name  = fp.name
        size  = fp.stat().st_size
        mtime = datetime.datetime.fromtimestamp(fp.stat().st_mtime).strftime("%Y-%m-%d %H:%M:%S")
        url   = f"{settings.BUILD_URL}{quote(name)}"
        rows.append(
            f'<li style="margin-bottom:4px;">'
            f'<a href="{url}" style="color:#000;text-decoration:none;">{name}</a> '
            f'<small>({size:,} bytes, {mtime})</small>'
            '</li>'
        )

    html = (
            "<h2>Build files</h2>"
            "<ul style='list-style:none;padding-left:0;'>"
            + "".join(rows) +
            "</ul>"
            "<p><a href='#' "
            "onclick='history.back();return false;' "
            "style='color:#000;text-decoration:none;'>"
            "← Back</a></p>"
    )
    return HttpResponse(html)


# ─────────────────────────────────────────────────────────
# 2) Generate matchers  ─ build/ 에 파일 저장 후 /builds/ 로 redirect
# ─────────────────────────────────────────────────────────
# ── 메인 뷰 ───────────────────────────────────────────────────
@staff_member_required
def generate_translation_file(request):
    # 1. 매처 목록 직렬화
    matchers = [_to_dict(m) for m in Matcher.objects.all()]

    # 2. 기여자 카운트 (Admin LogEntry 기준)
    matcher_ct = ContentType.objects.get_for_model(Matcher)
    log_qs = LogEntry.objects.filter(content_type=matcher_ct,
                                     action_flag__in=(ADDITION, CHANGE, DELETION))
    counts = Counter(log_qs.values_list("user__username", flat=True))

    messages = [", ".join([
        f"{user} (x{cnt})"
        for user, cnt in sorted(counts.items(), key=lambda x: -x[1])
    ])]

    # 3. 최종 JSON 구조
    payload = {
        "matchers": matchers,
        "time": datetime.datetime.utcnow().isoformat() + "Z",   # JS ISO8601
        "messages": messages,
    }

    # 4. 파일 저장
    root = Path(settings.BUILD_ROOT)
    root.mkdir(parents=True, exist_ok=True)

    latest = root / "latest.json"
    latest.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    ts   = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    snap = root / f"translation_file_{ts}.json"
    snap.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    # 5. 목록 페이지로 리다이렉트
    return HttpResponseRedirect(reverse("list-translation-files"))
