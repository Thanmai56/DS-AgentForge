import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Navbar } from './components/layout/Navbar';
import { Sidebar } from './components/layout/Sidebar';
import { GateApprovalModal } from './components/common/GateApprovalModal';
import { ChatRequirementPage } from './pages/ChatRequirementPage';
import { DatasphereCanvas } from './components/canvas/DatasphereCanvas';
import { CatalogPage } from './pages/CatalogPage';
import { LineagePage } from './pages/LineagePage';
import { RunsPage } from './pages/RunsPage';
import { ExportPage } from './pages/ExportPage';
import { ConnectionsPage } from './pages/ConnectionsPage';
import { useStore } from './store/useStore';
import { PlanPage } from './features/plan/PlanPage';

export const App: React.FC = () => {
  const { pendingGate } = useStore();

  return (
    <Router>
      <div className="flex flex-col h-screen w-screen overflow-hidden bg-[#F5F7FA] text-[#1D2D3E]">
        {/* Top Navigation */}
        <Navbar />

        {/* Main Body */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left Navigation */}
          <Sidebar currentGate={pendingGate.isOpen ? pendingGate.gateType : null} />

          {/* Page View */}
          <main className="flex-1 overflow-y-auto relative bg-[#F5F7FA]">
            <Routes>
              <Route path="/" element={<Navigate to="/chat" replace />} />
              <Route path="/chat" element={<ChatRequirementPage />} />
              <Route path="/plan" element={<PlanPage />} />
              <Route path="/canvas" element={<DatasphereCanvas />} />
              <Route path="/catalog" element={<CatalogPage />} />
              <Route path="/lineage" element={<LineagePage />} />
              <Route path="/runs" element={<RunsPage />} />
              <Route path="/export" element={<ExportPage />} />
              <Route path="/connections" element={<ConnectionsPage />} />
            </Routes>
          </main>
        </div>

        {/* Global Interrupt Gate Modal */}
        <GateApprovalModal />
      </div>
    </Router>
  );
};
