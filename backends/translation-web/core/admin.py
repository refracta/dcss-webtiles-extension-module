from django.contrib import admin
from django.contrib.admin.helpers import ACTION_CHECKBOX_NAME
from django.template.response import TemplateResponse

admin.site.site_header = "DCSS Translation"  # 상단 굵은 글씨
admin.site.site_title = "Dashboard"  # 브라우저 탭 <title>
admin.site.index_title = "DCSS Translation"  # “Site administration” 자리
from django.http import HttpResponseRedirect
from django.forms.models import model_to_dict
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

from .forms import TranslationDataForm, MatcherForm, CategoryChangeForm, CategoryBulkForm
from .utils import NoCountPaginator
from .utils import SmartPaginator
from django.db import models, transaction
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
            "raw": obj.content,  # ← 인코딩된 값
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

# ────────────────── Django 기본 ──────────────────
from django import forms
from django.contrib import admin, messages
from django.contrib.admin.views.main import ChangeList
from django.urls import reverse, path
from django.http import HttpResponseRedirect
from django.template.response import TemplateResponse
from django.utils.html import format_html, escape, mark_safe
from django.utils.translation import gettext_lazy as _

# ────────────────── 표준 라이브러리 ───────────────
import json, os, datetime, hashlib
from urllib.parse import urlencode, parse_qsl

# ────────────────── Django ORM / Models ──────────
from django.db import models
from django.db.models import (F, Q, Value, Expression,
                              Func, TextField)
from django.db.models.functions import Coalesce, Cast

# ────────────────── 프로젝트 내부 유틸 ────────────
from .models import TranslationData, Matcher, AdminFastLink
from .forms import TranslationDataForm, MatcherForm
from .utils import NoCountPaginator, SmartPaginator
from .forms import CategoryChangeConfirmForm  # ← 방금 만든 폼

# ──────────────────────────────────────────
# ModelAdmin
# ──────────────────────────────────────────
@admin.register(Matcher)
class MatcherAdmin(admin.ModelAdmin):
    form = MatcherForm
    change_list_template = "admin/matcher_change_list.html"
    actions= ["change_category_confirm"]

    @admin.action(description="Change category…")
    def change_category_confirm(self, request, queryset):
        """
        1) 드롭다운에서 액션 선택 → POST 로 이 함수 호출
        2) 'apply' 파라미터가 없으면 확인 페이지 렌더
        3) 'apply' 가 있으면 실제로 DB 업데이트
        """
        if "apply" in request.POST:
            # ── 3) 실제 일괄 변경 ──────────────────────────
            new_cat = (request.POST.get("new_category") or "").strip()
            if not new_cat:
                self.message_user(request,
                                  "Please enter a new category.",
                                  level=messages.ERROR)
                return

            pks = request.POST.getlist("_selected_action")
            updated = Matcher.objects.filter(pk__in=pks).update(category=new_cat)

            self.message_user(
                request,
                f"{updated} matcher(s) moved to “{new_cat}”.",
                level=messages.SUCCESS,
            )
            return None          # changelist 로 리다이렉트

        # ── 2) 확인 페이지 ─────────────────────────────────
        pks = request.POST.getlist(ACTION_CHECKBOX_NAME)
        context = dict(
            self.admin_site.each_context(request),
            title="Change category of selected matchers",
            objects=queryset,
            action="change_category_confirm",
            pks=pks,
            opts=self.model._meta,          # ★ 이 한 줄 추가
        )
        return TemplateResponse(
            request,
            "admin/change_category_confirmation.html",
            context
        )



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
        "priority",
        "ignore_part_translated_display",
        "copy_link"
    )
    list_display_links = None  # 기본 a 태그 비활성화
    list_filter = ("category",)
    search_fields = ("category", "raw", "regexp_source", "replace_value", "groups", "memo")


    class Media:
        js = ("core/js/matcher_form_toggle.js",)

    def get_changeform_initial_data(self, request):
        """
        /admin/core/matcher/add/?category=...&raw_b64=...&type=raw
        → GET 파라미터를 ModelAdmin 기본 initial dict 로 변환
        """
        init = super().get_changeform_initial_data(request)

        # 1) 일반 문자열·숫자 필드 ------------------------------
        simple_keys = (
            "category", "type", "raw",          # ← raw(plain) or regex_source
            "regexp_source", "regexp_flag",
            "priority", "memo",
        )
        for key in simple_keys:
            if key in request.GET:
                init[key] = request.GET[key]

        # 3) JSON 문자열(딕셔너리/리스트) ------------------------
        json_keys = ("replace_value", "groups")
        for key in json_keys:
            if key in request.GET:
                try:
                    init[key] = json.loads(request.GET[key])
                except json.JSONDecodeError:
                    init[key] = request.GET[key]   # 그냥 문자열로 보존

        # 4) 불리언 문자열 -------------------------------
        bool_keys = ("ignore_part_translated",)
        for key in bool_keys:
            if key in request.GET:
                init[key] = request.GET[key].lower() in ("true")

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

            # ② 개행 → <br> 변환 후 monospace 스타일
        safe_txt = escape(obj.memo).replace("\n", "<br>")
        mono = f'<span style="">{safe_txt}</span>'
        return _wrap_link(obj, mono)

    memo_display.short_description = "Memo"
    memo_display.admin_order_field = "memo"

    def ignore_part_translated_display(self, obj):
        if not obj.ignore_part_translated:
            return _wrap_link(obj, "🟪")

        return _wrap_link(obj, "☑")

    ignore_part_translated_display.short_description = "ignorePT"
    ignore_part_translated_display.admin_order_field = "ignore_part_translated"

        # ── To matcher 버튼 ───────────────────────────────────────
    def copy_link(self, obj):
        add_url = reverse("admin:core_matcher_add")

        # 1) 모델을 dict 로 변환
        field_names = [
            "category", "raw", "regexp_source", "regexp_flag",
            "replace_value", "groups", "memo",
            "priority", "ignore_part_translated", "replace_value", "groups"
        ]
        data = model_to_dict(obj, field_names)          # {'category': '...', 'raw': '...', ...}

        # 2) 목록/딕셔너리 필드는 JSON 문자열로 바꿔 주기
        for k in ("replace_value", "groups"):
            if data.get(k) is not None:
                data[k] = json.dumps(data[k], ensure_ascii=False)

        # 3) RAW ↔ REGEX 구분용 파라미터 추가
        data["type"] = "raw" if obj.raw else "regex"

        # 4) URL 인코딩
        params = urlencode(data, doseq=True)            # /admin/core/matcher/add/?category=...

        return mark_safe(
            f'<a class="button" href="{add_url}?{params}" '
            'style="color:#000;background:#e2e2e2;padding:2px 6px;border-radius:4px;">Copy</a>'
        )

    copy_link.short_description = "Copy"


    def get_urls(self):
        urls = super().get_urls()
        my = [
            path(
                "change-category/",
                self.admin_site.admin_view(self.bulk_change_category_view),
                name="core_matcher_bulk_change_category",  # ★ bulk 이름으로 통일
            )
        ]
        return my + urls

    def bulk_change_category_view(self, request):
        """
        ① category 필드에 old → new
        ② groups = [["foo", …], …] 안에 old → new
           └ 모든 중첩-리스트를 순회하며 정확히 일치하는 항목만 치환
        """
        ctx = dict(self.admin_site.each_context(request),
                   title=_("Change category"))

        # ── 미리보기용 카운트 초기화
        direct_cnt: int | None = None   # category 필드에서 old 값 개수
        group_cnt: int | None = None    # groups 안에서 old 값이 들어있는 개수
        updated = 0                     # 실제로 수정된 Matcher 개수

        # ==================================================================
        # POST  ─ 실제 업데이트
        # ==================================================================
        if request.method == "POST":
            form = CategoryBulkForm(request.POST)

            if form.is_valid():
                old = form.cleaned_data["old_category"]
                new = form.cleaned_data["new_category"]

                # ------------------------------------------------------------------
                # (1) category 필드 미리 카운트
                # ------------------------------------------------------------------
                direct_q = Q(category=old)
                direct_cnt = Matcher.objects.filter(direct_q).count()

                # ------------------------------------------------------------------
                # (2) groups 안 old 포함 여부는 Python으로 직접 계산
                #     → ArrayField 에서는 부분 문자열 매칭이 힘들기 때문
                # ------------------------------------------------------------------
                group_candidates = Matcher.objects.all()
                group_cnt = 0
                for m in group_candidates:
                    if any(old in sub for sub in m.groups):
                        group_cnt += 1

                # ================================ 실제 UPDATE ======================
                with transaction.atomic():
                    # (1) category 필드
                    updated += Matcher.objects.filter(direct_q).update(category=new)

                    # (2) groups 중첩 리스트
                    for m in group_candidates:
                        changed = False
                        new_groups = []

                        for sub in m.groups:
                            if old in sub:
                                # 정확히 old 와 일치하는 항목만 new 로 교체
                                new_sub = [new if item == old else item for item in sub]
                                changed = True
                            else:
                                new_sub = sub
                            new_groups.append(new_sub)

                        if changed:
                            m.groups = new_groups
                            m.save(update_fields=["groups"])
                            updated += 1

                # ============================= 결과 메시지 & 리다이렉트 ==============
                messages.success(
                    request,
                    _(f"Updated {updated} matcher(s): "
                      f"{direct_cnt} in 'category', {group_cnt} inside 'groups'.")
                )
                return HttpResponseRedirect(
                    reverse("admin:core_matcher_changelist")
                )

            # ------------------------------------------------------------------
            # 폼이 invalid 인 경우에도 old_category 가 입력되어 있으면
            # 미리보기 카운트를 보여 주기 위해 계산
            # ------------------------------------------------------------------
            else:
                old = request.POST.get("old_category")
                if old:
                    direct_cnt = Matcher.objects.filter(category=old).count()
                    group_cnt = sum(
                        1 for m in Matcher.objects.all()
                        if any(old in sub for sub in m.groups)
                    )

        # ==================================================================
        # GET  ─ 미리보기(Preview)
        # ==================================================================
        else:
            form = CategoryBulkForm(request.GET or None)
            if form.is_valid():         # 쿠키/쿼리스트링 old_category 있을 때
                old = form.cleaned_data["old_category"]
                direct_cnt = Matcher.objects.filter(category=old).count()
                group_cnt = sum(
                    1 for m in Matcher.objects.all()
                    if any(old in sub for sub in m.groups)
                )

        # ── 컨텍스트 후처리 & 렌더링
        ctx.update(dict(form=form,
                        direct_cnt=direct_cnt,
                        group_cnt=group_cnt))
        return TemplateResponse(request,
                                "admin/bulk_change_category.html",
                                ctx)
