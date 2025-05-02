import json
from django.forms.widgets import Widget
from django.utils.html import escape
from django.utils.safestring import mark_safe
from django.forms.widgets import TextInput


class ReplaceValueWidget(Widget):
    """JSONField({lang:text}) ↔ 행 UI (lang + textarea + ×)"""

    class Media:
        js = ("core/js/replace_value_widget.js",)

    # ------------------------------------------------------------------
    def render(self, name, value, attrs=None, renderer=None):
        value_dict = self._to_dict(value)
        rows   = [self._row_html(l, t) for l, t in value_dict.items()] or [self._row_html()]
        proto  = escape(self._row_html())         # JS 복제용

        html = f"""
        <div class="kv-container" data-name="{name}" data-prototype="{proto}">
            {''.join(rows)}
        </div>
        <button type="button" class="add-kv btn btn-outline-secondary btn-sm mt-1">+ Add</button>

        <textarea name="{name}" hidden>{escape(json.dumps(value_dict, ensure_ascii=False))}</textarea>
        """
        return mark_safe(html)

    # ------------------------------------------------------------------
    @staticmethod
    def _to_dict(value) -> dict:
        if not value:
            return {}
        if isinstance(value, dict):
            return value
        if isinstance(value, str):
            try:
                parsed = json.loads(value)
                return parsed if isinstance(parsed, dict) else {}
            except Exception:
                return {}
        return {}

    # ------------------------------------------------------------------
    @staticmethod
    def _row_html(lang: str = "", text: str = "") -> str:
        """한 행 HTML (f-string 하나로 값 주입)"""
        return f"""
        <div class="kv-row d-flex align-items-start mb-2" style="gap:8px;">
            <input type="text"
                   class="vTextField kv-lang form-control form-control-sm"
                   style="flex:0 0 90px;min-width:70px;"
                   placeholder="lang"
                   value="{escape(lang)}">

            <textarea class="vLargeTextField kv-text form-control form-control-sm"
                      rows="4"
                      style="flex:1 1 auto;min-height:4.5rem;"
                      placeholder="translation...">{escape(text)}</textarea>

            <button type="button"
                    class="del-kv btn btn-outline-danger btn-sm"
                    style="flex:0 0 auto;">×</button>
        </div>
        """

    # ------------------------------------------------------------------
    def value_from_datadict(self, data, files, name):
        return data.get(name, "{}")


class CategoryAutoCompleteWidget(TextInput):
    """
    <input list="___"> + <datalist id="___"> … </datalist>
    브라우저 기본 자동완성 드롭다운을 이용한다.
    """

    def __init__(self, categories: list[str], attrs: dict | None = None):
        # input[list] 속성 지정
        attrs = attrs or {}
        attrs["list"] = "existing-categories"
        super().__init__(attrs)
        self._categories = categories

    def render(self, name, value, attrs=None, renderer=None):
        # ① 기본 <input>
        input_html = super().render(name, value, attrs, renderer)

        # ② datalist 옵션
        opts = "".join(f'<option value="{escape(c)}"></option>' for c in self._categories)
        datalist = f'<datalist id="existing-categories">{opts}</datalist>'

        return mark_safe(input_html + datalist)
