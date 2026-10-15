import React, { useState } from 'react';
import { AlertTriangle, CheckCircle, Info } from 'lucide-react';

interface ConfidenceBadgeProps {
  score?: number;
  reasons?: string[];
  size?: 'sm' | 'md';
}

export const ConfidenceBadge: React.FC<ConfidenceBadgeProps> = ({
  score = 1.0,
  reasons = [],
  size = 'sm',
}) => {
  const [showTooltip, setShowTooltip] = useState(false);
  const percentage = Math.round(score * 100);

  let badgeColor = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
  let Icon = CheckCircle;

  if (score < 0.75 && score >= 0.5) {
    badgeColor = 'bg-amber-500/10 text-amber-400 border-amber-500/30';
    Icon = AlertTriangle;
  } else if (score < 0.5) {
    badgeColor = 'bg-rose-500/10 text-rose-400 border-rose-500/30';
    Icon = AlertTriangle;
  }

  const isSmall = size === 'sm';

  return (
    <div className="relative inline-block">
      <div
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded-full border cursor-help font-medium ${badgeColor} ${
          isSmall ? 'text-[11px]' : 'text-xs px-2.5 py-1'
        }`}
      >
        <Icon className={isSmall ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
        <span>{percentage}% Confidence</span>
        {reasons.length > 0 && <Info className="w-2.5 h-2.5 opacity-60 ml-0.5" />}
      </div>

      {showTooltip && (
        <div className="absolute z-50 bottom-full mb-2 left-1/2 -translate-x-1/2 w-64 p-3 bg-slate-900 border border-slate-700 rounded-lg shadow-xl text-xs text-slate-300 pointer-events-none">
          <div className="font-semibold text-slate-100 mb-1 flex items-center justify-between">
            <span>Model Confidence</span>
            <span className="font-mono">{percentage}%</span>
          </div>
          {reasons.length > 0 ? (
            <ul className="list-disc pl-4 space-y-1 text-slate-400">
              {reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          ) : (
            <p className="text-slate-400">Deterministic validation and dictionary alignment passed cleanly.</p>
          )}
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-900" />
        </div>
      )}
    </div>
  );
};
