from django.conf import settings
from django.conf.urls.static import static
from django.urls import path
from django.contrib import admin          # ← admin 모듈 직접 임포트
from django.shortcuts import redirect
from core import views as core_views

urlpatterns = [
    path("", lambda r: redirect("admin:index")),
    path("admin/", admin.site.urls),

    # 매처 전체 JSON 생성
    path("generate-matchers/", core_views.generate_matchers, name="generate-matchers"),
]

# 개발 서버용 build/ 파일 제공
urlpatterns += static(settings.BUILD_URL, document_root=settings.BUILD_ROOT)
