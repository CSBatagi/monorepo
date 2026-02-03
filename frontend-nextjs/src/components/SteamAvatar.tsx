"use client";

import { useEffect, useState } from 'react';
import Image from 'next/image';

interface SteamAvatarProps {
  steamId: string;
  playerName: string;
  size?: 'small' | 'medium' | 'large';
  showLink?: boolean;
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
  className = '' 
}: SteamAvatarProps) {
  const [steamData, setSteamData] = useState<SteamData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!steamId) {
      setLoading(false);
      return;
    }

    fetch(`/api/steam/avatar?steamid=${steamId}`)
      .then(res => res.json())
      .then(data => {
        setSteamData(data);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to fetch Steam avatar:', err);
        setError(true);
        setLoading(false);
      });
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
          alt={`${playerName} Steam Avatar`}
          width={sizePixels[size]}
          height={sizePixels[size]}
          className="object-cover"
          unoptimized // Steam avatars are already optimized
          onError={() => setError(true)}
        />
      )}
    </div>
  );

  if (showLink && steamData?.profileUrl) {
    return (
      <a 
        href={profileUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block hover:opacity-80 transition-opacity"
        title={`View ${playerName}'s Steam Profile`}
      >
        {avatarElement}
      </a>
    );
  }

  return avatarElement;
}
