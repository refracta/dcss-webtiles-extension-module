# core/models.py
from django.db import models
from django.core.exceptions import ValidationError
from django.utils.translation import gettext_lazy as _
from django.db.models import Q

class TranslationData(models.Model):
    source  = models.CharField(max_length=255, db_index=True)
    content = models.TextField()

    class Meta:
        unique_together = ("source", "content")
        verbose_name         = "Translation data"        # ← 단수
        verbose_name_plural  = "Translation data"

class Matcher(models.Model):
    category       = models.CharField(max_length=50)

    # ───── 매칭 조건 ─────
    raw            = models.TextField(blank=True)               # null 저장 안 함
    regexp_source  = models.TextField(blank=True)
    regexp_flag    = models.CharField(max_length=20, blank=True)

    # ───── 다국어 치환값 ─────
    # ex) {"ko": "안녕", "en": "Hi"}
    replace_value  = models.JSONField(default=dict, blank=True)

    groups         = models.JSONField(default=list, blank=True)

    created_at     = models.DateTimeField(auto_now_add=True)
    memo           = models.TextField(blank=True)

    # ─── 타입을 쉽게 확인할 수 있는 속성 ───
    @property
    def match_type(self) -> str:
        return "raw" if self.raw else "regex"

    def clean(self):
        # raw ↔ regexp_source/flag 둘 중 정확히 하나만
        if bool(self.raw) == bool(self.regexp_source):
            raise ValidationError(
                _("Either raw or regexp_source(+flag) must be set, not both.")
            )

    def _normalize_newlines(self, text: str) -> str:
        """\r\n  또는  \r  →  \n 으로 변환"""
        if text is None:
            return text
        return text.replace("\r\n", "\n").replace("\r", "\n")

    def save(self, *args, **kwargs):
        # 저장 직전 줄바꿈 정리
        self.raw           = self._normalize_newlines(self.raw)
        self.regexp_source = self._normalize_newlines(self.regexp_source)
        super().save(*args, **kwargs)

    def __str__(self):
        if self.raw:
            return self.raw
        suf = f"/{self.regexp_flag}" if self.regexp_flag else ""
        return f"/{self.regexp_source}{suf}"

    class Meta:
        constraints = [
            # 1. raw 값이 있을 때는 같은 raw 를 하나만
            models.UniqueConstraint(
                fields=["raw"],
                condition=~Q(raw=""),          # raw ≠ ''  (빈칸 제외)
                name="uniq_raw_not_blank",
            ),
            # 2. raw 가 빈칸(즉 regex)인 경우,
            #    regexp_source + regexp_flag 쌍이 유일
            models.UniqueConstraint(
                fields=["regexp_source", "regexp_flag"],
                condition=Q(raw=""),
                name="uniq_regex_pair",
            ),
        ]
