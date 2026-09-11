# Cosmetics catalogue

`cosmetics-catalog.json` is an allowlisted projection of [ByMykel/CSGO-API](https://github.com/ByMykel/CSGO-API), commit `be84e43a2eb379faf653158e409a2c90c4072312`, downloaded 11 September 2026. The MIT license is preserved in `COSMETICS-LICENSE.txt`. Item artwork is served from the source's Steam image URLs and remains Valve's property.

To refresh intentionally, download `public/api/en/{skins,agents,stickers,keychains,music_kits}.json` from a single pinned commit into an external working directory. Put the commit hash in `commit.txt` in that directory, then run:

```text
python ops/cs2/build-cosmetics-catalog.py <download-directory>
```

Check categories and game compatibility, run `backend/test/cosmetics.test.js`, and deploy the backend. There is no external catalogue request at page render or backend startup. The server's checked definitions, paint indices and teams are authoritative; the browser sends only catalogue IDs and permitted personalization values.
