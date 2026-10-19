import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  MessageSquareCode,
  Layers,
  FolderGit2,
  LayoutDashboard,
  Database,
  History,
  Download,
  Settings2
} from 'lucide-react';

interface SidebarProps {
  currentGate?: string | null;
}

export const Sidebar: React.FC<SidebarProps> = ({ currentGate }) => {
  const navItems = [
    { to: '/chat', label: 'Requirement AI', icon: MessageSquareCode, badge: currentGate ? 'Pending' : undefined },
    { to: '/plan', label: 'Modeling Plan', icon: Layers },
    { to: '/lineage', label: 'Data Lineage', icon: FolderGit2 },
    { to: '/canvas', label: 'Model Canvas', icon: LayoutDashboard },
    { to: '/catalog', label: 'Space Catalog', icon: Database },
    { to: '/runs', label: 'Agent Runs', icon: History },
    { to: '/export', label: 'Native Export', icon: Download },
    { to: '/connections', label: 'Connections', icon: Settings2 },
  ];

  return (
    <aside className="w-54 bg-white border-r border-[#D9DDE3] flex flex-col justify-between py-3 select-none">
      <div className="space-y-1 px-2.5">
        <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-[#738496]">
          Navigation
        </div>
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                  isActive
                    ? 'bg-[#EBF3FF] text-[#0070F2] font-semibold border border-[#BBD7FD]'
                    : 'text-[#324558] hover:bg-[#F5F7FA] hover:text-[#1D2D3E]'
                }`
              }
            >
              <div className="flex items-center space-x-2.5">
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
              </div>
              {item.badge && (
                <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-[#FFF5ED] text-[#E76500] font-bold border border-[#FCD5B5]">
                  {item.badge}
                </span>
              )}
            </NavLink>
          );
        })}
      </div>
    </aside>
  );
};
