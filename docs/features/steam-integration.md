# Steam Integration

## Scope

Steam integration provides player avatars and profile links, mainly on the Oyuncular page.

## Main Components

- Component: `frontend-nextjs/src/components/SteamAvatar.tsx`
- API route: `frontend-nextjs/src/app/api/steam/avatar/route.ts`
- Utilities: `frontend-nextjs/src/utils/steamAvatar.ts`
- UI integration: `frontend-nextjs/src/app/oyuncular/OyuncularClient.tsx`

## API Contract

Endpoint:

- `GET /api/steam/avatar?steamid=<steamId64>`

Typical response fields:

- `steamId`
- `avatarUrl`
- `profileUrl`
- `personaName`

## Configuration

- Optional env var: `STEAM_API_KEY`
- Without key: fallback avatar/initial rendering is expected.
- Allowed image domains are configured in `frontend-nextjs/next.config.ts`.

## Behavior Notes

- Steam IDs are expected in SteamID64 format.
- Integration should fail gracefully (fallback UI) when API/key/network is unavailable.
