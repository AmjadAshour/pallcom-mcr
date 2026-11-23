import React, { useEffect, useState } from 'react';
import { api } from '../context/api.js';
import { useMcrStore } from '../context/useMcrStore.js';
import { translations } from '../i18n/translations.js';
import { Card, CardHeader, CardTitle, CardContent, Input, Button } from '@mcr/ui';
import { FileText, Search, Download } from 'lucide-react';

export function ActivityLogsPage() {
  const { language } = useMcrStore();
  const t = translations[language] || translations.en;
  const [searchTerm, setSearchTerm] = useState('');

  const [logs, setLogs] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    api('/logs', { signal: controller.signal }).then(({ data }) => {
      setLogs(data.map((log) => ({
        id: log.id, timestamp: log.createdAt, operator: log.userId || 'System',
        action: log.action, resource: log.resourceId || log.resourceType,
        details: JSON.stringify(log.details || {}), ip: log.ipAddress || '',
        status: /FAILED|DENIED/.test(log.action) ? 'BLOCKED' : 'SUCCESS'
      })));
    }).catch((failure) => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, []);

  function exportCsv() {
    const columns = ['timestamp', 'operator', 'action', 'resource', 'details', 'ip', 'status'];
    const cell = (value) => {
      const text = String(value ?? '');
      const escaped = /^[\s=+@-]/.test(text) ? "'" + text : text;
      return '"' + escaped.replaceAll('"', '""') + '"';
    };
    const csv = [columns.join(','), ...filteredLogs.map((log) => columns.map((column) => cell(log[column])).join(','))].join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'mcr-audit.csv';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const filteredLogs = logs.filter(
    (l) =>
      l.action.toLowerCase().includes(searchTerm.toLowerCase()) ||
      l.details.toLowerCase().includes(searchTerm.toLowerCase()) ||
      l.operator.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-4">{error && <p role="alert">{error}</p>}
      <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-cyan-400" />
          <h1 className="text-base font-bold font-mono text-white uppercase tracking-wide">
            {t.nav.activityLogs}
          </h1>
        </div>

        <Button variant="outline" size="sm" className="text-xs" onClick={exportCsv} disabled={!filteredLogs.length}>
          <Download className="w-3.5 h-3.5 me-1" />
          Export Audit Trail (CSV)
        </Button>
      </div>

      <Card>
        <CardHeader className="flex justify-between items-center">
          <CardTitle>System & Command Audit Trail</CardTitle>
          <div className="w-64">
            <Input
              placeholder="Search actions, operators, IP..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-8 text-xs font-mono"
            />
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-zinc-950 text-zinc-400 uppercase border-b border-zinc-800">
                <tr>
                  <th className="p-2.5">Timestamp</th>
                  <th className="p-2.5">Operator</th>
                  <th className="p-2.5">Action</th>
                  <th className="p-2.5">Resource</th>
                  <th className="p-2.5">Details</th>
                  <th className="p-2.5">Origin IP</th>
                  <th className="p-2.5">Outcome</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {filteredLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-zinc-800/30">
                    <td className="p-2.5 text-zinc-400 whitespace-nowrap">{log.timestamp}</td>
                    <td className="p-2.5 font-bold text-white whitespace-nowrap">{log.operator}</td>
                    <td className="p-2.5 text-cyan-400 font-bold whitespace-nowrap">{log.action}</td>
                    <td className="p-2.5 text-zinc-300">{log.resource}</td>
                    <td className="p-2.5 text-zinc-400 truncate max-w-xs">{log.details}</td>
                    <td className="p-2.5 text-zinc-500 whitespace-nowrap">{log.ip}</td>
                    <td className="p-2.5 whitespace-nowrap">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          log.status === 'SUCCESS'
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                            : 'bg-red-500/10 text-red-400 border border-red-500/30'
                        }`}
                      >
                        {log.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

