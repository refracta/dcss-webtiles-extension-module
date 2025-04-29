import json, os, datetime
from django.conf import settings
from django.http import HttpResponse
from django.contrib import admin
from .models import TranslationData, Matcher

from django.utils.html import format_html, escape   # ← 추가

import json, os, datetime
from django.conf import settings
from django.http import HttpResponse
from django.contrib import admin
from django.utils.html import format_html, escape      # ★
from .models import TranslationData, Matcher

@admin.register(TranslationData)
class TranslationDataAdmin(admin.ModelAdmin):
    list_display  = ("source", "pretty_content")
    list_filter   = ("source",)              # ← 소스별 분류
    search_fields = ("source", "content")    # ← 전역 검색

    def pretty_content(self, obj):           # ← 줄바꿈 포함 전체 표시
        html = "<pre style='max-height:10rem;overflow:auto;margin:0'>{}</pre>"
        return format_html(html, escape(obj.content))
    pretty_content.short_description = "content"


@admin.action(description="선택된 매처 JSON으로 내보내기")
def export_as_json(modeladmin, request, queryset):
    items = []
    for m in queryset:
        entry = {"category": m.category, "replaceValue": m.replace_value}
        if m.raw:
            entry["raw"] = m.raw
        elif m.regex:
            entry["regex"] = m.regex
        else:
            entry["regex"] = {"pattern": m.regexp_source, "flags": m.regexp_flag or ""}
        if m.groups: entry["groups"] = m.groups
        items.append(entry)

    ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"matchers_{ts}.json"
    path = os.path.join(settings.BUILD_ROOT, "matchers", filename)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fp:
        json.dump(items, fp, ensure_ascii=False, indent=2)

    response = HttpResponse(json.dumps(items, ensure_ascii=False, indent=2),
                            content_type="application/json")
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response

@admin.register(Matcher)
class MatcherAdmin(admin.ModelAdmin):
    list_display  = ("category", "pattern_display", "replace_value")
    list_filter   = ("category",)
    search_fields = ("category", "raw", "regex", "regexp_source", "replace_value")
    actions       = [export_as_json]

    def pattern_display(self, obj):
        return obj.raw or obj.regex or f"{obj.regexp_source} /{obj.regexp_flag}"
