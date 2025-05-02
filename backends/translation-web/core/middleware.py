from threading import local
_user_ctx = local()

def get_current_username():
    """signals에서 호출"""
    return getattr(_user_ctx, "username", "unknown")

class CurrentUserMiddleware:
    """
    request.user 를 thread-local에 넣어 두었다가
    signals(pre_delete/post_delete 등)에서 사용할 수 있게 한다.
    """
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        _user_ctx.username = (
            request.user.username if request.user.is_authenticated else "anonymous"
        )
        response = self.get_response(request)
        _user_ctx.username = "unknown"        # 요청 끝나면 정리
        return response
