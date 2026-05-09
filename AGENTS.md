# 저장소 가이드라인

## 프로젝트 구조와 모듈 구성
- core/: DWEM 프레임워크입니다. RequireJS 훅, 매처, 소스 매퍼를 포함합니다.
- loader/: 부트스트랩 스크립트입니다. CDN 또는 유저스크립트에서 `dwem-base-loader.js`를 사용합니다.
- modules/: 기능 모듈과 라이브러리 모듈입니다. 각 모듈은 static `name`, `version`, `dependencies`, `description`를 가진 기본 클래스를 export합니다. 예시 경로: `modules/io-hook/index.js`.
- _webserver/: 로컬 개발/테스트용 Tornado 기반 DCSS Webtiles 서버입니다. `server.py`, `static/scripts/`를 참고하세요.
- backends/: 보조 서비스입니다. 예를 들어 Django 번역 웹, 봇, exporter가 있습니다.
- CLAUDE.md: 상세 아키텍처와 에이전트 가이드입니다. RequireJS 훅, IOHook, Source Mapper 패턴, 개발 명령을 확인할 때 참고하세요.

모듈 클래스 패턴:
```js
export default class MyModule {
  static name = 'MyModule';
  static version = '1.0';
  static dependencies = [];
  onLoad() {}
}
```

## 빌드, 테스트, 개발 명령
- 전체 스택 시작: `docker-compose up` (백엔드 서비스).
- Django 백엔드(translation-web): `cd backends/translation-web && python manage.py migrate && python manage.py runserver 0.0.0.0:8000`, 테스트는 `python manage.py test`.
- Go 유틸리티: `cd modules/translation-module/wtrec-downloader && go build && go run main.go`.
- Webtiles 개발 서버: `cd _webserver && python server.py` (클라이언트와 WebSocket 엔드포인트를 제공합니다).
- 브라우저 테스트: Tampermonkey/Greasemonkey를 설치하고 `loader/dwem-base-loader.js`(CDN)를 로드합니다. Module Manager는 `Ctrl+F12`로 토글합니다.

## 코딩 스타일과 이름 규칙
- JavaScript: ES6 모듈, 4칸 들여쓰기, 세미콜론, PascalCase 클래스, camelCase 메서드/변수를 사용합니다. 모듈 폴더는 kebab-case를 사용합니다. 예: `modules/sound-support`.
- Python: PEP 8, 4칸 들여쓰기를 따릅니다. `_webserver`의 기존 패턴을 따르세요.
- Go: `gofmt` 기본값을 따릅니다. 패키지는 작고 단일 목적을 유지하세요.
- 파일명: 모듈 엔트리에는 `index.js`를 사용합니다. `name`/`version`에는 콜론을 피하세요. 로더에서 이를 강제합니다.

## 테스트 가이드라인
- Django: `backends/translation-web`에서 `python manage.py test`를 실행합니다.
- JS 모듈: 유저스크립트를 통한 수동 브라우저 테스트를 사용합니다. 쉽게 검증할 수 있도록 작고 독립적인 모듈을 선호하세요.
- Webtiles 플로우: `_webserver/static/scripts/`의 대상 파일(`client.js`, `comm.js` 등)에 대해 훅을 검증합니다.

## DWEM 웹 디버깅
- 로컬 변경을 실제 CNC Webtiles에서 확인할 때는 저장소 루트에서 정적 웹 서버를 띄우고 loader를 로컬에서 불러옵니다. 기본 디버그 loader 주소는 `http://localhost:6060/loader/dwem-core-loader.js`입니다.
- 브라우저 콘솔에서 다음 값을 설정한 뒤 `https://crawl.nemelex.cards`를 새로고침합니다.
```js
localStorage.DWEM_DEBUG = true;
localStorage.DWEM_DEBUG_LOADER = 'http://localhost:6060/loader/dwem-core-loader.js';
```
- 디버그 중에는 로컬 서버가 `loader/`, `core/`, `modules/` 경로를 그대로 서빙해야 합니다. HTTPS 페이지에서 localhost 리소스를 불러오므로 CORS/Private Network Access 문제가 나면 해당 헤더를 허용하는 로컬 서버로 다시 띄웁니다.
- WSL에서 띄운 6060 서버는 호스트 경유 주소 `http://h.abstr.net:6060/loader/dwem-core-loader.js`로 접근 여부를 확인할 수 있습니다. 단, `https://crawl.nemelex.cards` 페이지 안에서 HTTP loader를 직접 import하면 Chrome의 mixed content 정책에 막힐 수 있으므로, Playwright 검증에서는 커밋을 푸시한 뒤 jsDelivr HTTPS 경로를 쓰는 편이 안정적입니다.
- 브라우저 검증은 Playwright로 수행합니다. 실제 사이트는 `https://crawl.nemelex.cards`를 사용하고, 필요한 경우 제공된 테스트 계정으로 로그인해 배너, 스플래시, WebSocket 훅, 모듈 로딩, 콘솔 오류를 확인합니다. 푸시된 최신 커밋을 강제로 확인할 때는 페이지 origin에서 `localStorage.clear()` 후 `DWEM_LATEST`를 커밋 SHA로 고정하고 새로고침합니다.
```js
localStorage.clear();
localStorage.DWEM_LATEST = '<commit-sha>';
localStorage.DWEM_LATEST_TIME = String(Date.now());
localStorage.DWEM_LATEST_DURATION = '86400';
location.reload();
```

## 커밋과 Pull Request 가이드라인
- 커밋: 명령형이고 설명적인 제목을 사용합니다. 예: "Add IOHook before-send interceptor". 히스토리는 간결하므로 범위와 이유를 포함하세요.
- PR: 요약, 관련 이슈, 테스트 노트, UI 변경의 스크린샷/GIF를 포함합니다. 영향받은 경로도 나열하세요. 예: `modules/*`, `_webserver/static/scripts/*`.

## 보안과 설정 팁
- 모듈은 `localStorage.DWEM_MODULES = ['https://example.org/mod.js']`로 설정하고, 세부 설정은 `localStorage.DWEM`으로 관리합니다.
- WebSocket 메시지의 민감한 데이터는 로깅하지 마세요. 필요한 범위에 한정한 디버그 출력을 선호하세요.

## 서버 배포
```
ssh NGINX (*.abstr.net, *.nemelex.cards 관련 설정을 /etc/nginx/sites-enabled)에서 가능
ssh MP (sudo 이용해서 루트 계정 사용, docker-compose 이용, translation 관련 서비스)
/disk/dcss-webtiles-extension-module/backends/
ssh CLOUD (sudo 이용해서 루트 계정 사용, docker-compose 이용, git은 root 계정에서 사용 가능, 루트로 작업 권장)
/volume2/programs/donation-system/
/volume3/www/dcss-webtiles-extension-module/backends/
```
위치의 폴더를 참고

## 테스트 계정
labter/labter
