import React from 'react';

interface KabileSelectProps {
  value: string;
  onChange: (value: string) => void;
  kabileList: string[];
  label?: string;
  loading?: boolean;
}

const KabileSelect: React.FC<KabileSelectProps> = ({ value, onChange, kabileList, label = 'Kabile', loading = false }) => {
  return (
    <div className="mb-2">
      {label && <label className="block text-xs font-medium text-gray-700 mb-1">{label}</label>}
      <select
        className="w-full border rounded px-2 py-1 text-xs focus:ring-blue-500 focus:border-blue-500"
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={loading}
      >
        <option value="">Select Kabile</option>
        {kabileList && kabileList.map((kabile) => (
          <option key={kabile} value={kabile}>{kabile}</option>
        ))}
      </select>
    </div>
  );
};

export default KabileSelect; 