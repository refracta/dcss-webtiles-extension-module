# core/signals.py
import requests, datetime, json
from django.conf import settings
from django.dispatch import receiver
from django.db.models.signals import post_save, post_delete
from django.utils.timezone import now

from .models import Matcher, TranslationData
from .utils import matcher_to_dict, td_to_dict
from django.contrib.contenttypes.models import ContentType  # ✔
from django.contrib.admin.models import LogEntry  # ✔ 이 줄 추가
from django.db.models.signals import pre_delete, post_delete, post_save
from django.dispatch import receiver
from .middleware import get_current_username

WEBHOOK = settings.WEBHOOK_URL
BASE = settings.EXTERNAL_URL.rstrip("/")


@receiver(pre_delete, sender=Matcher)
def matcher_pre_delete(sender, instance, **kwargs):
    # 어떤 경로(단일/일괄)든 삭제 전에 username 를 심어 둔다
    instance._actor = get_current_username()


@receiver(post_delete, sender=Matcher)
def matcher_deleted(sender, instance, **kwargs):
    # pre_delete 에서 심어둔 값 사용
    _send_to_discord(_matcher_embed(instance, "deleted"))


@receiver(pre_delete, sender=TranslationData)
def td_pre_delete(sender, instance, **kwargs):
    # 어떤 경로(단일/일괄)든 삭제 전에 username 를 심어 둔다
    instance._actor = get_current_username()


@receiver(post_delete, sender=TranslationData)
def td_deleted(sender, instance, **kwargs):
    # pre_delete 에서 심어둔 값 사용
    _send_to_discord(_td_embed(instance, "deleted"))


def _send_to_discord(data: dict):
    if not WEBHOOK:
        return
    try:
        r = requests.post(WEBHOOK, json=data, timeout=3)
        r.raise_for_status()
    except Exception as e:
        print("Discord webhook error:", e)


def _td_embed(instance, action):
    # 1. 사용자
    username = getattr(instance, "_actor", "unknown")

    # 2. 본문
    lines = [f"source: `{instance.source}`", "content: ```\n" + instance.content + "\n```"]

    desc = "\n".join(lines)
    link = f"{BASE}/admin/core/matcher/{instance.pk}/change/"

    return {
        "content": f"{link} ({action}, {username})",
        "embeds": [{
            "description": desc,
            "timestamp": now().isoformat()
        }]
    }

from django.utils.html import format_html, escape, mark_safe
def groups_to_str(groups: list[str | list]) -> str:
    # 중첩 리스트 fl atten
    flat = []

    def walk(g, prefix=""):

        if isinstance(g, list):
            for i, sub in enumerate(g):
                walk(sub, f"{prefix}{i + 1}:")
        else:
            flat.append(f"{escape(str(prefix if prefix is not None else "null"))}{g}")

    walk(groups)
    return " ".join(f"`{s}`" for s in flat)


# ─────────────────────────────────────────────────────────────
def _matcher_embed(instance, action):
    # 1. 사용자
    username = getattr(instance, "_actor", "unknown")

    # 2. 본문
    lines = [f"category: `{instance.category}`"]

    if instance.raw:
        lines.append("raw: ```\n" + instance.raw + "\n```")
    else:
        flags = instance.regexp_flag or ""
        regex_txt = f"/{instance.regexp_source}/{flags}"
        lines.append("regex: ```\n" + regex_txt + "\n```")

    # 번역
    for lang, text in instance.replace_value.items():
        if text != "":
            lines.append(f"{lang}: ```\n{text}\n```")

    # 그룹
    if instance.groups:
        lines.append("groups: " + groups_to_str(instance.groups))

    # 메모
    if instance.memo:
        lines.append("memo: ```\n" + instance.memo + "\n```")

    lines.append(f"priority: `{str(instance.priority)}`")

        # 메모
    if instance.ignore_part_translated:
        lines.append("ignorePartTranslated: ```\n" + str(instance.ignore_part_translated) + "\n```")

    desc = "\n".join(lines)
    link = f"{BASE}/admin/core/matcher/{instance.pk}/change/"

    return {
        "content": f"{link} ({action}, {username})",
        "embeds": [{
            "description": desc,
            "timestamp": now().isoformat()
        }]
    }
from django.db import models, transaction
from .views import build_translation_payload, write_payload
# ─────────────────────────────────────────────────────────────
@receiver(post_save, sender=Matcher)
def matcher_saved(sender, instance, created, **kwargs):
    action = "created" if created else "updated"
    _send_to_discord(_matcher_embed(instance, action))
    payload = build_translation_payload()
    transaction.on_commit(lambda *args: write_payload(payload, snapshot=True))


@receiver(post_delete, sender=Matcher)
def matcher_deleted(sender, instance, **kwargs):
    _send_to_discord(_matcher_embed(instance, "deleted"))
    payload = build_translation_payload()
    transaction.on_commit(lambda *args: write_payload(payload, snapshot=True))

# ── TranslationData ───────────────────────────────────────
@receiver(post_save, sender=TranslationData)
def td_saved(sender, instance, created, **kwargs):
    verb = "created" if created else "updated"
    _send_to_discord(_td_embed(instance, verb))


@receiver(post_delete, sender=TranslationData)
def td_deleted(sender, instance, **kwargs):
    _send_to_discord(_td_embed(instance, 'deleted'))

