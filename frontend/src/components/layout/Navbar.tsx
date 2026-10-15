import React from 'react';
import { Layers, Database } from 'lucide-react';
import { useStore } from '../../store/useStore';

export const Navbar: React.FC = () => {
  const { activeConnection } = useStore();

  return (
    <header className="h-12 border-b border-[#D9DDE3] bg-white px-5 flex items-center justify-between z-30 select-none shadow-2xs">
      <div className="flex items-center space-x-3">
        <div className="w-7 h-7 rounded bg-[#0070F2] flex items-center justify-center text-white font-bold text-xs shadow-xs">
          <Layers className="w-4 h-4" />
        </div>
        <div className="flex items-center space-x-2.5">
          <span className="font-bold tracking-tight text-[#1D2D3E] text-sm">SAP Datasphere ModelForge</span>
          <span className="text-[11px] text-[#738496] border-l border-[#D9DDE3] pl-2.5">Data Builder</span>
        </div>
      </div>

      <div className="flex items-center space-x-3 text-xs">
        <div className="flex items-center space-x-2 px-3 py-1 rounded bg-[#F5F7FA] border border-[#D9DDE3] text-xs">
          <Database className="w-3.5 h-3.5 text-[#0070F2]" />
          <span className="text-[#556B82]">Space:</span>
          <span className="font-semibold text-[#1D2D3E]">
            {activeConnection ? activeConnection.space : 'DSP_CUST_CONTENT'}
          </span>
        </div>
      </div>
    </header>
  );
};
