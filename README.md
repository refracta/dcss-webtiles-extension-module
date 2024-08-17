# dcss-webtiles-extension-module (Korean)

> This document will soon be available in English.

dcss-webtiles-extension-module (DWEM)은 던전 크롤 스톤 수프 웹 타일의 기능을 확장하기 위해 설계된 프레임워크입니다.

[RequireJS](https://requirejs.org)을 후킹하여 웹 타일 자바스크립트 코드가 로딩되기 전에 사용자 코드 조각을 주입할 수 있습니다.

# Installation (User)

[Tampermonkey](https://www.tampermonkey.net), [Greasemonkey](https://www.greasespot.net) 등의 스크립트 관리자 설치
후, [Greasy Fork (loader/dwem-base-loader.js)](https://greasyfork.org/ko/scripts/493267-dcss-webtiles-extension-module-loader)를 설치합니다.

경고: CNC 서버에는 이미 DWEM이 적용되어 있으며(따라서 이미 적용된 모듈들을 그냥 바로 이용할 수 있습니다), 이것은 DWEM이 미적용된 서버에서 DWEM을 사용하기 위해서 해야하는 일입니다.

## Custom module loading
설치 한 뒤, 스크립트의 아래 부분의 주석을 해제하고, 원하는 모듈 스크립트의 주소를 입력하여 원하는 모듈들을 로딩할 수 있습니다.
```js
// localStorage.DWEM_MODULES = JSON.stringify(['https://example.org/module.js', ...]);
```
별도의 수정이 없는 경우, CNC 서버 전용 모듈들을 제외한 본 리포지토리에 게시된 유틸리티 모듈들이 기본으로 로딩됩니다.

# Installation (Webtiles Server)

```html
<script type="text/javascript">
    var socket_server = "{{ socket_server }}";
    localStorage.DWEM_MODULES = ['https://example.org/module1.js', 'https://example.org/module2.js'];
</script>
<script src="https://cdn.jsdelivr.net/gh/refracta/dcss-webtiles-extension-module/loader/dwem-base-loader.js"></script>
```

`webserver/templates/client.html`를 위와 같은 형식으로 수정합니다. `localStorage.DWEM_MODULES`에 기본적으로 불러오고 싶은 모듈의 주소들을 정의할 수 있습니다.

# How to develop Module?
## 모듈 클래스 정의
```javascript
export default class BasicModule {
    static name = 'BasicModule'
    static version = '1.0'
    static dependencies = []
    static description = ''

    onLoad() {

    }
}
```

- `name`, `version`은 DWEM 로더가 처리하기 위해서 필요한 필수적인 속성입니다.
- `dependencies` 속성은 다른 모듈의 의존 관계를 명시합니다. 이 속성의 정의된 경우, DWEM 로더는 의존 관계에 있는 다른 모듈을 먼저 로딩한 후, 해당 모듈을 로딩합니다. (
  예시: `dependencies = ['Module1', 'Module2:1.0'];`)
- `description` 속성을 통해, 모듈 매니저에서 나타낼 모듈의 간단한 설명을 기술할 수 있습니다.
- DWEM 로더는, `RequireJS`의 로딩을 중단시킨 후, 로더 자신과 다른 모듈들의 클래스를 로딩한 후, 각 모듈의 `onLoad()` 함수를 실행시킵니다. 이 부분에서 각 모듈에 필요한 초기화 로직을
  정의할 수 있습니다.

# 소스 재매핑과 기본 예제 (문서 작업 중)

- `modules/io-hook/index.js`, `modules/test-module1/index.js` 예제를 참조할 수 있습니다.

# Module list

- `ModuleManager:1.0` : Ctrl + F12로 모듈 목록 확인 (개발 중)
- `IOHook:1.0`: 입출력 관련 후킹을 돕는 모듈

# 기타
DWEM은 현재 개발 및 테스트 단계입니다.

DWEM is currently in the development and testing phase.
