import React, { useEffect, useState } from 'react';
import { Database, Search, RefreshCw, Key, ShieldAlert, FileSpreadsheet, Eye, ChevronRight, CheckCircle2 } from 'lucide-react';
import { api } from '../api/client';
import { CatalogTable } from '../types';
import { useStore } from '../store/useStore';

export const CatalogPage: React.FC = () => {
  const { activeConnection } = useStore();
  const [tables, setTables] = useState<CatalogTable[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedTable, setSelectedTable] = useState<CatalogTable | null>(null);
  const [isScanning, setIsScanning] = useState(false);

  const loadTables = async () => {
    try {
      setLoading(true);
      const res = await api.getCatalogTables({
        connection_id: activeConnection?.id,
        search: search.trim() || undefined,
      });
      setTables(res.items);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTables();
  }, [activeConnection, search]);

  const handleScan = async () => {
    if (!activeConnection) {
      alert('Please configure and select an active connection first.');
      return;
    }
    const secret = prompt(`Enter client secret for space ${activeConnection.space} to discover schema:`);
    if (!secret) return;

    try {
      setIsScanning(true);
      const res = await api.scanCatalog(activeConnection.id, secret);
      alert(`Space scan complete! Discovered ${res.scanned_count} objects.`);
      loadTables();
    } catch (err: any) {
      alert(`Scan failed: ${err.message}`);
    } finally {
      setIsScanning(false);
    }
  };

  const handleViewDetails = async (table: CatalogTable) => {
    try {
      const full = await api.getCatalogTable(table.id);
      setSelectedTable(full);
    } catch (err: any) {
      alert(`Could not load table columns: ${err.message}`);
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6 text-[#1D2D3E]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#1D2D3E] tracking-tight">Datasphere Space Catalog</h1>
          <p className="text-sm text-[#556B82] mt-1">
            Browse discovered SAP tables, views, primary keys, and automated semantic classifications.
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={handleScan}
            disabled={isScanning || !activeConnection}
            className="flex items-center space-x-2 px-4 py-2 rounded-lg bg-[#0070F2] hover:bg-[#0058C6] text-white font-semibold text-xs shadow-sm disabled:opacity-50 transition-all cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
            <span>{isScanning ? 'Scanning Space...' : 'Scan Datasphere Space'}</span>
          </button>
        </div>
      </div>

      {/* Search & Stats Bar */}
      <div className="flex items-center justify-between bg-white p-3 rounded-xl border border-[#D9DDE3] shadow-2xs">
        <div className="relative w-80">
          <Search className="w-4 h-4 text-[#8996A5] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search tables (e.g. VBAK, Orders, Customer)..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-[#FAFBFD] border border-[#D9DDE3] rounded-lg text-[#1D2D3E] placeholder-[#8996A5] focus:outline-none focus:border-[#0070F2] focus:bg-white"
          />
        </div>

        <div className="text-xs text-[#556B82]">
          Total Objects Discovered: <span className="font-semibold text-[#1D2D3E]">{tables.length}</span>
        </div>
      </div>

      {/* Table Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {tables.map((tbl) => (
          <div
            key={tbl.id}
            onClick={() => handleViewDetails(tbl)}
            className="p-4 rounded-xl bg-white border border-[#D9DDE3] hover:border-[#0070F2] hover:shadow-md cursor-pointer transition-all flex flex-col justify-between group"
          >
            <div>
              <div className="flex items-start justify-between">
                <div className="flex items-center space-x-2.5">
                  <div className="p-2 rounded-lg bg-[#EBF3FF] text-[#0070F2] border border-[#BBD7FD]">
                    <Database className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-bold text-[#1D2D3E] text-sm group-hover:text-[#0070F2] transition-colors font-mono">
                      {tbl.object_name}
                    </h3>
                    <div className="text-[11px] text-[#556B82] truncate max-w-[180px]">
                      {tbl.business_name || 'Datasphere Object'}
                    </div>
                  </div>
                </div>
                <div className="flex flex-col items-end space-y-1">
                  <span className={`text-[10px] uppercase font-mono px-1.5 py-0.5 rounded border font-semibold ${
                    tbl.is_remote
                      ? 'bg-[#EBF8FB] text-[#00A3C4] border-[#BCE8F1]'
                      : tbl.object_type === 'ANALYTIC_MODEL'
                      ? 'bg-[#EAF7EE] text-[#107E3E] border-[#A7E6BC]'
                      : 'bg-[#F5F7FA] text-[#556B82] border-[#D9DDE3]'
                  }`}>
                    {tbl.object_type}
                  </span>
                  {tbl.is_remote && (
                    <span className="text-[9px] font-mono px-1 rounded bg-[#EBF8FB] text-[#00A3C4] border border-[#BCE8F1]">
                      {tbl.remote_source || 'S/4HANA'}
                    </span>
                  )}
                </div>
              </div>

              {tbl.description && (
                <p className="text-xs text-[#556B82] mt-3 line-clamp-2">{tbl.description}</p>
              )}
            </div>

            <div className="mt-4 pt-3 border-t border-[#EDF1F7] flex items-center justify-between text-xs text-[#556B82]">
              <div className="flex items-center space-x-3 text-[11px]">
                <span>{tbl.column_count} cols</span>
                {tbl.row_count !== null && <span>{tbl.row_count.toLocaleString()} rows</span>}
                {tbl.is_remote && (
                  <span className={tbl.is_replicated ? 'text-[#107E3E] font-semibold' : 'text-[#E76500] font-semibold'}>
                    {tbl.is_replicated ? 'Replicated' : 'Federated'}
                  </span>
                )}
              </div>
              <ChevronRight className="w-4 h-4 text-[#8996A5] group-hover:text-[#0070F2] transition-transform group-hover:translate-x-0.5" />
            </div>
          </div>
        ))}

        {tables.length === 0 && !loading && (
          <div className="col-span-3 py-12 text-center rounded-xl border border-dashed border-[#D9DDE3] bg-white text-xs text-[#556B82] space-y-2">
            <Database className="w-8 h-8 text-[#8996A5] mx-auto" />
            <p>No tables found in this space catalog.</p>
            <p className="text-[#8996A5]">Run a Space Scan or adjust your search query.</p>
          </div>
        )}
      </div>

      {/* Table Details Modal */}
      {selectedTable && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-3xl bg-white border border-[#D9DDE3] rounded-xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
            <div className="px-6 py-4 border-b border-[#E5E9F0] flex items-center justify-between bg-[#FAFBFD]">
              <div className="flex items-center space-x-3">
                <div className="p-2 rounded-lg bg-[#EBF3FF] text-[#0070F2] border border-[#BBD7FD]">
                  <Database className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-semibold text-[#1D2D3E] text-base font-mono">{selectedTable.object_name}</h3>
                  <p className="text-xs text-[#556B82]">{selectedTable.business_name || 'SAP Space Object'}</p>
                </div>
              </div>
              <button
                onClick={() => setSelectedTable(null)}
                className="text-[#556B82] hover:text-[#1D2D3E] text-xs px-2.5 py-1 rounded hover:bg-[#F5F7FA] cursor-pointer"
              >
                Close
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4">
              <div className="text-xs font-semibold text-[#1D2D3E] uppercase tracking-wider">
                Columns & Semantic Classifications ({selectedTable.columns?.length || 0})
              </div>

              <div className="border border-[#E5E9F0] rounded-lg overflow-hidden divide-y divide-[#EDF1F7] text-xs bg-white">
                <div className="grid grid-cols-12 bg-[#F5F7FA] px-4 py-2 font-semibold text-[#556B82] text-[11px] border-b border-[#E5E9F0]">
                  <div className="col-span-4">Column Name</div>
                  <div className="col-span-2">Data Type</div>
                  <div className="col-span-3">Semantic Role</div>
                  <div className="col-span-3 text-right">Properties</div>
                </div>

                {selectedTable.columns?.map((c, i) => (
                  <div key={i} className="grid grid-cols-12 px-4 py-2.5 items-center hover:bg-[#F8FAFC]">
                    <div className="col-span-4 flex items-center space-x-2">
                      {c.is_key && <Key className="w-3 h-3 text-[#E76500] shrink-0" />}
                      <span className={c.is_key ? 'text-[#1D2D3E] font-semibold font-mono' : 'text-[#324558] font-mono'}>
                        {c.column_name}
                      </span>
                    </div>
                    <div className="col-span-2 text-[#556B82] font-mono text-[11px]">
                      {c.data_type || 'VARCHAR'}
                    </div>
                    <div className="col-span-3">
                      {c.semantic_role ? (
                        <span className="capitalize text-[#0070F2] bg-[#EBF3FF] px-2 py-0.5 rounded border border-[#BBD7FD] text-[10px] font-semibold">
                          {c.semantic_role}
                        </span>
                      ) : (
                        <span className="text-[#8996A5] text-[10px]">—</span>
                      )}
                    </div>
                    <div className="col-span-3 flex items-center justify-end space-x-2 text-[10px]">
                      {c.is_pii && (
                        <span className="px-1.5 py-0.5 rounded bg-[#FDF2F2] text-[#E53935] border border-[#F87171] font-medium">
                          PII Flagged
                        </span>
                      )}
                      {!c.is_nullable && (
                        <span className="px-1.5 py-0.5 rounded bg-[#F5F7FA] text-[#556B82] border border-[#D9DDE3]">
                          NOT NULL
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
