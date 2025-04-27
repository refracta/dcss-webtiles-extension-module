from django.conf import settings
from django.conf.urls.static import static
from django.urls import path
from django.contrib import admin          # ← admin 모듈 직접 임포트

urlpatterns = [
    path("admin/", admin.site.urls),      # ← include() 대신 admin.site.urls
]

# 개발용 미디어 파일 제공
urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
