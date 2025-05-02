import json, os, datetime
from django.conf import settings
from django.http import HttpResponse
from django.contrib import admin
from django.urls import reverse
from django.utils.html import format_html, escape, mark_safe
from django.db.models.functions import Coalesce

from .models import Matcher
from .forms import MatcherForm
from django.utils.http import urlsafe_base64_decode

admin.site.site_header = "DCSS Translation"  # 상단 굵은 글씨
admin.site.site_title = "Dashboard"  # 브라우저 탭 <title>
admin.site.index_title = "DCSS Translation"  # “Site administration” 자리


def _change_url(obj):
    """해당 객체의 admin change URL"""
    return reverse(
        f"admin:{obj._meta.app_label}_{obj._meta.model_name}_change",
        args=[obj.pk]
    )


def _wrap_link(obj, inner_html):
    """검정색·밑줄 없는 링크로 감싸기"""
    return format_html(
        '<a href="{}" style="color:#000;text-decoration:none;">{}</a>',
        _change_url(obj),
        mark_safe(inner_html),
    )


from .models import TranslationData

# core/admin.py  (TranslationDataAdmin 부분만 발췌)
import urllib.parse

from django.contrib import admin
from django.urls import reverse
from django.utils.html import escape, mark_safe
from urllib.parse import urlencode
from .models import TranslationData
from .forms  import TranslationDataForm

import base64

@admin.register(TranslationData)
class TranslationDataAdmin(admin.ModelAdmin):
    form = TranslationDataForm
    list_display = ("id", "source", "content_pre", "translation", "translation_status", "to_matcher_link")
    search_fields = ("source", "content")
    list_per_page = 50
    list_filter = ("source",)
    readonly_fields = ("source", "content", "content_pre", "translation", "translation_status", "to_matcher_link", "translation_info")

    fieldsets = (
        (None, {"fields": ("source", "content_pre", "translation", "translation_info", "translation_status", "to_matcher_link")}),
    )

    def get_readonly_fields(self, request, obj=None):
        if obj is None:                 # ➜ 새 레코드 추가 화면
            return ("content_pre", "translation", "translation_status", "to_matcher_link", "translation_info")                  # 두 필드 모두 수정 가능
        return ("source", "content", "content_pre", "translation", "translation_status", "to_matcher_link", "translation_info")

    def get_fieldsets(self, request, obj=None):
        if obj is None:                 # ➜ 새 레코드 추가 화면
            return (
                (None, {"fields": ("source", "content")}),
            )                   # 두 필드 모두 수정 가능
        return (
            (None, {"fields": ("source", "content_pre", "translation", "translation_info", "translation_status", "to_matcher_link")}),
        )


    def translation_info(self, obj):
        """
              <span class="dyn-result" data-source="..." data-content="..."></span>
              JS 가 1초 뒤 'source+content+hello' 로 값 채움
              """
        url = reverse("admin:core_translationdata_change", args=[obj.pk])

        return mark_safe(
            f'<span style="white-space:pre-wrap;font-family:monospace;" class="translation-info" '
            f'data-source="{escape(obj.source)}" '
            f'data-content="{escape(obj.content)}"></span>'
        )
    translation_info.short_description = "Translation Result"

    @admin.display(description="Status")
    def translation_status_badge(self, obj):
        if obj.is_full:
            return format_html('<span class="badge bg-success">full</span>')
        elif obj.is_partial:
            return format_html('<span class="badge bg-warning">partial</span>')
        return format_html('<span class="badge bg-danger">untranslated</span>')

    # ── 개행 보존 + monospace + 검정 링크 ───────────────────
    def content_pre(self, obj):
        url = reverse("admin:core_translationdata_change", args=[obj.pk])
        return mark_safe(
            f'<span style="white-space:pre-line;font-family:monospace;">{escape(obj.content)}</span>'
        )

    content_pre.short_description = "Content"
    content_pre.admin_order_field = "content"
    # ── To matcher 버튼 ───────────────────────────────────────
    def to_matcher_link(self, obj):
        add_url = reverse("admin:core_matcher_add")

        params  = urlencode({
            "category": obj.source,
            "raw": obj.content.encode(),       # ← 인코딩된 값
            "type": "raw",
        })

        return mark_safe(
            f'<a class="button" href="{add_url}?{params}" '
            'style="color:#000;background:#e2e2e2;'
            'padding:2px 6px;border-radius:4px;">To matcher</a>'
        )

    to_matcher_link.short_description = "To matcher"

    # ── Result (JS가 채울 자리) ─────────────────────────────
    def translation(self, obj):
        """
        <span class="dyn-result" data-source="..." data-content="..."></span>
        JS 가 1초 뒤 'source+content+hello' 로 값 채움
        """
        url = reverse("admin:core_translationdata_change", args=[obj.pk])

        return mark_safe(
            f'<span style="white-space:pre-line;font-family:monospace;" class="translation-result" '
            f'data-source="{escape(obj.source)}" '
            f'data-content="{escape(obj.content)}"></span>'
        )

    translation.short_description = "Translation"

    # ── Result (JS가 채울 자리) ─────────────────────────────

    def translation_status(self, obj):
        """
        <span class="dyn-result" data-source="..." data-content="..."></span>
        JS 가 1초 뒤 'source+content+hello' 로 값 채움
        """
        url = reverse("admin:core_translationdata_change", args=[obj.pk])

        return mark_safe(
            f'<span style="" class="translation-status"></span>'
        )

    translation_status.short_description = "Status"

    # JS 삽입
    class Media:
        js = ("core/js/translationdata_dynamic.js",)  # 정적파일 경로


# ──────────────────────────────────────────
# Action
# ──────────────────────────────────────────
@admin.action(description="Export to JSON (Selected Matchers)")
def export_as_json(modeladmin, request, qs):
    items = []
    for m in qs:
        doc = {"category": m.category, "replaceValue": m.replace_value}
        if m.raw:
            doc["raw"] = m.raw
        else:
            doc["regex"] = (
                {"pattern": m.regexp_source, "flags": m.regexp_flag}
                if m.regexp_flag else m.regexp_source
            )
        if m.groups:
            doc["groups"] = m.groups
        items.append(doc)

    ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    fn = f"matchers_{ts}.json"
    path = os.path.join(settings.BUILD_ROOT, fn)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fp:
        json.dump(items, fp, ensure_ascii=False, indent=2)

    resp = HttpResponse(json.dumps(items, ensure_ascii=False, indent=2),
                        content_type="application/json")
    resp["Content-Disposition"] = f'attachment; filename=\"{fn}\"'
    return resp


# ──────────────────────────────────────────
# ModelAdmin
# ──────────────────────────────────────────
@admin.register(Matcher)
class MatcherAdmin(admin.ModelAdmin):
    form = MatcherForm

    list_display = (
        "match_type_col",
        "category_col",
        "pattern_display",
        "replace_value_display",
        "groups_display",
        "memo_display",
    )
    list_display_links = None  # 기본 a 태그 비활성화
    list_filter = ("category",)
    search_fields = ("category", "raw", "regexp_source", "replace_value")
    actions = [export_as_json]

    class Media:
        js = ("core/js/matcher_form_toggle.js",)

    def get_changeform_initial_data(self, request):
        """
        /admin/core/matcher/add/?category=...&raw_b64=...&type=raw
        → GET 파라미터를 초기값으로 변환
        """
        init = super().get_changeform_initial_data(request)

        if "raw" in request.GET:
            try:
                init["raw"] = request.GET["raw"]
            except Exception:
                pass   # 잘못된 인코딩이면 무시

        # category, type 등 다른 파라미터도 그대로 사용
        for key in ("category", "type"):
            if key in request.GET:
                init[key] = request.GET[key]

        return init

    # Queryset: 정렬용
    def get_queryset(self, request):
        return super().get_queryset(request).annotate(
            pattern_value=Coalesce("raw", "regexp_source")
        )

    # ── Type ──
    def match_type_col(self, obj):
        badge = (
            '<span class="badge bg-primary">RAW</span>'
            if obj.raw else '<span class="badge bg-success">REGEX</span>'
        )
        return _wrap_link(obj, badge)

    match_type_col.short_description = "Type"
    match_type_col.admin_order_field = "raw"

    # ── Category ── (링크 버전)
    def category_col(self, obj):
        return _wrap_link(obj, escape(obj.category))

    category_col.short_description = "Category"
    category_col.admin_order_field = "category"

    # ── Pattern ──
    def pattern_display(self, obj):
        # ① 원본 문자열 결정
        raw_txt = obj.raw or f"/{obj.regexp_source}{'/' if not obj.regexp_flag else '/' + obj.regexp_flag}"

        # ② 개행 → <br> 변환 후 monospace 스타일
        safe_txt = escape(raw_txt).replace("\n", "<br>")
        mono = f'<span style="">{safe_txt}</span>'

        # ③ 수정 화면으로 가는 검정 링크 래핑
        return _wrap_link(obj, mono)

    pattern_display.short_description = "Pattern"
    pattern_display.admin_order_field = "pattern_value"

    # ── Replace value ──
    # core/admin.py  ― replace_value_display() 부분만 교체
    def replace_value_display(self, obj):
        pairs = []
        for lang, text in obj.replace_value.items():
            safe_text = escape(text).replace("\n", "<br>")  # ← 개행 변환
            pairs.append(
                f'<span class="badge bg-secondary">{escape(lang)}</span> {safe_text}'
            )
        return _wrap_link(obj, "<br>".join(pairs))

    replace_value_display.short_description = "Replace value"

    # ── Groups ──
    def groups_display(self, obj):
        if not obj.groups:
            return _wrap_link(obj, "–")
        badges = " ".join(
            f'<span class="badge bg-info">{i}:{escape(str(v))}</span>'
            for i, v in enumerate(obj.groups)
        )
        return _wrap_link(obj, badges)

    groups_display.short_description = "Groups"

    def memo_display(self, obj):
        if not obj.memo:
            return _wrap_link(obj, "–")
        preview = escape(obj.memo.strip().replace("\n", " ⏎ ")[:40])
        return _wrap_link(obj, preview)

    memo_display.short_description = "Memo"
