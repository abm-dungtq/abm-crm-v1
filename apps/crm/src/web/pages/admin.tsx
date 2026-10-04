import { LEAD_SOURCES, LOST_REASONS, STAGES, WORKDAY } from '@abm/contracts';
import { useActor } from '../actor-context';
import { useApi } from '../api';
import { roleLabel } from '../components/layout';
import { Alert, Badge, ErrorState, Loading } from '../components/ui';
import type { AdminOverview } from '../types';

export function AdminPage() {
  const actor = useActor();
  const q = useApi<AdminOverview>(actor.role === 'admin' ? '/admin/overview' : null);
  if (actor.role !== 'admin') return <Alert tone="warn">Chỉ Admin xem cấu hình.</Alert>;
  return (
    <>
      <div className="page-head">
        <div><h1>Cấu hình</h1><p className="sub">Admin quản trị cấu hình, không có quyền nghiệp vụ trên dữ liệu khách (ma trận quyền v1).</p></div>
      </div>
      {q.isLoading && <Loading />}
      {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.data && (
        <div className="grid">
          <div className="kpis" style={{ marginBottom: 0 }}>
            <div className="card kpi"><span className="kpi-label">Lead</span><span className="kpi-value">{q.data.counts.leads}</span></div>
            <div className="card kpi"><span className="kpi-label">Bản ghi audit</span><span className="kpi-value">{q.data.counts.audit}</span></div>
            <div className="card kpi"><span className="kpi-label">Outbox chờ gửi</span><span className="kpi-value">{q.data.counts.outboxPending}</span><span className="kpi-note">Chưa có consumer ở bản đánh giá</span></div>
            <div className="card kpi"><span className="kpi-label">Yêu cầu chờ duyệt</span><span className="kpi-value">{q.data.counts.approvalsPending}</span></div>
          </div>
          <div className="cols-2">
            <section className="card">
              <div className="card-head"><h2>Người dùng</h2><span className="spacer" /><Badge>{q.data.users.length}</Badge></div>
              <div className="table-wrap">
                <table className="table responsive">
                  <thead><tr><th>Tên</th><th>Vai trò</th><th>Team</th></tr></thead>
                  <tbody>
                    {q.data.users.map((u) => (
                      <tr key={u.id}><td><div className="cell-title">{u.name}</div><div className="cell-sub">{u.email}</div></td><td data-label="Vai trò">{roleLabel(u.role)}</td><td data-label="Team">{u.teamName ?? u.departmentName ?? '—'}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            <section className="card">
              <div className="card-head"><h2>Stage &amp; SLA (QĐ1)</h2></div>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Stage</th><th className="right">SLA</th></tr></thead>
                  <tbody>
                    {STAGES.map((s) => (
                      <tr key={s.code}><td>{s.label}</td><td className="right num">{s.code === 'new' ? 'Liên hệ đầu 4 giờ LV; nhả sau 24 giờ LV' : s.slaWorkingDays ? `${s.slaWorkingDays} ngày LV` : 'Kết thúc'}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="card-foot small text-2">Giờ làm việc {WORKDAY.start}–{WORKDAY.end} ({WORKDAY.timeZone}), thứ 2–6. Lịch nghỉ lễ cần cấu hình trước vận hành.</div>
            </section>
            <section className="card">
              <div className="card-head"><h2>Lý do Lost (PRD 10.6)</h2></div>
              <ul className="list">{LOST_REASONS.map((r) => <li key={r.code}>{r.label}{r.code === 'other' && <span className="muted small"> · bắt buộc ghi chú</span>}</li>)}</ul>
            </section>
            <section className="card">
              <div className="card-head"><h2>Nguồn lead đang bật</h2></div>
              <div className="card-body chips">{LEAD_SOURCES.map((s) => <Badge key={s.code} tone="accent">{s.label}</Badge>)}</div>
              <div className="card-head" style={{ borderTop: '1px solid var(--border)' }}><h2>Team</h2></div>
              <ul className="list">{q.data.teams.map((t) => <li key={t.id}>{t.name} <span className="muted small">· {t.departmentName}</span></li>)}</ul>
            </section>
          </div>
        </div>
      )}
    </>
  );
}
