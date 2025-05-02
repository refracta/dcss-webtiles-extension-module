"""
WSGI config for translate_site project.

It exposes the WSGI callable as a module-level variable named ``application``.

For more information on this file, see
https://docs.djangoproject.com/en/5.2/howto/deployment/wsgi/
"""

import os

from django.core.wsgi import get_wsgi_application
from whitenoise import WhiteNoise
from django.conf import settings

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'translate_site.settings')

class BuildWhiteNoise(WhiteNoise):
    def add_headers_function(self, headers, path, url):
        # build/* 에만 CORS 헤더
        if url.startswith("/build/"):
            headers["Access-Control-Allow-Origin"] = "*"

application = BuildWhiteNoise(
    get_wsgi_application(),
    root=settings.STATIC_ROOT,          # 기존 정적
)
# /build/ 디렉터리 추가
application.add_files(
    str(settings.BUILD_ROOT),
    prefix="/build/",
)
