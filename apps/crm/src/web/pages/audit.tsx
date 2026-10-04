import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useApi } from '../api';
import { Alert, Empty, ErrorState, Loading } from '../components/ui';
import { fmtDateTime } from '../format';
import type { AuditItem } from '../types';
import { AuditDiff, commandLabel } from './lead-detail';

export function AuditPage() {
  const q = useApi<AuditItem[]>('/audit');
  const [command, setCommand] = useState('');
  const commands = [...new Set((q.data ?? []).map((a) => a.command))];
  const rows = (q.data ?? []).filter((a) => !command || a.command === command);
  return (
    <>
      <div className="page-head">
        <div><h1>Nhật ký audit</h1><p className="sub">Mọi thay đổi ghi kèm người làm, thời điểm, trước/sau. Append-only, lưu ≥ 5 năm (QĐ5).</p></div>
        <div className="field" style={{ minWidth: 200 }}>
          <label htmlFor="cmd-filter" className="visually-hidden">Lọc thao tác</label>
          <select id="cmd-filter" value={command} onChange={(e) => setCommand(e.target.value)}>
            <option value="">Mọi thao tác</option>
            {commands.map((c) => <option key={c} value={c}>{commandLabel(c)}</option>)}
          </select>
        </div>
      </div>
      <div style={{ marginBottom: 12 }}>
        <Alert tone="warn">Quyền xem audit theo vai trò đang ở trạng thái PROPOSED trong ma trận quyền v1. Bản đánh giá bật để kiểm tra; cần duyệt trước khi dùng thật.</Alert>
      </div>
      <div className="card">
        {q.isLoading && <div className="card-body"><Loading /></div>}
        {q.error && <div className="card-body"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div>}
        {q.data && rows.length === 0 && <Empty title="Chưa có bản ghi" icon="audit" />}
        {rows.length > 0 && (
          <div className="table-wrap">
            <table className="table responsive">
              <thead><tr><th>Thời điểm</th><th>Người thực hiện</th><th>Thao tác</th><th>Lead</th><th>Thay đổi</th></tr></thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id}>
                    <td className="nowrap num" data-label="Lúc">{fmtDateTime(a.createdAt)}</td>
                    <td data-label="Người">{a.actorName ?? a.actorKind}</td>
                    <td data-label="Thao tác">{commandLabel(a.command)}<div className="cell-sub">{a.entity}</div></td>
                    <td data-label="Lead"><Link to="/leads/$leadId" params={{ leadId: a.lead.id }} className="mono">{a.lead.code}</Link></td>
                    <td style={{ maxWidth: 420 }}><AuditDiff before={a.before} after={a.after} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
