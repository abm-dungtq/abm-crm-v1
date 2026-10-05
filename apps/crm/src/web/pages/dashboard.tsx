import { Link, Navigate } from '@tanstack/react-router';
import { lostReasonLabel, stageLabel } from '@abm/contracts';
import { useActor } from '../actor-context';
import { useApi } from '../api';
import { SCOPE_LABEL } from '../components/layout';
import { Alert, Avatar, Badge, Empty, ErrorState, HealthBadges, Kpi, Loading, StageBadge } from '../components/ui';
import { fmtDue, fmtMoney } from '../format';
import type { Dashboard } from '../types';

export function DashboardPage() {
  const actor = useActor();
  if (actor.role === 'teacher') return <Navigate to="/my-classes" />;
  if (actor.role === 'academic') return <Navigate to="/courses" />;
  if (actor.role === 'accountant') return <Navigate to="/fees" />;
  return <DashboardHome />;
}

function DashboardHome() {
  const actor = useActor();
  const q = useApi<Dashboard>('/dashboard');
  const isSale = actor.role === 'sale';
  const greeting = new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', weekday: 'long', day: 'numeric', month: 'numeric' }).format(new Date());

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Chào {actor.displayName.split(' ').slice(-1)[0]}</h1>
          <p className="sub">{greeting} · Phạm vi: {SCOPE_LABEL[actor.role]}</p>
        </div>
      </div>
      {q.isLoading && <Loading rows={6} />}
      {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.data && <DashboardBody data={q.data} isSale={isSale} canQueue={actor.role !== 'sale'} />}
    </>
  );
}

function DashboardBody({ data, isSale, canQueue }: { data: Dashboard; isSale: boolean; canQueue: boolean }) {
  const { kpi } = data;
  const partialHealth = Boolean(data.truncated.leads);
  const maxCount = Math.max(1, ...data.pipeline.map((p) => p.count));
  return (
    <>
      {(data.truncated.leads || data.truncated.tasks || data.truncated.attention || data.truncated.upcoming) && <Alert tone="warn">
        Danh sách cần xử lý và việc sắp tới chỉ hiển thị một phần. Số đếm lead, giá trị và việc được tính toàn bộ trong phạm vi của bạn.
        {partialHealth && ' Số trễ liên hệ lần đầu và quá SLA là số tối thiểu trên 500 lead gần nhất, kể cả cột Quá SLA theo Sale.'}
      </Alert>}
      <div className="kpis">
        <Kpi label={isSale ? 'Lead đang mở của tôi' : 'Lead đang mở'} value={kpi.activeLeads} note={`Pipeline ${fmtMoney(kpi.pipelineValue)}`} to="/leads" />
        <Kpi label="Việc hôm nay" value={kpi.tasksToday} to="/tasks" />
        <Kpi label="Việc quá hạn" value={kpi.overdueTasks} tone={kpi.overdueTasks ? 'danger' : undefined} to="/tasks" />
        <Kpi label="Trễ liên hệ lần đầu" value={`${partialHealth ? '≥ ' : ''}${kpi.firstContactBreaches}`} note="SLA 4 giờ làm việc" tone={kpi.firstContactBreaches ? 'danger' : undefined} />
        <Kpi label="Quá SLA stage" value={`${partialHealth ? '≥ ' : ''}${kpi.staleLeads}`} tone={kpi.staleLeads ? 'warn' : undefined} />
        {canQueue && <Kpi label="Hàng chờ chưa giao" value={kpi.queueLeads} tone={kpi.queueLeads ? 'warn' : undefined} to="/leads" search={{ tab: 'queue' }} />}
        <Kpi label="Won tháng này" value={kpi.wonCount} note={`${fmtMoney(kpi.wonValue)} · Lost ${kpi.lostCount}`} />
      </div>

      <div className="cols-main">
        <div className="grid">
          <section className="card" aria-labelledby="attention-h">
            <div className="card-head"><h2 id="attention-h">Cần xử lý</h2><span className="spacer" /><Badge tone={data.attention.length ? 'danger' : 'ok'}>{data.attention.length}</Badge></div>
            {data.attention.length === 0
              ? <Empty title={partialHealth ? 'Không có lead trễ hạn trong phần đã tải' : 'Không có lead trễ hạn'} icon="check">{partialHealth ? 'Thu hẹp bộ lọc trên trang Lead để kiểm tra thêm.' : 'Mọi lead đang mở đều đúng SLA và có Next Action còn hạn.'}</Empty>
              : (
                <ul className="list">
                  {data.attention.map((l) => (
                    <li key={l.id}>
                      <div className="row" style={{ alignItems: 'flex-start' }}>
                        <div className="stack-sm" style={{ gap: 4, flex: 1, minWidth: 0 }}>
                          <div className="row">
                            <span className="mono muted">{l.code}</span>
                            <Link to="/leads/$leadId" params={{ leadId: l.id }} className="cell-title truncate">{l.contactName}{l.account ? ` · ${l.account.name}` : ''}</Link>
                          </div>
                          <HealthBadges health={l.health} />
                          {l.nextAction && <span className="small text-2 truncate">Next: {l.nextAction.title} · {fmtDue(l.nextAction.dueAt)}</span>}
                        </div>
                        <div className="stack-sm hide-sm" style={{ alignItems: 'flex-end', gap: 4 }}>
                          <StageBadge stage={l.stage} />
                          {!isSale && <span className="small muted">{l.owner?.name}</span>}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
          </section>

          {!isSale && (
            <section className="card" aria-labelledby="bysale-h">
              <div className="card-head"><h2 id="bysale-h">Theo Sale</h2></div>
              <div className="table-wrap">
                <table className="table responsive">
                  <thead><tr><th>Sale</th><th className="right">Đang mở</th><th className="right">Pipeline</th><th className="right">Quá hạn</th><th className="right">Quá SLA</th><th className="right">Won / Lost tháng</th></tr></thead>
                  <tbody>
                    {data.bySale.map((s) => (
                      <tr key={s.id}>
                        <td><span className="row"><Avatar name={s.name} /><Link to="/leads" search={{ q: s.name }}>{s.name}</Link></span></td>
                        <td className="right num" data-label="Đang mở">{s.active}</td>
                        <td className="right num" data-label="Pipeline">{fmtMoney(s.value)}</td>
                        <td className="right num" data-label="Quá hạn">{s.overdue ? <Badge tone="danger">{s.overdue}</Badge> : 0}</td>
                        <td className="right num" data-label="Quá SLA">{partialHealth ? '≥ ' : ''}{s.stale ? <Badge tone="warn">{s.stale}</Badge> : 0}</td>
                        <td className="right num" data-label="Won / Lost">{s.won} / {s.lost}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>

        <div className="grid">
          <section className="card" aria-labelledby="pipe-h">
            <div className="card-head"><h2 id="pipe-h">Pipeline theo stage</h2><span className="spacer" /><Link to="/pipeline" className="small">Mở pipeline</Link></div>
            <div className="card-body funnel">
              {data.pipeline.map((p) => (
                <div className="funnel-row" key={p.stage}>
                  <span className="truncate">{stageLabel(p.stage)}</span>
                  <div className="bar-track" role="img" aria-label={`${p.count} lead`}><div className="bar-fill" style={{ width: `${(p.count / maxCount) * 100}%` }} /></div>
                  <span className="num right small" style={{ textAlign: 'right' }}>{p.count} · {fmtMoney(p.value)}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="card" aria-labelledby="up-h">
            <div className="card-head"><h2 id="up-h">Next Action sắp tới</h2><span className="spacer" /><Link to="/tasks" className="small">Tất cả việc</Link></div>
            {data.upcoming.length === 0 ? <Empty title="Không có việc đang mở" /> : (
              <ul className="list">
                {data.upcoming.map((t) => (
                  <li key={t.id}>
                    <div className="row">
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="truncate" style={{ fontWeight: 500 }}>{t.title}</div>
                        {t.lead.pipeline === 'learner'
                          ? <Link to="/learners/$contactId" params={{ contactId: t.lead.contactId }} className="small truncate" style={{ display: 'block' }}>{t.lead.code} · {t.lead.contactName}</Link>
                          : <Link to="/leads/$leadId" params={{ leadId: t.lead.id }} className="small truncate" style={{ display: 'block' }}>{t.lead.code} · {t.lead.contactName}</Link>}
                      </div>
                      <Badge tone={t.bucket === 'overdue' ? 'danger' : t.bucket === 'today' ? 'warn' : 'neutral'}>{fmtDue(t.dueAt)}</Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {data.lostReasons.length > 0 && (
            <section className="card" aria-labelledby="lost-h">
              <div className="card-head"><h2 id="lost-h">Lý do Lost tháng này</h2></div>
              <ul className="list">
                {data.lostReasons.map((r) => <li key={r.code} className="row"><span style={{ flex: 1 }}>{lostReasonLabel(r.code)}</span><span className="num">{r.count}</span></li>)}
              </ul>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
