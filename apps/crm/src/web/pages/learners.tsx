import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { LEARNER_STAGES } from '@abm/contracts';
import { useActor } from '../actor-context';
import { useApi, useCommand } from '../api';
import { Alert, Badge, Empty, ErrorState, FormError, Loading, useToast } from '../components/ui';
import { fmtDate } from '../format';
import type { AdminOverview, LearnerList, Member } from '../types';

const WRITERS = ['sale', 'leader', 'admin'];
export const canWriteLearners = (role: string) => WRITERS.includes(role);

/** People who may hold a customer, as far as the viewer can list them: the team for a Leader, everyone for Admin. */
export function useOwnerOptions(): Member[] {
  const actor = useActor();
  const team = useApi<Member[]>(actor.role === 'leader' ? '/team-members' : null);
  const overview = useApi<AdminOverview>(actor.role === 'admin' ? '/admin/overview' : null);
  if (actor.role === 'leader') return team.data ?? [];
  if (actor.role === 'admin') {
    return (overview.data?.users ?? []).filter((u) => u.status === 'active' && (u.role === 'sale' || u.role === 'leader')).map((u) => ({ id: u.id, name: u.name, role: u.role }));
  }
  return [];
}

export function LearnersPage() {
  const actor = useActor();
  const toast = useToast();
  const [view, setView] = useState<'mine' | 'pool'>('mine');
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [stage, setStage] = useState('');
  const [course, setCourse] = useState('');
  const [owner, setOwner] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 250);
    return () => clearTimeout(t);
  }, [text]);

  const owners = useOwnerOptions();
  const params = new URLSearchParams({ view });
  if (q) params.set('q', q);
  if (stage) params.set('stage', stage);
  if (course.trim()) params.set('course', course.trim());
  if (owner && view === 'mine' && actor.role !== 'sale') params.set('owner', owner);
  const list = useApi<LearnerList>(`/learners?${params}`);
  const claim = useCommand<{ contactId: string; version: number }>('claimCustomer');
  const rows = list.data?.items ?? [];
  const mayWork = canWriteLearners(actor.role);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Học viên</h1>
          <p className="sub">Khách giữ 3 tháng kể từ khi nhận. Hết hạn mà chưa chốt thì về hồ chung để sale khác nhận.</p>
        </div>
        {mayWork && <Link to="/learners/new" className="btn btn-primary hide-sm">Tạo lead học viên</Link>}
      </div>
      <div className="tabs" role="tablist" aria-label="Danh sách khách">
        <button role="tab" aria-selected={view === 'mine'} onClick={() => setView('mine')}>{actor.role === 'sale' ? 'Khách của tôi' : 'Khách đang giữ'}</button>
        <button role="tab" aria-selected={view === 'pool'} onClick={() => setView('pool')}>Hồ chung</button>
      </div>
      <div className="row-wrap" style={{ marginBottom: 12 }}>
        <div className="field" style={{ flex: '1 1 240px' }}>
          <label htmlFor="learner-q" className="visually-hidden">Tìm khách</label>
          <input id="learner-q" type="search" placeholder="Tìm theo tên hoặc số điện thoại…" value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        <div className="field" style={{ flex: '0 1 190px' }}>
          <label htmlFor="learner-stage" className="visually-hidden">Trạng thái</label>
          <select id="learner-stage" value={stage} onChange={(e) => setStage(e.target.value)}>
            <option value="">Mọi trạng thái</option>
            {LEARNER_STAGES.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
          </select>
        </div>
        <div className="field" style={{ flex: '0 1 190px' }}>
          <label htmlFor="learner-course" className="visually-hidden">Khóa học</label>
          <input id="learner-course" type="search" placeholder="Lọc theo khóa học" value={course} onChange={(e) => setCourse(e.target.value)} />
        </div>
        {(actor.role === 'leader' || actor.role === 'admin') && view === 'mine' && (
          <div className="field" style={{ flex: '0 1 190px' }}>
            <label htmlFor="learner-owner" className="visually-hidden">Sale</label>
            <select id="learner-owner" value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="">Mọi sale</option>
              {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
        )}
      </div>

      {list.data?.truncated && <Alert tone="warn">Danh sách đã giới hạn. Hãy thu hẹp bằng từ khóa hoặc bộ lọc.</Alert>}
      <FormError error={claim.error} />
      <div className="card">
        {list.isLoading && <div className="card-body"><Loading /></div>}
        {list.error && <div className="card-body"><ErrorState error={list.error} onRetry={() => list.refetch()} /></div>}
        {list.data && rows.length === 0 && (
          <Empty title={view === 'pool' ? 'Hồ chung trống' : 'Chưa có khách phù hợp'}>
            {view === 'pool' ? 'Khách hết hạn giữ sẽ về đây.' : 'Thử bỏ bớt bộ lọc hoặc tạo lead học viên mới.'}
          </Empty>
        )}
        {rows.length > 0 && (
          <div className="table-wrap">
            <table className="table responsive">
              <thead>
                <tr>
                  <th>Khách</th><th>Điện thoại</th><th>Sale</th><th>Trạng thái</th><th>Khóa học</th>
                  <th className="hide-sm">Nguồn</th><th className="hide-sm">Hợp đồng</th><th className="hide-sm">Ngày hết giữ</th>
                  {view === 'pool' && mayWork && <th><span className="visually-hidden">Thao tác</span></th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.contactId}>
                    <td><Link to="/learners/$contactId" params={{ contactId: r.contactId }} className="cell-title">{r.name}</Link></td>
                    <td data-label="Điện thoại" className="nowrap">{r.phone ?? <span className="muted">Ẩn</span>}</td>
                    <td data-label="Sale">{r.ownerName ?? <span className="muted">Sale khác</span>}</td>
                    <td data-label="Trạng thái"><Badge tone={r.stage === 'won' ? 'ok' : r.stage === 'lost' || r.stage === 'not_fit' ? 'danger' : 'accent'} dot>{r.stageLabel}</Badge></td>
                    <td data-label="Khóa học">{r.course || <span className="muted">—</span>}</td>
                    <td data-label="Nguồn" className="hide-sm">{r.sourceLabel}</td>
                    <td data-label="Hợp đồng" className="hide-sm">{r.contract ?? <span className="muted">—</span>}</td>
                    <td data-label="Ngày hết giữ" className="hide-sm nowrap">{fmtDate(r.holdExpiresAt)}</td>
                    {view === 'pool' && mayWork && (
                      <td>
                        {r.canClaim && (
                          <button className="btn btn-sm btn-primary" disabled={claim.isPending}
                            onClick={() => claim.mutate({ contactId: r.contactId, version: r.version }, { onSuccess: () => toast(`Đã nhận khách ${r.name}`) })}>Nhận</button>
                        )}
                      </td>
                    )}
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
