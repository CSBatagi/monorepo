export interface Player {
  name: string;
  steamId: string;
  status: string; // e.g., "Aktif Oyuncu", "Adam Evde Yok"
}

export interface PlayerAttendance extends Player {
  attendanceStatus: string; // "coming", "not_coming", "no_response"
  emoji: string; // e.g., "normal", "tired"
} 