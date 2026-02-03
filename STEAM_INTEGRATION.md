# Steam Profile Integration

This document describes the Steam profile picture integration added to the CS Batağı website.

## Features

1. **Steam Profile Pictures**: Player avatars are fetched from Steam's API and displayed on the Oyuncular (Players) page
2. **Clickable Avatars**: Clicking on a player's avatar opens their Steam Community profile in a new tab
3. **Tab Navigation**: Small avatar thumbnails appear next to player names in the tab navigation
4. **Fallback Support**: If Steam API is unavailable or no API key is configured, initials are shown instead

## Components

### SteamAvatar Component
Location: `src/components/SteamAvatar.tsx`

A reusable React component that fetches and displays Steam profile pictures.

**Props:**
- `steamId`: Steam ID (SteamID64 format, e.g., "76561198...")
- `playerName`: Player's name (used for fallback initials)
- `size`: Avatar size - 'small' (32px), 'medium' (64px), or 'large' (96px)
- `showLink`: Whether to make the avatar clickable (links to Steam profile)
- `className`: Additional CSS classes

**Usage:**
```tsx
<SteamAvatar 
  steamId="76561198047085527" 
  playerName="bobinaj" 
  size="large"
  showLink={true}
/>
```

### Steam Avatar API Route
Location: `src/app/api/steam/avatar/route.ts`

Server-side API endpoint that fetches player data from Steam Web API.

**Endpoint:** `GET /api/steam/avatar?steamid={steamId}`

**Response:**
```json
{
  "steamId": "76561198047085527",
  "avatarUrl": "https://avatars.akamai.steamstatic.com/.../avatar_full.jpg",
  "profileUrl": "https://steamcommunity.com/profiles/76561198047085527",
  "personaName": "Player Name"
}
```

## Configuration

### Steam API Key (Optional)

To enable full Steam integration with real avatars:

1. Get a Steam Web API key from: https://steamcommunity.com/dev/apikey
2. Add to your `.env.local` file:
   ```
   STEAM_API_KEY=your_steam_api_key_here
   ```

**Note:** The integration works without an API key, but will show a default Steam avatar instead of the actual player avatar.

### Next.js Image Configuration

The following Steam CDN domains are whitelisted in `next.config.ts`:
- `avatars.steamstatic.com`
- `avatars.akamai.steamstatic.com`
- `steamcdn-a.akamaihd.net`

## Implementation Details

### Steam ID Format
- The app uses SteamID64 format (e.g., "76561198047085527")
- This is stored in `public/data/players.json` and database

### Caching
- Steam avatar data is cached for 1 hour (3600 seconds) using Next.js's `next.revalidate` feature
- Client-side: Avatar data is fetched once per component mount

### Error Handling
- If Steam API is unavailable, shows player initials
- If image fails to load, falls back to initials
- Network errors are logged to console but don't break the UI

## Where It's Used

### Oyuncular Page
1. **Main Profile Card**: Large (96px) avatar with link to Steam profile
2. **Tab Navigation**: Small (32px) avatars next to player names in tabs

Future implementations can use this component in:
- Match results pages
- Team picker
- Leaderboards
- Any player listing

## Testing

To test the integration:

1. **Without API Key**: Default avatar + initials should appear
2. **With API Key**: Real Steam avatars should load
3. **Network Failure**: Should gracefully fall back to initials
4. **Invalid Steam ID**: Should show initials

## Related Files

- `/src/components/SteamAvatar.tsx` - Main component
- `/src/app/api/steam/avatar/route.ts` - API endpoint
- `/src/utils/steamAvatar.ts` - Utility functions
- `/src/app/oyuncular/OyuncularClient.tsx` - Implementation example
- `next.config.ts` - Image domain configuration
- `.env.local.example` - Environment variables template
