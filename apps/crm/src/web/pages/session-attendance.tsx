import { useState } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import { ATTENDANCE_STATUSES, type AttendanceStatus, type MarkAttendanceInput } from '@abm/contracts';
import { useApi, useCommand } from '../api';
import { Empty, ErrorState, FormError, Loading, useToast } from '../components/ui';
import { fmtDateTime } from '../format';

interface RosterRow { enrollmentId?: string; trialBookingId?: string; name: string; status: string; attendanceId: string | null; version: number | null }
interface Payload {
  session: { id: string; classId: string; className: string; courseName: string; startsAt: string; durationMinutes: number; kind: string; status: string; note: string | null };
  roster: RosterRow[];
}

const rowKey = (row: RosterRow) => row.enrollmentId ?? row.trialBookingId ?? row.name;

export function SessionAttendancePage() {
  const { sessionId } = useParams({ from: '/sessions/$sessionId' });
  const q = useApi<Payload>(`/sessions/${sessionId}/attendance`);
  if (q.isLoading) return <Loading rows={8} />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return <Roster sessionId={sessionId} data={q.data} />;
}

function Roster({ sessionId, data }: { sessionId: string; data: Payload }) {
  const toast = useToast();
  const [draft, setDraft] = useState<Record<string, AttendanceStatus>>({});
  const save = useCommand<MarkAttendanceInput>('markAttendance');
  const statusOf = (row: RosterRow) => draft[rowKey(row)] ?? (row.status as AttendanceStatus);
  const changed = data.roster.filter((row) => draft[rowKey(row)] !== undefined);
  const submit = () => save.mutate({
    sessionId,
    entries: changed.map((row) => ({
      ...(row.enrollmentId ? { enrollmentId: row.enrollmentId } : { trialBookingId: row.trialBookingId }),
      status: draft[rowKey(row)] as AttendanceStatus,
      version: row.version,
    })),
  }, { onSuccess: () => toast('Đã lưu điểm danh') });
  const session = data.session;
  return (
    <>
      <div className="page-head">
        <div>
          <div className="small"><Link to="/my-classes">Lớp của tôi</Link> / {session.courseName}</div>
          <h1>{session.className}</h1>
          <p className="sub">{fmtDateTime(session.startsAt)} · {session.durationMinutes} phút{session.note ? ` · Link học: ${session.note}` : ''}</p>
        </div>
      </div>
      <section className="card">
        <div className="card-head"><h2>Điểm danh</h2></div>
        {data.roster.length === 0 ? <Empty title="Không có học viên trong buổi này" /> : (
          <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <ul className="list">
              {data.roster.map((row) => (
                <li key={rowKey(row)} className="stack-sm">
                  <div>{row.name}</div>
                  <div className="row-wrap">
                    {ATTENDANCE_STATUSES.map((item) => (
                      <button key={item.code} type="button" className={statusOf(row) === item.code ? 'btn btn-sm btn-primary' : 'btn btn-sm'}
                        aria-pressed={statusOf(row) === item.code} onClick={() => setDraft({ ...draft, [rowKey(row)]: item.code })}>
                        {item.label}
                      </button>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
            <div className="card-body stack">
              <FormError error={save.error} />
              <button className="btn btn-primary" disabled={save.isPending || changed.length === 0}>Lưu</button>
            </div>
          </form>
        )}
      </section>
    </>
  );
}
