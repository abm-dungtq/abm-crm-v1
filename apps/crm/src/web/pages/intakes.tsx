import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { ApiFailure, listIntakes } from '../api';
import { Empty, ErrorState, Loading } from '../components/ui';
import { fmtAgo, fmtDateTime } from '../format';
import type { LeadIntake } from '../types';

/** The list refreshes on its own so intakes classified by colleagues drop off. */
const INTAKES_POLL_MS = 30_000;

/** `/intakes`: pending intakes of the organization; each opens its conversation, where it is classified. */
export function IntakesPage() {
  const intakes = useQuery<LeadIntake[], ApiFailure>({
    queryKey: ['inbox', 'intakes', { status: 'pending' }],
    queryFn: () => listIntakes({ status: 'pending' }),
    refetchInterval: INTAKES_POLL_MS,
    refetchIntervalInBackground: false,
  });
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Lead chờ phân loại</h1>
          <p className="sub">Thông tin bot trích từ hội thoại Zalo và Fanpage. Mở hội thoại để tạo lead B2B, lead học viên hoặc bỏ qua.</p>
        </div>
      </div>
      <section className="card">
        {intakes.isLoading && <div className="card-body"><Loading rows={4} /></div>}
        {intakes.error && <div className="card-body"><ErrorState error={intakes.error} onRetry={() => intakes.refetch()} /></div>}
        {intakes.data && !intakes.data.length && <Empty title="Không có lead chờ phân loại" icon="inbox">Lead mới hiện ở đây khi bot trích được thông tin khách.</Empty>}
        {!!intakes.data?.length && (
          <div className="table-wrap">
            <table className="table responsive">
              <thead>
                <tr><th>Khách</th><th>Kênh</th><th>Liên hệ</th><th>Nhu cầu</th><th>Trích lúc</th><th><span className="visually-hidden">Thao tác</span></th></tr>
              </thead>
              <tbody>
                {intakes.data.map((i) => {
                  const name = i.fields.name ?? i.conversationName ?? 'Khách chưa rõ tên';
                  const proposals = Object.keys(i.proposed).length;
                  return (
                    <tr key={i.id}>
                      <td data-label="Khách">
                        <div className="cell-title">{name}</div>
                        {proposals > 0 && <div className="cell-sub">{proposals} giá trị mới chờ xác nhận</div>}
                      </td>
                      <td data-label="Kênh">{i.channel === 'facebook' ? 'Fanpage' : `Zalo · ${i.accountName}`}</td>
                      <td data-label="Liên hệ">{[i.fields.phone, i.fields.email].filter(Boolean).join(' · ') || <span className="muted">Chưa có</span>}</td>
                      <td data-label="Nhu cầu"><span className="intake-need">{i.fields.need ?? i.fields.interest ?? <span className="muted">Chưa rõ</span>}</span></td>
                      <td data-label="Trích lúc" className="nowrap"><span title={fmtDateTime(i.updatedAt, true)}>{fmtAgo(i.updatedAt)}</span></td>
                      <td>
                        <Link to="/inbox/$conversationId" params={{ conversationId: i.conversationId }} className="btn btn-sm"
                          aria-label={`Mở hội thoại với ${name}`}>Mở hội thoại</Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
