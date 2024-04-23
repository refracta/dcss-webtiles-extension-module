# dcss-webtiles-extension-module (Korean)

dcss-webtiles-extension-module (DEM)은 던전 크롤 스톤 수프 웹 타일의 기능을 확장하기 위해 설계된 프레임워크입니다.

[RequireJS](https://requirejs.org)을 후킹하여 웹 타일 자바스크립트 코드가 로딩되기 전에 사용자 코드 조각을 주입할 수 있습니다.

# Installation (임시)

Tampermonkey, Greasemonkey 등의 스크립트 관리자 설치 후, `loader/dem-base-loader.js`를 설치합니다.

```javascript
// loader/dem-base-loader.js
import('http://localhost:6060/loader/dem-core-loader.js');
```

스크립트를 호스팅하고 있는 URL로 위의 코어 로더 경로를 수정합니다.

# How to develop Module?

`modules/io-hook.js` 예제를 참조
