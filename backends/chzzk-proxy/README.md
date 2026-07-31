# CHZZK live proxy

This backend searches CHZZK for `돌죽`, `DCSS`, and `Stone Soup`, verifies the
terms against each live title, merges duplicate broadcasts, and returns the
result as JSON. Successful responses, including empty lists, are cached for one
minute. Any partial upstream failure returns HTTP 503 instead of stale or
partial data, with a 15-second failure backoff to avoid retry storms. Titles
containing `리듬돌죽` or `리듬 돌죽` are excluded.

## Endpoints

- `GET /` or `GET /lives`: aggregated live list
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
