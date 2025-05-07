import json
import os
import datetime
import urllib
from pathlib import Path
from urllib.parse import quote

import graphviz
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
    if m.ignore_part_translated:
        d["ignorePartTranslated"] = m.ignore_part_translated
    d["priority"] = m.priority
    d["id"] = m.pk
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

    latest_svg = root / "latest.svg"
    if latest_svg.exists():
        files.append(latest_svg)

    # matchers_*.json 내림차순
    files.extend(sorted(root.glob("translation_file_*.json"), reverse=True))
    files.extend(sorted(root.glob("translation_file_*.svg"), reverse=True))

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


def build_translation_payload() -> dict:
    """matcher 직렬화 + 기여자 통계 JSON 반환"""
    # 1) 매처 목록
    matchers = [_to_dict(m) for m in Matcher.objects.all()]

    # 2) 기여자 카운트
    matcher_ct = ContentType.objects.get_for_model(Matcher)
    log_qs = LogEntry.objects.filter(
        content_type=matcher_ct,
        action_flag__in=(ADDITION, CHANGE, DELETION)
    )
    counts = Counter(log_qs.values_list("user__username", flat=True))
    messages = [", ".join(
        f"{user} (x{cnt})"
        for user, cnt in sorted(counts.items(), key=lambda x: -x[1])
    )]

    # 3) 최종 구조
    return {
        "matchers": matchers,
        "time": datetime.datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "messages": messages,
    }

# ────────────────────────────────────────────────────────────────
# 공통 2) 그래프(SVG) 생성기
# ────────────────────────────────────────────────────────────────
def generate_category_graph(matchers: list, svg_path: Path) -> None:
    """
    payload 안의 matchers → Graphviz SVG.
    • 노드: category (matcher 개수 포함) – admin 링크 달림
    • 간선: groups 안에 참조된 category
    • 순환 간선은 빨간색
    """
    # ── 1. 데이터 수집 ───────────────────────────────────────────
    edges: set[tuple[str, str]] = set()
    categories: set[str] = set()
    matcher_count: dict[str, int] = {}

    def flatten(groups):
        if groups is None:
            return
        if isinstance(groups, list):
            for g in groups:
                yield from flatten(g)
        else:
            yield groups

    for m in matchers:
        cat = m.get("category")
        if cat:
            matcher_count[cat] = matcher_count.get(cat, 0) + 1
            categories.add(cat)
        groups = m.get("groups")
        if cat and groups:
            for g in flatten(groups):
                if g:
                    edges.add((cat, g))
                    categories.add(g)

    for c in categories:                # 카운트 없는 노드 0으로
        matcher_count.setdefault(c, 0)

    # ── 2. 순환 간선 찾아서 색상 구분 ─────────────────────────────
    adj: dict[str, set[str]] = {}
    for u, v in edges:
        adj.setdefault(u, set()).add(v)
    cycle_edges: set[tuple[str, str]] = set()

    def dfs(start, cur, visited):
        if cur not in adj:
            return False
        for nxt in adj[cur]:
            if (cur, nxt) in visited:
                continue
            visited.add((cur, nxt))
            if nxt == start or dfs(start, nxt, visited):
                return True
        return False

    for u, v in edges:
        if u == v or dfs(u, v, set()):
            cycle_edges.add((u, v))

    # ── 3. Graphviz 객체 구성 ──────────────────────────────────
    dot = graphviz.Digraph("Categories", format="svg")

    dot.attr(rankdir="LR", fontsize="10")
    dot.attr("node", shape="rect", style="filled",
             fillcolor="lightgrey", fontname="Helvetica", fontsize="10")

    base_admin_url = (
        "https://translation.nemelex.cards/admin/core/matcher/?category="
    )

    for c in sorted(categories):
        label = f"{c} ({matcher_count[c]})"
        url = f"{base_admin_url}{urllib.parse.quote(c, safe='')}"
        dot.node(c, label=label, URL=url, target="_blank")

    for u, v in edges:
        if (u, v) in cycle_edges:
            dot.edge(u, v, color="red")
        else:
            dot.edge(u, v)

    dot.render(svg_path, cleanup=True)

def write_payload(payload: dict, *, snapshot: bool) -> None:
    """
    • latest.json / latest.svg 항상 덮어씀
    • snapshot=True → translation_file_YYYYMMDD_HHMMSS.json + .svg 추가
    """
    root = Path(settings.BUILD_ROOT)
    root.mkdir(parents=True, exist_ok=True)

    # 1) 최신 JSON
    latest_json = root / "latest.json"
    latest_json.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    # 2) 최신 SVG
    latest_svg = root / "latest"
    generate_category_graph(payload.get('matchers', []), latest_svg)

    # 3) 스냅샷
    if snapshot:
        ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        snap_json = root / f"translation_file_{ts}.json"
        snap_json.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        snap_svg = root / f"translation_file_{ts}"
        generate_category_graph(payload.get('matchers', []), snap_svg)
# ─────────────────────────────────────────────────────────
# 2) Generate matchers  ─ build/ 에 파일 저장 후 /builds/ 로 redirect
# ─────────────────────────────────────────────────────────
# ── 메인 뷰 ───────────────────────────────────────────────────
@staff_member_required
def generate_translation_file(request):
    # 1. 매처 목록 직렬화
    payload = build_translation_payload()
    write_payload(payload, snapshot=True)
    # 5. 목록 페이지로 리다이렉트
    return HttpResponseRedirect(reverse("list-translation-files"))
