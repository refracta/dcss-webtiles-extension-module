# CHZZK live proxy

This backend reads live broadcasts from CHZZK's `던전 크롤 스톤 수프`
category (`GAME/Dungeon_Crawl_Stone_Soup`) and returns the normalized result as
JSON. The category endpoint replaces the former three title-keyword searches,
so correctly categorized broadcasts are included even when their titles do not
contain `돌죽`, `DCSS`, or `Stone Soup`. Successful responses, including empty
lists, are cached for one minute. An upstream failure returns HTTP 503, with a
15-second failure backoff to avoid retry storms. No title matching is needed
because CHZZK provides separate categories for DCSS and Rhythm Stone Soup.

## Endpoints

- `GET /` or `GET /lives`: DCSS category live list
- `GET /health` or `GET /healthz`: process health

The API allows browser requests from CNC WebTiles, the test server, and the
local DWEM development server.

## Development

```sh
npm test
npm run check
npm start
```

## Deployment

```sh
docker-compose up -d
```

The production NGINX virtual host is provided in
`chzzk-api.nemelex.cards.conf` and proxies to the Compose-published port 43041.
