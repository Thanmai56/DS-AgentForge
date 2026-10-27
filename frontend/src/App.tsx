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
import { clearGeneratedBrowserState } from './utils/generatedBrowserState';

const SERVER_INSTANCE_STORAGE_KEY = 'ds-agentforge-server-instance';

interface NativeExportBoundaryState {
  error: Error | null;
  renderKey: number;
}

class NativeExportErrorBoundary extends React.Component<
  React.PropsWithChildren,
  NativeExportBoundaryState
> {
  state: NativeExportBoundaryState = { error: null, renderKey: 0 };

  static getDerivedStateFromError(error: Error): Partial<NativeExportBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Native Export failed to render.', error, info.componentStack);
  }

  private retry = () => {
    this.setState((state) => ({ error: null, renderKey: state.renderKey + 1 }));
  };

  render() {
    if (this.state.error) {
      return (
        <section className="m-8 rounded-xl border border-[#F1B4B4] bg-white p-6 text-[#1D2D3E]" role="alert">
          <h1 className="text-lg font-bold">Native Export could not be generated</h1>
          <p className="mt-2 text-sm text-[#556B82]">
            The export data may be incomplete or contain a generation error. The error is shown below.
          </p>
          <pre className="mt-4 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-[#F8FAFC] p-3 text-xs text-[#B42318]">
            {this.state.error.message}
          </pre>
          <button
            type="button"
            onClick={this.retry}
            className="mt-4 rounded-lg bg-[#0070F2] px-4 py-2 text-xs font-semibold text-white hover:bg-[#0058C6]"
          >
            Try again
          </button>
        </section>
      );
    }

    return <ExportPage key={this.state.renderKey} />;
  }
}

export const App: React.FC = () => {
  const { pendingGate } = useStore();

  React.useEffect(() => {
    let isMounted = true;
    let isChecking = false;
    let hasLoggedError = false;

    const checkServerInstance = async () => {
      if (isChecking) return;
      isChecking = true;

      try {
        const response = await fetch('/api/runtime', { cache: 'no-store' });
        if (!response.ok) {
          throw new Error(`Runtime check failed with status ${response.status}`);
        }

        const runtime: unknown = await response.json();
        if (
          !runtime
          || typeof runtime !== 'object'
          || !('instance_id' in runtime)
          || typeof runtime.instance_id !== 'string'
          || runtime.instance_id.length === 0
        ) {
          throw new Error('Runtime response did not contain a valid instance ID');
        }
        if (!isMounted) return;

        const previousInstanceId = localStorage.getItem(SERVER_INSTANCE_STORAGE_KEY);
        if (previousInstanceId && previousInstanceId !== runtime.instance_id) {
          clearGeneratedBrowserState();
          localStorage.setItem(SERVER_INSTANCE_STORAGE_KEY, runtime.instance_id);
          window.location.reload();
          return;
        }

        localStorage.setItem(SERVER_INSTANCE_STORAGE_KEY, runtime.instance_id);
        hasLoggedError = false;
      } catch (error) {
        if (!hasLoggedError) {
          console.warn('Unable to check the backend runtime identity.', error);
          hasLoggedError = true;
        }
      } finally {
        isChecking = false;
      }
    };

    void checkServerInstance();
    const intervalId = window.setInterval(() => void checkServerInstance(), 5000);
    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, []);

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
              <Route
                path="/export"
                element={(
                  <NativeExportErrorBoundary>
                    <ExportPage />
                  </NativeExportErrorBoundary>
                )}
              />
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
