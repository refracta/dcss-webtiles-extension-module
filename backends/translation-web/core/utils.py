# core/utils.py
def matcher_to_dict(m):
    data = {
        "category":     m.category,
        "replaceValue": m.replace_value,
    }
    if m.raw:
        data["raw"] = m.raw
    else:
        data["regex"] = (
            {"pattern": m.regexp_source, "flags": m.regexp_flag}
            if m.regexp_flag else m.regexp_source
        )
    if m.groups:
        data["groups"] = m.groups
    return data


def td_to_dict(t):
    return {
        "id":      t.id,
        "source":  t.source,
        "content": t.content,
        "memo":    t.memo,
    }

# core/utils/paginator.py
from django.core.paginator import Paginator, InvalidPage
from django.utils.functional import cached_property

class NoCountPaginator(Paginator):
    """
    COUNT(*) 쿼리를 완전히 생략하는 Paginator.

    - count / num_pages 는 '알 수 없음' 이므로 1 억 같은 큰 값으로 가짜 표시
    - ChangeList 는 page_range 만 필요하므로 문제없음
    - 페이지 존재 여부는 '이번 페이지에 per_page+1 개 가져와 봐서'
      더 있으면 next page 가 있다고 간주
    """

    fake_count = 100_000_000        # 어드민 하단에 뜨는 총 행수(가짜)

    # 1) COUNT(*) 막기
    @cached_property
    def count(self):
        return self.fake_count

    # 2) num_pages / page_range 도 가짜 값
    @cached_property
    def num_pages(self):
        return (self.fake_count // self.per_page) + 1

    @cached_property
    def page_range(self):
        # 1-10 , 11-20 … 만 보여 주도록 짧게
        return range(1, 11)

    # 3) 실제 페이지 객체 구하기
    def page(self, number):
        number = self.validate_number(number)
        bottom = (number - 1) * self.per_page
        top    = bottom + self.per_page + 1         # 하나 더 읽어 next 유무 판별
        object_list = list(self.object_list[bottom:top])
        self._has_next = len(object_list) > self.per_page
        return self._get_page(object_list[: self.per_page], number, self)

    # 4) ChangeList 가 next/prev 보이게 하려면 property 필요
    @property
    def has_next(self):          # 페이지 객체 내부에서 호출
        return getattr(self, "_has_next", False)

# core/utils/paginator.py
import hashlib, re, time
from django.core.paginator import Paginator
from django.core.cache import cache
from django.db import connections, DEFAULT_DB_ALIAS

COUNT_TTL = float('inf')          # 5분

_re_simple = re.compile(r"^\s*SELECT .* FROM [`\"]?(?P<table>\w+)[`\"]?\s*$", re.I)

class SmartPaginator(Paginator):
    """
    1) 캐시 hit → 그대로 반환
    2) simple 'SELECT * FROM table' → information_schema.TABLES.Rows (≈ms)
    3) 기타   → 실제 COUNT(*) 실행 + 캐시
    """

    @property
    def count(self):
        key   = self._cache_key()
        value = cache.get(key)
        if value is not None:
            return value         # ── 1) 캐시 hit

        # ── 2) WHERE 절·JOIN 없는 순수 SELECT 판별 ────────────
        qs    = self.object_list
        if hasattr(qs, "query"):
            sql = str(qs.query)
            m   = _re_simple.match(sql)
            if m:                # simple SELECT -> information_schema
                value = self._estimate_count(m.group("table"))
                cache.set(key, value, COUNT_TTL)
                return value

        # ── 3) 일반 쿼리: 정확한 COUNT(*) ─────────────────────
        value = super().count               # Paginator 기본 동작
        cache.set(key, value, COUNT_TTL)
        return value

    # ----------------------------------------------------------
    def _cache_key(self):
        sql = str(self.object_list.query) if hasattr(self.object_list, "query") else str(self.object_list)
        h   = hashlib.md5(sql.encode()).hexdigest()
        return f"smart_count:{h}"

    # ----------------------------------------------------------
    def _estimate_count(self, table):
        conn = connections[self.object_list.db or DEFAULT_DB_ALIAS]
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT TABLE_ROWS
                  FROM information_schema.TABLES
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s
                """,
                [table],
            )
            row = cur.fetchone()
        return row[0] if row else 0
