from django.contrib import admin

admin.site.site_header = "DCSS Translation"  # 상단 굵은 글씨
admin.site.site_title = "Dashboard"  # 브라우저 탭 <title>
admin.site.index_title = "DCSS Translation"  # “Site administration” 자리
from django.http import HttpResponseRedirect

from .models import TranslationData, Matcher, AdminFastLink

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

@admin.register(AdminFastLink)
class AdminFastLinkAdmin(admin.ModelAdmin):
    def changelist_view(self, request, extra_context=None):
        url = reverse('admin:core_translationdata_changelist') + '?mode=fast'
        return HttpResponseRedirect(url)

    def has_module_permission(self, request):
        return True  # 반드시 True로 설정해야 왼쪽 메뉴에 나옴

# core/admin.py  (TranslationDataAdmin 부분만 발췌)

import json, os, datetime
from urllib.parse import urlencode

from django.conf import settings
from django.contrib import admin
from django.db.models.functions import Coalesce
from django.http import HttpResponse
from django.urls import reverse
from django.utils.html import format_html, escape, mark_safe

from .forms import TranslationDataForm, MatcherForm
from .utils import NoCountPaginator
from .utils import SmartPaginator
from django.db import models
from django.db.models import Func, Value, F, Expression


class MatchBoolean(Func):
    """
    MATCH(column) AGAINST (%s IN BOOLEAN MODE) → FLOAT score
    사용:
        qs.annotate(score=MatchBoolean('content', '+foo* -bar*'))
    """
    output_field = models.FloatField()
    arity = 2  # column, query

    def __init__(self, column: Expression | str, query: str, **extra):
        if not isinstance(query, Expression):
            query = Value(query)
        super().__init__(column, query, **extra)

    # 안전한 SQL 생성
    def as_sql(self, compiler, connection, **extra_context):
        col_sql, col_params = compiler.compile(self.source_expressions[0])
        qry_sql, qry_params = compiler.compile(self.source_expressions[1])
        sql = f"MATCH({col_sql}) AGAINST ({qry_sql} IN BOOLEAN MODE)"
        return sql, col_params + qry_params


FAST_PARAM = "mode"
FAST_VALUE = "fast"
from urllib.parse import parse_qsl


def _is_fast_mode(request):
    """`mode=fast` 여부를 request 에서 복구"""
    # 1) 최초 요청(주소창)에서는 그대로 존재
    if request.GET.get(FAST_PARAM) == FAST_VALUE:
        return True
    # 2) Django 내부 링크(다음 페이지 등)에서는 _changelist_filters 로 보존
    pf = request.GET.get("_changelist_filters")
    if pf:
        qs = dict(parse_qsl(pf))
        return qs.get(FAST_PARAM) == FAST_VALUE
    return False


from django.contrib.admin import SimpleListFilter


class ModePassThroughFilter(SimpleListFilter):
    title = ''
    parameter_name = FAST_PARAM  # "mode"
    template = 'admin/hidden_filter.html'
    def lookups(self, request, model_admin):
        return ((request.GET.get(self.parameter_name), ''),)

    def queryset(self, request, queryset):
        return queryset


@admin.register(TranslationData)
class TranslationDataAdmin(admin.ModelAdmin):
    form = TranslationDataForm
    list_display = ("id", "source", "content_pre", "translation", "translation_status", "to_matcher_link")
    search_fields = ["source"]
    list_per_page = 50
    list_filter = ("source", ModePassThroughFilter,)
    paginator = NoCountPaginator
    readonly_fields = (
        "source", "content", "content_pre", "translation", "translation_status", "to_matcher_link", "translation_info")

    fieldsets = (
        (None, {"fields": (
            "source", "content_pre", "translation", "translation_info", "translation_status", "to_matcher_link")}),
    )

    # ────────────────────────────────────────────────
    # URL ?mode=fast  → NoCountPaginator  사용
    # ────────────────────────────────────────────────
    def get_paginator(
            self, request, queryset, per_page,
            orphans=0, allow_empty_first_page=True, **kwargs,
    ):
        use_fast = _is_fast_mode(request)  # ← 핵심
        PaginatorClass = NoCountPaginator if use_fast else SmartPaginator
        return PaginatorClass(
            queryset, per_page,
            orphans=orphans,
            allow_empty_first_page=allow_empty_first_page,
            **kwargs,
        )

    def get_search_results(self, request, queryset, search_term):
        base_qs, use_distinct = super().get_search_results(
            request, queryset, search_term
        )

        if search_term:
            boolean_query = " ".join(f"+{w}*" for w in search_term.split())

            # 1) 먼저 annotate → filter 로 FT 결과만 얻는다
            annotated = queryset.annotate(
                score=MatchBoolean(F("content"), boolean_query)
            )
            ft_qs = annotated.filter(score__gt=0)

            # 2) 두 QuerySet 합치기 (UNION)
            base_qs = base_qs | ft_qs

        return base_qs.distinct(), use_distinct

    def save_model(self, request, obj, form, change):
        # ▲ signals 쪽에서 읽을 수 있도록
        obj._actor = request.user.username  # ← 한 줄 추가
        super().save_model(request, obj, form, change)

    def get_readonly_fields(self, request, obj=None):
        if obj is None:  # ➜ 새 레코드 추가 화면
            return (
                "content_pre", "translation", "translation_status", "to_matcher_link",
                "translation_info")  # 두 필드 모두 수정 가능
        return (
            "source", "content", "content_pre", "translation", "translation_status", "to_matcher_link",
            "translation_info")

    def get_fieldsets(self, request, obj=None):
        if obj is None:  # ➜ 새 레코드 추가 화면
            return (
                (None, {"fields": ("source", "content")}),
            )  # 두 필드 모두 수정 가능
        return (
            (None, {"fields": (
                "source", "content_pre", "translation", "translation_info", "translation_status", "to_matcher_link")}),
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

        params = urlencode({
            "category": obj.source,
            "raw": obj.content.encode(),  # ← 인코딩된 값
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





from django.db.models import TextField, Q
from django.db.models.functions import Cast


# ──────────────────────────────────────────
# ModelAdmin
# ──────────────────────────────────────────
@admin.register(Matcher)
class MatcherAdmin(admin.ModelAdmin):
    form = MatcherForm

    def save_model(self, request, obj, form, change):
        # ▲ signals 쪽에서 읽을 수 있도록
        obj._actor = request.user.username  # ← 한 줄 추가
        super().save_model(request, obj, form, change)

    def get_search_results(self, request, queryset, search_term):
        qs, use_distinct = super().get_search_results(
            request, queryset, search_term
        )

        if search_term:
            # 1) JSON → TEXT 로 캐스팅
            txt_qs = queryset.annotate(
                rv_text=Cast("replace_value", TextField())
            )

            # 2) 검색어를 유니코드 이스케이프로 변환 (\uXXXX)
            escaped = search_term.encode("unicode_escape").decode("ascii")

            # 3) 원본 + 이스케이프 둘 다 contains 로 OR
            qs |= txt_qs.filter(
                Q(rv_text__contains=search_term) | Q(rv_text__contains=escaped)
            )

        return qs.distinct(), use_distinct

    list_display = (
        "match_type_col",
        "category_col",
        "pattern_display",
        "replace_value_display",
        "groups_display",
        "memo_display",
        "priority"
    )
    list_display_links = None  # 기본 a 태그 비활성화
    list_filter = ("category",)
    search_fields = ("category", "raw", "regexp_source", "replace_value", "memo")

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
                pass  # 잘못된 인코딩이면 무시

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
            f'<span class="badge bg-info">{i + 1}:{escape(str(v if v is not None else "null"))}</span>'
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
    memo_display.admin_order_field = "memo"
