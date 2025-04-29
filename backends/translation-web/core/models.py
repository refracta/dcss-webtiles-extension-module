from django.db import models
from django.core.exceptions import ValidationError

class TranslationData(models.Model):
    source  = models.CharField(max_length=255, db_index=True)
    content = models.TextField()

    class Meta:
        unique_together = ("source", "content")
        verbose_name = "원문"
        verbose_name_plural = "원문 목록"

    def __str__(self):
        return f"{self.source} › {self.content[:30]}"

class Matcher(models.Model):
    category      = models.CharField(max_length=50)

    raw           = models.TextField(blank=True, null=True)
    regex         = models.TextField(blank=True, null=True)
    regexp_source = models.TextField(blank=True, null=True)
    regexp_flag   = models.CharField(max_length=20, blank=True, null=True)

    replace_value = models.TextField()

    # 중첩 리스트 그대로 JSON 보관
    groups        = models.JSONField(blank=True, null=True)

    class Meta:
        verbose_name = "매처"
        verbose_name_plural = "매처 목록"

    def clean(self):
        filled = [bool(self.raw), bool(self.regex),
                  bool(self.regexp_source and self.regexp_flag)]
        if sum(filled) != 1:
            raise ValidationError("raw, regex, (regexp_source+regexp_flag) 중 하나만 입력하세요.")

    def __str__(self):
        return f"{self.category} › {self.raw or self.regex or self.regexp_source}"
