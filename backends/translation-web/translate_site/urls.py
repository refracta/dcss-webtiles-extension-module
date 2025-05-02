# translate_site/urls.py
from django.urls import path, reverse_lazy
from django.conf import settings
from django.conf.urls.static import static
from django.shortcuts import redirect
from django.contrib import admin
from core import views as core_views

urlpatterns = [
    path("", lambda r: redirect("admin:index")),
    path("user-statistics/", core_views.user_activity_report, name="user-statistics"),

    path("admin/", admin.site.urls),

    # (1) build/ 목록 페이지
    path("build/", core_views.list_translation_files, name="list-translation-files"),

    # (2) JSON 생성 → 이름을 **generate-matchers** 로 유지
    path("build/generate/", core_views.generate_translation_file, name="generate-translation-file"),

]

# 반드시 ‘동적 URL → static()’ 순서
urlpatterns += static(settings.BUILD_URL, document_root=settings.BUILD_ROOT)
