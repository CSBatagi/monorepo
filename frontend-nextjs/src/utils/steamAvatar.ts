/**
 * Get the Steam avatar URL for a given Steam ID
 * Steam IDs are in SteamID64 format (76561198...)
 * 
 * Steam provides avatars in three sizes:
 * - Small: 32x32px (_medium.jpg or no suffix)
 * - Medium: 64x64px (_medium.jpg)
 * - Full: 184x184px (_full.jpg)
 */

export function getSteamAvatarUrl(steamId: string, size: 'small' | 'medium' | 'full' = 'full'): string {
  if (!steamId) {
    return '';
  }

  // Steam Community avatar URL format
  // We'll use the Steam Community XML API to get the avatar URL
  // However, for direct access, we can construct the URL using a common pattern
  // The hash is not directly derivable from SteamID, so we'll use the Steam Community profile page
  
  // For now, return the Steam Community profile URL
  // In a real implementation, you'd fetch from Steam API or use a proxy
  const suffix = size === 'full' ? '_full.jpg' : size === 'medium' ? '_medium.jpg' : '.jpg';
  
  // This is a placeholder - in production you'd need to:
  // 1. Call Steam API to get the actual avatar hash
  // 2. Or use a backend proxy to fetch it
  // For now, we'll use the Steam community avatar CDN pattern
  
  return `https://avatars.steamstatic.com/${steamId}${suffix}`;
}

export function getSteamProfileUrl(steamId: string): string {
  if (!steamId) {
    return '';
  }
  return `https://steamcommunity.com/profiles/${steamId}`;
}
