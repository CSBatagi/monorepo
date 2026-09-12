"use client";

import { useEffect, useState } from 'react';
import Image from 'next/image';

interface SteamAvatarProps {
  steamId: string;
  playerName: string;
  size?: 'small' | 'medium' | 'large';
  showLink?: boolean;
  showName?: boolean;
  className?: string;
}

interface SteamData {
  avatarUrl: string;
  profileUrl: string;
  personaName?: string | null;
}

const defaultAvatar = 'https://avatars.akamai.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb_full.jpg';

export default function SteamAvatar({ 
  steamId, 
  playerName, 
  size = 'large',
  showLink = true,
  showName = false,
  className = '' 
}: SteamAvatarProps) {
  const [steamData, setSteamData] = useState<SteamData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setSteamData(null);
    setError(false);
    setLoading(true);
    if (!steamId) {
      setLoading(false);
      return;
    }

    fetch(`/api/steam/avatar?steamid=${encodeURIComponent(steamId)}`, { signal: controller.signal })
      .then(res => {
        if (!res.ok) throw new Error('Steam profile unavailable');
        return res.json();
      })
      .then(data => {
        if (controller.signal.aborted) return;
        setSteamData(data);
        setLoading(false);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setError(true);
        setLoading(false);
      });
    return () => controller.abort();
  }, [steamId]);

  const sizeClasses = {
    small: 'h-8 w-8',
    medium: 'h-16 w-16',
    large: 'h-24 w-24'
  };

  const sizePixels = {
    small: 32,
    medium: 64,
    large: 96
  };

  const initials = playerName ? playerName.charAt(0).toUpperCase() : '?';
  const avatarUrl = steamData?.avatarUrl || defaultAvatar;
  const profileUrl = steamData?.profileUrl || `https://steamcommunity.com/profiles/${steamId}`;
  const displayName = steamData?.personaName || playerName;

  const avatarElement = (
    <div className={`relative ${sizeClasses[size]} rounded-full overflow-hidden bg-blue-100 flex items-center justify-center ${className}`}>
      {loading ? (
        <div className="text-blue-700 font-semibold" style={{ fontSize: size === 'small' ? '14px' : size === 'medium' ? '24px' : '36px' }}>
          {initials}
        </div>
      ) : error || !steamData ? (
        <div className="text-blue-700 font-semibold" style={{ fontSize: size === 'small' ? '14px' : size === 'medium' ? '24px' : '36px' }}>
          {initials}
        </div>
      ) : (
        <Image
          src={avatarUrl}
          alt={`${displayName} Steam Avatar`}
          width={sizePixels[size]}
          height={sizePixels[size]}
          className="object-cover"
          unoptimized // Steam avatars are already optimized
          onError={() => setError(true)}
        />
      )}
    </div>
  );

  const content = showName ? <span className="inline-flex items-center gap-4 min-w-0">
    {avatarElement}<span className="steam-avatar-name">{displayName}</span>
  </span> : avatarElement;

  if (showLink && steamId) {
    return (
      <a 
        href={profileUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block hover:opacity-80 transition-opacity"
        title={`View ${displayName}'s Steam Profile`}
      >
        {content}
      </a>
    );
  }

  return content;
}
