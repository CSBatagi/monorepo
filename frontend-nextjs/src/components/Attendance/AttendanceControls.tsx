import React from 'react';
import { Player } from '@/types';

interface AttendanceControlsProps {
  player: Player;
  currentAttendance: string; // "coming", "not_coming", "no_response"
  attendanceStates: string[];
  onAttendanceChange: (player: Player, newAttendance: string) => void;
  disabled: boolean;
  compact?: boolean; // For mobile compact view
}

const AttendanceControls: React.FC<AttendanceControlsProps> = ({
  player,
  currentAttendance,
  attendanceStates,
  onAttendanceChange,
  disabled,
  compact = false
}) => {

  const handleInteraction = (direction: 'left' | 'right') => {
    if (disabled) return;
    let currentIndex = attendanceStates.indexOf(currentAttendance);
    if (currentIndex === -1) currentIndex = 1; // Default to 'no_response' index if not found

    if (direction === 'left') {
      currentIndex = (currentIndex - 1 + attendanceStates.length) % attendanceStates.length;
    } else {
      currentIndex = (currentIndex + 1) % attendanceStates.length;
    }
    onAttendanceChange(player, attendanceStates[currentIndex]);
  };

  const handleClickLabel = (event: React.MouseEvent<HTMLSpanElement, MouseEvent>) => {
    if (disabled) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const direction = (clickX < rect.width / 2) ? 'left' : 'right';
    handleInteraction(direction);
  };

  const displayStatus = (status: string) => {
    // Turkish labels matching the original design
    const turkishLabels: { [key: string]: string } = {
      'no_response': 'Cevap yok',
      'uncertain': 'Belirsiz',
      'coming': 'Geliyor',
      'not_coming': 'Gelmiyor'
    };
    return turkishLabels[status] || status.replace("_", " ").toUpperCase();
  }

  const getStatusClasses = (status: string) => {
    if (status === 'coming') {
      return 'bg-green-100 text-green-700 hover:bg-green-200 border-green-300';
    } else if (status === 'not_coming') {
      return 'bg-red-100 text-red-700 hover:bg-red-200 border-red-300';
    } else if (status === 'uncertain') {
      return 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200 border-yellow-300';
    } else {
      return 'bg-gray-200 text-gray-700 border-gray-300 hover:bg-gray-300';
    }
  };

  return (
    <div className={`flex items-center justify-center h-8 ${compact ? 'space-x-0.5' : 'space-x-1'}`}>
      <button 
        className={`flex-shrink-0 rounded-full hover:bg-gray-200 disabled:opacity-50 disabled:hover:bg-transparent transition-colors flex items-center justify-center ${compact ? 'w-5 h-5 p-0.5' : 'w-6 h-6 p-1'}`}
        aria-label={`Previous status for ${player.name}`}
        onClick={() => handleInteraction('left')}
        disabled={disabled}
      >
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" className={compact ? 'w-3 h-3' : 'w-3 h-3'}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
        </svg>
      </button>
      <span 
        className={`
          font-medium cursor-pointer select-none 
          rounded text-center transition-colors duration-150 
          border whitespace-nowrap h-6 flex items-center justify-center w-20
          ${compact ? 'text-sm px-1.5 py-0.5' : 'text-base px-2 py-1'}
          ${getStatusClasses(currentAttendance)}
          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
        `}
        data-state={currentAttendance}
        onClick={handleClickLabel}
        title={displayStatus(currentAttendance)}
      >
        {displayStatus(currentAttendance)}
      </span>
      <button 
        className={`flex-shrink-0 rounded-full hover:bg-gray-200 disabled:opacity-50 disabled:hover:bg-transparent transition-colors flex items-center justify-center ${compact ? 'w-5 h-5 p-0.5' : 'w-6 h-6 p-1'}`}
        aria-label={`Next status for ${player.name}`}
        onClick={() => handleInteraction('right')}
        disabled={disabled}
      >
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" className={compact ? 'w-3 h-3' : 'w-3 h-3'}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
      </button>
    </div>
  );
};

export default AttendanceControls; 