# core/forms.py
from django import forms
from .models  import Matcher
from .widgets import ReplaceValueWidget, CategoryAutoCompleteWidget

class MatcherForm(forms.ModelForm):
    TYPE_CHOICES = (("raw", "Raw"), ("regex", "Regex"))
    type = forms.ChoiceField(choices=TYPE_CHOICES, widget=forms.Select)

    raw = forms.CharField(
        required=False,
        strip=False,
        label="Raw",
        widget=forms.Textarea(attrs={
            "rows": 6,
            # ↓ 원하는 클래스를 한꺼번에
            "class": "vLargeTextField form-control form-control-sm",
            # 필요하면 style도
            "style": "width:95%; font-family:monospace;",
        }),
    )

    regexp_source = forms.CharField(
        required=False,
        strip=False,
        label="Regexp source",
        widget=forms.Textarea(attrs={
            "rows": 6,
            "class": "vLargeTextField form-control form-control-sm",
            "style": "width:95%; font-family:monospace;",
        }),
    )
    regexp_flag = forms.CharField(
        required=False,
        strip=False,
        label="Regexp flag",
        widget=forms.TextInput(attrs={"style": "width:15ch;"}),
    )

    memo = forms.CharField(                     # NEW
        required=False,
        label="Memo",
        widget=forms.Textarea(attrs={
            "rows": 6,
            "class": "vLargeTextField form-control form-control-sm",
            "style": "width:95%; font-family:monospace;",
        }),
        strip=False,
    )

    class Meta:
        model  = Matcher
        fields = (
            "category",
            "type",
            "raw",
            "regexp_source",
            "regexp_flag",
            "replace_value",
            "groups",
            "memo",
        )
        widgets = {
            "replace_value": ReplaceValueWidget,
            "groups": forms.TextInput(attrs={"style": "width:60%;"}),
        }

    # --------------------------------------------------------------
    def __init__(self, *args, **kw):
        super().__init__(*args, **kw)

        # ➜ 기존 레코드일 때: instance.raw 유무로 타입 결정
        #    새 레코드( instance.pk is None )면 기본값 'raw'
        default_type = "raw" if (not self.instance.pk or self.instance.raw) else "regex"
        self.initial.setdefault("type", default_type)
        # ① 카테고리 목록 추출 (중복 제거 & 정렬)
        cat_list = list(
            Matcher.objects.values_list("category", flat=True).distinct().order_by("category")
        )

        # ② Category 필드 위젯 교체
        self.fields["category"].widget = CategoryAutoCompleteWidget(cat_list)

        # ③ Type 초기값 (RAW/REGEX) 로직 — 이전과 동일
        default_type = "raw" if (not self.instance.pk or self.instance.raw) else "regex"
        self.initial.setdefault("type", default_type)

    # --------------------------------------------------------------
    def clean_replace_value(self):
        """Replace value 는 최소 1개 이상"""
        rv = self.cleaned_data.get("replace_value")
        if not rv or (isinstance(rv, dict) and len(rv) == 0):
            raise forms.ValidationError("하나 이상의 Replace value 가 필요합니다.")
        return rv

    # --------------------------------------------------------------
    def clean(self):
        data = super().clean()
        if data.get("type") == "raw":
            data["regexp_source"] = ""
            data["regexp_flag"]   = ""
            if not data.get("raw"):
                self.add_error("raw", "Raw 값이 필요합니다.")
        else:
            data["raw"] = ""
            if not data.get("regexp_source"):
                self.add_error("regexp_source", "Regex 패턴이 필요합니다.")
        return data

from .models  import TranslationData

class TranslationDataForm(forms.ModelForm):
    class Meta:
        model   = TranslationData
        fields  = "__all__"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)

        # 🔹 DB에 이미 존재하는 source 값을 datalist 옵션으로 주입
        cats = list(
            TranslationData.objects
            .order_by()
            .values_list("source", flat=True)
            .distinct()
        )
        if "sources" in self.fields:
            self.fields["source"].widget = CategoryAutoCompleteWidget(cats)
