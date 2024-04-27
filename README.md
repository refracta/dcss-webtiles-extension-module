# dcss-webtiles-extension-module (Korean)

dcss-webtiles-extension-module (DWEM)은 던전 크롤 스톤 수프 웹 타일의 기능을 확장하기 위해 설계된 프레임워크입니다.

[RequireJS](https://requirejs.org)을 후킹하여 웹 타일 자바스크립트 코드가 로딩되기 전에 사용자 코드 조각을 주입할 수 있습니다.

# Installation (임시)

Tampermonkey, Greasemonkey 등의 스크립트 관리자 설치 후, `loader/dwem-base-loader.js`를 설치합니다.

[Greasy Fork](https://greasyfork.org/ko/scripts/493267-dcss-webtiles-extension-module-loader)

# How to develop Module?

`modules/io-hook.js`, `modules/test-module1.js` 예제를 참조

# Module list

- `ModuleManager:1.0` : Ctrl + F12로 모듈 목록 확인 (개발 중)
- `IOHook:1.0`: 입출력 관련 후킹을 돕는 모듈

# 기타

DWEM은 현재 개발 및 테스트 단계입니다.
