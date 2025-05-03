import json
import time
import hashlib
from itertools import islice
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import transaction

from core.models import TranslationData

# ────────────────────────────────────────────────────────
# 튜닝 파라미터
# ────────────────────────────────────────────────────────
BATCH      = 1000    # bulk_create 한 번당 레코드 수
IN_CHUNK   = 900     # content__in 분할 크기 (SQLite 999 제한 대비)
LOG_EVERY  = 1.0     # 진행률 최소 간격(초)
# ────────────────────────────────────────────────────────


class Command(BaseCommand):
    """packs/*.json → TranslationData 고속 삽입 + 진행률"""

    help = __doc__.strip()

    # --------------------------------------------------
    @staticmethod
    def _load_json(path: Path):
        """JSON 파일 파싱. 실패하면 None."""
        try:
            with open(path, encoding="utf-8") as fp:
                return json.load(fp)
        except json.JSONDecodeError as e:
            print(f"⚠️  {path.name}: JSONDecodeError pos {e.pos} → 건너뜀")
            return None

    # --------------------------------------------------
    def handle(self, *args, **kwargs):
        # packs 디렉터리 → 필요에 맞게 경로 조정
        packs_dir = (
                Path(settings.BASE_DIR)
                / "packs"
        )
        json_files = sorted(packs_dir.glob("*.json"))
        if not json_files:
            self.stdout.write(
                self.style.WARNING("packs 디렉터리에 JSON 파일이 없습니다.")
            )
            return

        # ── 1차 패스: 총 레코드 수 집계 ───────────────────
        total_records = 0
        for f in json_files:
            data = self._load_json(f)
            if data is None:
                continue
            recs = data if isinstance(data, list) else data.get("messages", [])
            total_records += len(recs)

        if total_records == 0:
            self.stdout.write(
                self.style.WARNING("삽입할 유효 레코드가 없습니다.")
            )
            return

        self.stdout.write(f"총 {total_records:,}개 레코드 삽입 시작…")

        # ── 2차 패스: 실제 삽입 ───────────────────────────
        processed = 0
        start_ts  = time.time()
        next_log  = start_ts + LOG_EVERY

        for f in json_files:
            data = self._load_json(f)
            if data is None:
                continue

            source = f.stem                      # 파일 이름이 source
            recs   = data if isinstance(data, list) else data.get("messages", [])

            # 이미 존재하는 content 값 미리 조회
            existing = set()
            it = iter(recs)
            chunk = list(islice(it, IN_CHUNK))
            while chunk:
                existing.update(
                    TranslationData.objects.filter(
                        source=source, content__in=chunk
                    ).values_list("content", flat=True)
                )
                chunk = list(islice(it, IN_CHUNK))

            # 배치 생성
            batch = []
            for text in recs:
                if text in existing:
                    continue

                batch.append(
                    TranslationData(
                        source=source,
                        content=text,
                        content_hash=hashlib.md5(text.encode()).hexdigest(),
                    )
                )

                if len(batch) >= BATCH:
                    processed, next_log = self._flush(
                        batch, processed, total_records, start_ts, next_log
                    )
                    batch.clear()

            if batch:
                processed, next_log = self._flush(
                    batch, processed, total_records, start_ts, next_log
                )

        # ── 요약 출력 ─────────────────────────────────────
        elapsed = time.time() - start_ts
        self.stdout.write(
            self.style.SUCCESS(
                f"\n완료! {total_records:,}개 삽입, 경과 {elapsed:,.1f}초, "
                f"평균 {total_records/elapsed:,.0f} rows/s"
            )
        )

    # --------------------------------------------------
    @transaction.atomic
    def _flush(self, rows, processed, total_records, start_ts, next_log):
        """bulk_create 후 진행률 표시; 다음 로그 시각을 반환."""
        TranslationData.objects.bulk_create(
            rows, batch_size=len(rows), ignore_conflicts=True
        )
        processed += len(rows)

        now = time.time()
        if now >= next_log or processed == total_records:
            pct   = processed / total_records * 100
            speed = processed / (now - start_ts)
            eta   = (total_records - processed) / speed if speed else 0
            m, s  = divmod(int(eta), 60)

            self.stdout.write(
                f"\r▶ {processed:,}/{total_records:,} "
                f"({pct:5.1f} %) ▸ {speed:,.0f} rows/s ▸ ETA {m:02d}:{s:02d}",
                ending="",
            )
            if processed == total_records:
                self.stdout.write("")  # 줄바꿈
            next_log = now + LOG_EVERY

        return processed, next_log
