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


application = WhiteNoise(
    get_wsgi_application(),
    root=settings.STATIC_ROOT,          # 기존 정적
)
