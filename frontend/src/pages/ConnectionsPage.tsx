import React, { useEffect, useState } from 'react';
import { Database, Plus, Trash2, CheckCircle2, XCircle, RefreshCw, Key, ShieldCheck, Server } from 'lucide-react';
import { api } from '../api/client';
import { Connection } from '../types';
import { useStore } from '../store/useStore';

export const ConnectionsPage: React.FC = () => {
  const { activeConnection, setActiveConnection } = useStore();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);

  // Form state
  const [form, setForm] = useState({
    name: 'Production Datasphere Space',
    tenant_host: 'https://my-datasphere-tenant.eu10.hnc.ondemand.com',
    oauth_token_url: 'https://my-datasphere.authentication.eu10.hana.ondemand.com/oauth/token',
    client_id: 'sb-datasphere-client',
    client_secret: '',
    space: 'SALES_ANALYTICS',
    ds_release: '2024.Q3',
    jdbc_host: '',
    jdbc_port: 443,
  });

  const loadConnections = async () => {
    try {
      setLoading(true);
      const data = await api.getConnections();
      setConnections(data);
      if (data.length > 0 && !activeConnection) {
        setActiveConnection(data[0]);
      }
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConnections();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.client_secret) {
      alert('Client Secret is required for testing and live access.');
      return;
    }
    try {
      const newConn = await api.createConnection(form);
      setConnections((prev) => [...prev, newConn]);
      setActiveConnection(newConn);
      setShowModal(false);
    } catch (err: any) {
      alert(`Failed to save connection: ${err.message}`);
    }
  };

  const handleTest = async (connId: string) => {
    try {
      setTestingId(connId);
      const res = await api.testConnection(connId);
      if (res.connected) {
        alert(`Connected successfully to space ${res.space_detected || 'target space'}!`);
      } else {
        alert(`Connection test failed: ${res.message}`);
      }
    } catch (err: any) {
      alert(`Test failed: ${err.message}`);
    } finally {
      setTestingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this connection?')) return;
    try {
      await api.deleteConnection(id);
      setConnections((prev) => prev.filter((c) => c.id !== id));
      if (activeConnection?.id === id) {
        setActiveConnection(null);
      }
    } catch (err: any) {
      alert(`Failed to delete: ${err.message}`);
    }
  };

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6 text-[#1D2D3E]">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#1D2D3E] tracking-tight">Datasphere Space Connections</h1>
          <p className="text-sm text-[#556B82] mt-1">
            Manage credentials for SAP Datasphere spaces. Connect OAuth2 service keys to scan schemas and deploy CSN 2.0 packages.
          </p>
        </div>

        <button
          onClick={() => setShowModal(true)}
          className="flex items-center space-x-2 px-4 py-2 rounded-lg bg-[#0070F2] hover:bg-[#0058C6] text-white font-semibold text-xs shadow-sm transition-all cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>New Connection</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {connections.map((c) => {
          const isActive = activeConnection?.id === c.id;

          return (
            <div
              key={c.id}
              className={`p-5 rounded-xl border transition-all flex flex-col justify-between space-y-4 bg-white ${
                isActive
                  ? 'border-[#0070F2] ring-2 ring-[#0070F2]/20 shadow-md'
                  : 'border-[#D9DDE3] hover:border-[#0070F2]/60 shadow-sm'
              }`}
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="p-2.5 rounded-lg bg-[#EBF3FF] text-[#0070F2] border border-[#BBD7FD]">
                      <Server className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-bold text-[#1D2D3E] text-base">{c.name}</h3>
                      <div className="flex items-center space-x-2 text-xs text-[#556B82] mt-0.5">
                        <span className="font-mono text-[#0070F2] font-semibold">{c.space}</span>
                        <span>•</span>
                        <span>{c.ds_release || '2024.Q3'}</span>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => handleDelete(c.id)}
                    className="p-1 rounded text-[#8996A5] hover:text-[#E53935] hover:bg-[#FDF2F2] transition-colors cursor-pointer"
                    title="Delete connection"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                <div className="p-3 bg-[#FAFBFD] rounded-lg border border-[#E5E9F0] text-xs space-y-1.5 font-mono text-[#556B82]">
                  <div className="truncate">Host: {c.tenant_host}</div>
                  <div className="truncate">Client: {c.client_id}</div>
                </div>
              </div>

              <div className="pt-3 border-t border-[#EDF1F7] flex items-center justify-between text-xs">
                <button
                  onClick={() => handleTest(c.id)}
                  disabled={testingId === c.id}
                  className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-[#FAFBFD] hover:bg-[#F5F7FA] text-[#324558] border border-[#D9DDE3] font-medium transition-colors cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${testingId === c.id ? 'animate-spin text-[#0070F2]' : ''}`} />
                  <span>{testingId === c.id ? 'Testing...' : 'Test Connection'}</span>
                </button>

                <button
                  onClick={() => setActiveConnection(c)}
                  disabled={isActive}
                  className={`px-3.5 py-1.5 rounded-lg font-semibold transition-all cursor-pointer ${
                    isActive
                      ? 'bg-[#EAF7EE] text-[#107E3E] border border-[#A7E6BC] cursor-default'
                      : 'bg-[#0070F2] hover:bg-[#0058C6] text-white shadow-xs'
                  }`}
                >
                  {isActive ? 'Active Space' : 'Set as Active'}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-xl bg-white border border-[#D9DDE3] rounded-xl shadow-2xl p-6 space-y-4">
            <h2 className="text-lg font-bold text-[#1D2D3E]">New SAP Datasphere Space Connection</h2>

            <form onSubmit={handleCreate} className="space-y-3 text-xs">
              <div>
                <label className="block text-[#324558] font-semibold mb-1">Connection Label</label>
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 py-2 bg-[#FAFBFD] border border-[#D9DDE3] rounded-lg text-[#1D2D3E] focus:outline-none focus:border-[#0070F2]"
                />
              </div>

              <div>
                <label className="block text-[#324558] font-semibold mb-1">Target Space Name</label>
                <input
                  type="text"
                  required
                  value={form.space}
                  onChange={(e) => setForm({ ...form, space: e.target.value })}
                  className="w-full px-3 py-2 bg-[#FAFBFD] border border-[#D9DDE3] rounded-lg text-[#1D2D3E] font-mono focus:outline-none focus:border-[#0070F2]"
                />
              </div>

              <div>
                <label className="block text-[#324558] font-semibold mb-1">Tenant Host URL</label>
                <input
                  type="url"
                  required
                  value={form.tenant_host}
                  onChange={(e) => setForm({ ...form, tenant_host: e.target.value })}
                  className="w-full px-3 py-2 bg-[#FAFBFD] border border-[#D9DDE3] rounded-lg text-[#1D2D3E] font-mono focus:outline-none focus:border-[#0070F2]"
                />
              </div>

              <div>
                <label className="block text-[#324558] font-semibold mb-1">OAuth Token URL</label>
                <input
                  type="url"
                  required
                  value={form.oauth_token_url}
                  onChange={(e) => setForm({ ...form, oauth_token_url: e.target.value })}
                  className="w-full px-3 py-2 bg-[#FAFBFD] border border-[#D9DDE3] rounded-lg text-[#1D2D3E] font-mono focus:outline-none focus:border-[#0070F2]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[#324558] font-semibold mb-1">Client ID</label>
                  <input
                    type="text"
                    required
                    value={form.client_id}
                    onChange={(e) => setForm({ ...form, client_id: e.target.value })}
                    className="w-full px-3 py-2 bg-[#FAFBFD] border border-[#D9DDE3] rounded-lg text-[#1D2D3E] font-mono focus:outline-none focus:border-[#0070F2]"
                  />
                </div>
                <div>
                  <label className="block text-[#324558] font-semibold mb-1">Client Secret</label>
                  <input
                    type="password"
                    required
                    value={form.client_secret}
                    onChange={(e) => setForm({ ...form, client_secret: e.target.value })}
                    className="w-full px-3 py-2 bg-[#FAFBFD] border border-[#D9DDE3] rounded-lg text-[#1D2D3E] font-mono focus:outline-none focus:border-[#0070F2]"
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-[#E5E9F0] flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 bg-white hover:bg-[#F5F7FA] text-[#556B82] border border-[#D9DDE3] rounded-lg font-medium cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-[#0070F2] hover:bg-[#0058C6] text-white rounded-lg font-semibold shadow-xs cursor-pointer"
                >
                  Save Connection
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
