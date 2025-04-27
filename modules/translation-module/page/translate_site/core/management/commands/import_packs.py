import json
import time
from itertools import islice
from pathlib import Path

from django.core.management.base import BaseCommand
from django.conf import settings
from django.db import transaction
from core.models import TranslationData

# -----------------------------------------------------------------------------
# 튜닝 파라미터
# -----------------------------------------------------------------------------
BATCH = 1000        # bulk_create 배치 크기 (INSERT 1회당 레코드 수)
IN_CHUNK = 900      # SQLite "?" 변수 한계(999)보다 살짝 작게 — content__in 분할 크기
LOG_EVERY = 1.0     # 진행률 로그 최소 간격(초)
# -----------------------------------------------------------------------------

class Command(BaseCommand):
    """packs/*.json → TranslationData 삽입 (고속 + 진행률)"""

    help = __doc__.strip()

    # ------------------------------------------------------------------
    @staticmethod
    def _load_json(path: Path):
        """단순히 JSON 파일을 읽어 객체로 반환. 파싱 실패 시 None."""
        try:
            with open(path, encoding="utf-8") as fp:
                return json.load(fp)
        except json.JSONDecodeError as e:
            print(f"⚠️  {path.name}: JSONDecodeError pos {e.pos} → 건너뜀")
            return None

    # ------------------------------------------------------------------
    def handle(self, *args, **kw):
        packs_dir = Path(settings.BASE_DIR) / "packs"
        json_files = sorted(packs_dir.glob("*.json"))
        if not json_files:
            self.stdout.write(self.style.WARNING("packs 디렉터리에 JSON 파일이 없습니다."))
            return

        # --- 1차 패스: 총 레코드 수 ------------------------------------
        total_records = 0
        for file in json_files:
            data = self._load_json(file)
            if data is None:
                continue
            recs = data if isinstance(data, list) else data.get("messages", [])
            total_records += len(recs)

        if total_records == 0:
            self.stdout.write(self.style.WARNING("삽입할 유효 레코드가 없습니다."))
            return

        self.stdout.write(f"총 {total_records:,}개 레코드 삽입 시작…")

        # --- 2차 패스: 삽입 --------------------------------------------
        processed = 0
        start_ts = time.time()
        last_log = start_ts

        for file in json_files:
            data = self._load_json(file)
            if data is None:
                continue
            source = file.stem
            recs = data if isinstance(data, list) else data.get("messages", [])

            # ── 이미 존재하는 content 집합 조회 (IN 절 900개씩 분할) ──
            existing = set()
            it = iter(recs)
            chunk = list(islice(it, IN_CHUNK))
            while chunk:
                existing.update(
                    TranslationData.objects.filter(source=source, content__in=chunk)
                    .values_list("content", flat=True)
                )
                chunk = list(islice(it, IN_CHUNK))

            batch = []
            for text in recs:
                if text in existing:
                    continue
                batch.append(TranslationData(source=source, content=text))
                if len(batch) >= BATCH:
                    processed = self._flush(batch, processed, total_records, start_ts, last_log)
                    last_log = time.time()
                    batch.clear()

            if batch:
                processed = self._flush(batch, processed, total_records, start_ts, last_log)
                last_log = time.time()

        elapsed = time.time() - start_ts
        self.stdout.write(
            self.style.SUCCESS(
                f"완료! {total_records:,}개 삽입, 경과 {elapsed:,.1f}초, "
                f"평균 {total_records/elapsed:,.0f} rows/s"
            )
        )

    # ------------------------------------------------------------------
    @staticmethod
    @transaction.atomic
    def _flush(rows, processed, total_records, start_ts, last_log):
        """bulk_create 후 진행률 출력 (LOG_EVERY 초 간격)"""
        TranslationData.objects.bulk_create(
            rows,
            batch_size=len(rows),
            ignore_conflicts=True,
        )
        processed += len(rows)
        now = time.time()
        if now - last_log >= LOG_EVERY or processed == total_records:
            pct = processed / total_records * 100
            speed = processed / (now - start_ts)
            eta = (total_records - processed) / speed if speed else 0
            m, s = divmod(int(eta), 60)
            print(
                f"\r▶ {processed:,}/{total_records:,} ({pct:5.1f}%) ▸ "
                f"speed {speed:,.0f} r/s ▸ ETA {m:02d}:{s:02d}",
                end="",
                flush=True,
            )
            if processed == total_records:
                print()
        return processed
