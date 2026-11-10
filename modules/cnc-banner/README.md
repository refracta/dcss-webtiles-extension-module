# CNC banner themes

The active theme is selected by **one line** in [`themes/active.js`](themes/active.js):

```js
export {default} from './xom.js';
```

Change `./xom.js` to `./nemelex.js` and commit/push that file to restore the cards headline, original viewer link, green information panel and donation colours together. No changes to `index.js` or the templates are needed.

## Xom

- The headline links to <https://refracta.github.io/nemelx-altar-3d/xom/> and passes the banner language.
- One of 15 bilingual headlines is selected per page load and retained through login and lobby redraws. Reloading selects another headline. `?forceLang=ko` and `?forceLang=en` use the existing locale override.
- `themes/yiuf-quotes.js` contains the 11 spoken quotes and four visual messages from **`Xom Crazy Yiuf`**, with the visual messages' subject changed to the CNC server. The separate `confused Crazy Yiuf` block contains different, mundane lines and is intentionally not mixed into this set.
- The missing Principia Discordia quote is included in Korean and English. Kant's Korean line follows the English meaning: expecting enlightenment while prescribing its conclusion is absurd.
- Each non-whitespace character cycles through the Guardian status colours, in order: `#a40000`, `#ef2929`, `#fce94f`, `#4e9a06`, `#8ae234`, `#204a87`, `#729fcf`, `#ad7fa8`.
- The information panel uses `#845fbf`; donation colours use matching CSS variables. Presentation and headline selection live in `banner-theme.js`; theme values live in `themes/`.

## Sources

Pinned Crawl revision: [`181c61d5ab7287e21114405b3e77c4cd3d89733e`](https://github.com/crawl/crawl/tree/181c61d5ab7287e21114405b3e77c4cd3d89733e).

- [Yiuf dialogue, `monspeak.txt`](https://github.com/crawl/crawl/blob/181c61d5ab7287e21114405b3e77c4cd3d89733e/crawl-ref/source/dat/database/monspeak.txt): spoken English is verbatim, including the Principia Discordia capitalisation. Korean translations are in the same data records.
- [Guardian colour order, `status.cc`](https://github.com/crawl/crawl/blob/181c61d5ab7287e21114405b3e77c4cd3d89733e/crawl-ref/source/status.cc), `_describe_xom_blessing`.
- [WebTiles RGB values, `style.css`](https://github.com/crawl/crawl/blob/181c61d5ab7287e21114405b3e77c4cd3d89733e/crawl-ref/source/webserver/game_data/static/style.css), `.fg0`–`.fg15`.
- [Requested Guardian screenshot](https://gall.dcinside.com/board/view/?id=rlike&no=526051).

Crawl source material retains its [upstream licence](https://github.com/crawl/crawl/blob/181c61d5ab7287e21114405b3e77c4cd3d89733e/LICENSE).

## Verification

Run `npm run check` and `npm test` in this directory. Browser checks should cover both locales, an anonymous lobby and the test account, long quote wrapping, the Xom viewer link, and theme restoration. The new theme renders the coloured headline in its HTML, so it also works before login.
