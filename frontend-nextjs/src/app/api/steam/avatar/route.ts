import { NextRequest, NextResponse } from 'next/server';

// Steam Web API endpoint to get player summaries
// You'll need to set STEAM_API_KEY in your environment variables
// Get one from: https://steamcommunity.com/dev/apikey

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const steamId = searchParams.get('steamid');

  if (!steamId) {
    return NextResponse.json({ error: 'Missing steamid parameter' }, { status: 400 });
  }

  const apiKey = process.env.STEAM_API_KEY;
  
  if (!apiKey) {
    // If no API key is set, return a default Steam profile URL
    return NextResponse.json({
      steamId,
      avatarUrl: `https://avatars.akamai.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb_full.jpg`, // Default Steam avatar
      profileUrl: `https://steamcommunity.com/profiles/${steamId}`,
      personaName: null,
    });
  }

  try {
    const response = await fetch(
      `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${apiKey}&steamids=${steamId}`,
      {
        next: { revalidate: 3600 }, // Cache for 1 hour
      }
    );

    if (!response.ok) {
      throw new Error('Failed to fetch from Steam API');
    }

    const data = await response.json();
    
    if (!data.response?.players?.[0]) {
      return NextResponse.json({ error: 'Player not found' }, { status: 404 });
    }

    const player = data.response.players[0];

    return NextResponse.json({
      steamId: player.steamid,
      avatarUrl: player.avatarfull || player.avatarmedium || player.avatar,
      profileUrl: player.profileurl,
      personaName: player.personaname,
    });
  } catch (error) {
    console.error('Error fetching Steam avatar:', error);
    return NextResponse.json(
      { 
        error: 'Failed to fetch Steam data',
        steamId,
        avatarUrl: `https://avatars.akamai.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb_full.jpg`,
        profileUrl: `https://steamcommunity.com/profiles/${steamId}`,
      },
      { status: 500 }
    );
  }
}
