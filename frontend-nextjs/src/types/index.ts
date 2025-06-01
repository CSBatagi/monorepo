export interface Player {
  name: string;
  steamId: string;
  status: string; // e.g., "Aktif Oyuncu", "Adam Evde Yok", "coming", "not_coming", "no_response"
  avatar?: string; // Optional: URL to player's avatar

  // Last 10 games stats
  l10Hlt?: number | null;
  l10Adr?: number | null;
  l10Kd?: number | null;

  // Season stats
  sHlt?: number | null;
  sAdr?: number | null;
  sKd?: number | null;

  // Optional: stats object for team picker
  stats?: {
    L10_HLTV2?: number | null;
    L10_ADR?: number | null;
    L10_KD?: number | null;
    S_HLTV2?: number | null;
    S_ADR?: number | null;
    S_KD?: number | null;
  };

  // You might also want to store which team they are on, if any, directly here for easier filtering
  // assignedTeam?: 'A' | 'B' | null;
}

export interface PlayerAttendance extends Player {
  attendanceStatus: string; // "coming", "not_coming", "no_response"
  emoji: string; // e.g., "normal", "tired"
} 