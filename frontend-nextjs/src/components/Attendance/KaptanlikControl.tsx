import React from 'react';
import { Player } from '@/types';

interface KaptanlikControlProps {
  player: Player;
  isKaptan: boolean;
  attendanceStatus: string;
  onKaptanlikChange: (player: Player, isKaptan: boolean) => void;
  disabled: boolean;
}

const KaptanlikControl: React.FC<KaptanlikControlProps> = ({
  player,
  isKaptan,
  attendanceStatus,
  onKaptanlikChange,
  disabled
}) => {
  // Only show checkbox if attendance status is "coming"
  const isComingStatus = attendanceStatus === 'coming';
  
  if (!isComingStatus) {
    return (
      <div className="flex items-center justify-center h-8 w-8">
        <span className="text-gray-300">-</span>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center h-8 w-8">
      <label className="flex items-center cursor-pointer">
        <input
          type="checkbox"
          checked={isKaptan}
          onChange={(e) => onKaptanlikChange(player, e.target.checked)}
          disabled={disabled}
          className="w-5 h-5 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          title={isKaptan ? 'Kaptanlık yapacak' : 'Kaptanlık yapmak için tıkla'}
        />
      </label>
    </div>
  );
};

export default KaptanlikControl;
