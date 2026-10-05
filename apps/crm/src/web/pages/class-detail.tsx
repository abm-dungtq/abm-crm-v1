import { useState } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import {
  attendanceStatusLabel, enrollmentStatusLabel,
  type AddSessionInput, type ConfirmEnrollmentInput, type CreateMakeupSessionInput, type DeferEnrollmentInput, type EndEnrollmentInput,
  type ResumeEnrollmentInput, type SetClassTeachersInput, type TransferEnrollmentInput, type UpdateSessionInput, type UpsertClassInput,
} from '@abm/contracts';
import { useApi, useCommand } from '../api';
import { Badge, Empty, ErrorState, Field, FormError, Loading, useToast, type Tone } from '../components/ui';
import { fmtDate, fmtDateTime, fromLocalInput } from '../format';
import type { Member } from '../types';

interface SessionRow { id: string; startsAt: string; durationMinutes: number; kind: string; status: string; note: string | null; version: number }
interface EnrollmentRow {
  id: string; status: string; version: number; deferredUntil: string | null; statusBeforeDefer: string | null;
  leadId: string; contactName: string; leadCode: string;
}
interface AbsenceRow { attendanceId: string; enrollmentId: string; sessionId: string; status: string; startsAt: string; makeupSessionId: string | null }
interface ClassPayload {
  class: { id: string; name: string; scheduleText: string | null; note: string | null; status: string; version: number; courseId: string; courseName: string; productName: string };
  teachers: Member[];
  teacherCandidates: Member[];
  sessions: SessionRow[];
  enrollments: EnrollmentRow[];
  trials: { id: string; status: string; sessionId: string; leadCode: string; contactName: string }[];
  transferTargets: { id: string; name: string; courseName: string }[];
  absences: AbsenceRow[];
}

const kindLabel = (kind: string) => kind === 'trial' ? 'Học thử' : kind === 'makeup' ? 'Học bù' : 'Buổi học';
const tone = (status: string): Tone => status === 'confirmed' || status === 'studying' ? 'ok' : status === 'deferred' ? 'warn' : status === 'pending' ? 'accent' : 'neutral';

export function ClassDetailPage() {
  const { classId } = useParams({ from: '/classes/$classId' });
  const q = useApi<ClassPayload>(`/classes/${classId}`);
  if (q.isLoading) return <Loading rows={8} />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const data = q.data;
  return (
    <>
      <div className="page-head">
        <div>
          <div className="small"><Link to="/courses">Khóa và lớp</Link> / {data.class.courseName}</div>
          <h1>{data.class.name}</h1>
          <p className="sub">{data.class.productName}{data.class.scheduleText ? ` · ${data.class.scheduleText}` : ''}</p>
        </div>
      </div>
      <div className="cols-main">
        <div className="grid">
          <ClassNote data={data} />
          <Teachers data={data} />
          <Sessions data={data} />
          <Enrollments data={data} />
        </div>
        <Trials trials={data.trials} />
      </div>
    </>
  );
}

function ClassNote({ data }: { data: ClassPayload }) {
  const toast = useToast();
  const klass = data.class;
  const [note, setNote] = useState(klass.note ?? '');
  const [status, setStatus] = useState(klass.status as UpsertClassInput['status']);
  const m = useCommand<UpsertClassInput>('upsertClass');
  const save = () => m.mutate({
    id: klass.id, version: klass.version, courseId: klass.courseId, name: klass.name,
    scheduleText: klass.scheduleText ?? undefined, note: note.trim() || undefined, status,
  }, { onSuccess: () => toast('Đã lưu lớp') });
  return (
    <section className="card">
      <div className="card-head"><h2>Thông tin lớp</h2></div>
      <form className="card-body stack" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <Field label="Link học / ghi chú" htmlFor="class-note"><textarea id="class-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} /></Field>
        <Field label="Trạng thái" htmlFor="class-status">
          <select id="class-status" value={status} onChange={(e) => setStatus(e.target.value as UpsertClassInput['status'])}>
            <option value="open">Đang mở</option>
            <option value="cancelled">Đã hủy</option>
            <option value="finished">Đã kết thúc</option>
          </select>
        </Field>
        <FormError error={m.error} />
        <button className="btn btn-primary" disabled={m.isPending}>Lưu</button>
      </form>
    </section>
  );
}

function Teachers({ data }: { data: ClassPayload }) {
  const toast = useToast();
  const [picked, setPicked] = useState<string[]>(data.teachers.map((t) => t.id));
  const m = useCommand<SetClassTeachersInput>('setClassTeachers');
  const toggle = (id: string) => setPicked((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id].slice(0, 10));
  return (
    <section className="card">
      <div className="card-head"><h2>Giáo viên</h2></div>
      <form className="card-body stack" onSubmit={(e) => { e.preventDefault(); m.mutate({ classId: data.class.id, version: data.class.version, teacherUserIds: picked }, { onSuccess: () => toast('Đã gán giáo viên') }); }}>
        {data.teacherCandidates.length === 0 && <p className="muted">Chưa có tài khoản giáo viên hoặc admin.</p>}
        {data.teacherCandidates.map((u) => (
          <label key={u.id} className="row" style={{ gap: 8 }}>
            <input type="checkbox" checked={picked.includes(u.id)} onChange={() => toggle(u.id)} />
            {u.name} <span className="small muted">{u.role === 'admin' ? 'Admin' : 'Giáo viên'}</span>
          </label>
        ))}
        <FormError error={m.error} />
        <button className="btn btn-primary" disabled={m.isPending}>Lưu giáo viên</button>
      </form>
    </section>
  );
}

function Sessions({ data }: { data: ClassPayload }) {
  const toast = useToast();
  const [form, setForm] = useState({ startsAt: '', durationMinutes: '90', kind: 'regular' as 'regular' | 'trial', note: '' });
  const [notes, setNotes] = useState<Record<string, string>>({});
  const add = useCommand<AddSessionInput>('addSession');
  const update = useCommand<UpdateSessionInput>('updateSession');
  const submit = () => add.mutate({
    classId: data.class.id, startsAt: fromLocalInput(form.startsAt), durationMinutes: Number(form.durationMinutes), kind: form.kind, note: form.note.trim() || undefined,
  }, { onSuccess: () => { toast('Đã thêm buổi'); setForm({ ...form, startsAt: '', note: '' }); } });
  return (
    <section className="card">
      <div className="card-head"><h2>Buổi học</h2></div>
      {data.sessions.length === 0 ? <Empty title="Chưa có buổi" /> : (
        <ul className="list">
          {data.sessions.map((s) => (
            <li key={s.id} className="stack-sm">
              <div className="row">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div>{kindLabel(s.kind)} · {fmtDateTime(s.startsAt)} · {s.durationMinutes} phút</div>
                  <div className="small muted">{s.status === 'cancelled' ? 'Đã hủy' : 'Đã xếp lịch'}{s.note ? ` · ${s.note}` : ''}</div>
                </div>
                {s.status === 'scheduled' && (
                  <>
                    <input aria-label={`Ghi chú buổi ${fmtDateTime(s.startsAt)}`} value={notes[s.id] ?? s.note ?? ''} maxLength={1000}
                      onChange={(e) => setNotes({ ...notes, [s.id]: e.target.value })} />
                    <button className="btn btn-sm" disabled={update.isPending}
                      onClick={() => update.mutate({ sessionId: s.id, version: s.version, note: notes[s.id] ?? s.note ?? '' }, { onSuccess: () => toast('Đã lưu ghi chú') })}>Lưu ghi chú</button>
                    <button className="btn btn-sm" disabled={update.isPending}
                      onClick={() => update.mutate({ sessionId: s.id, version: s.version, status: 'cancelled' }, { onSuccess: () => toast('Đã hủy buổi') })}>Hủy buổi</button>
                  </>
                )}
              </div>
              {data.absences.filter((a) => a.sessionId === s.id).map((a) => (
                <MakeupLine key={a.attendanceId} absence={a} studentName={data.enrollments.find((e) => e.id === a.enrollmentId)?.contactName ?? 'Học viên'} />
              ))}
            </li>
          ))}
        </ul>
      )}
      <form className="card-body stack" style={{ borderTop: '1px solid var(--border)' }} onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div className="grid-2">
          <Field label="Bắt đầu" htmlFor="ss-start" required><input id="ss-start" type="datetime-local" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} required /></Field>
          <Field label="Phút" htmlFor="ss-min" required><input id="ss-min" type="number" min={1} max={1440} value={form.durationMinutes} onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })} required /></Field>
        </div>
        <Field label="Loại" htmlFor="ss-kind">
          <select id="ss-kind" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as 'regular' | 'trial' })}>
            <option value="regular">Buổi học</option>
            <option value="trial">Học thử</option>
          </select>
        </Field>
        <Field label="Ghi chú" htmlFor="ss-note"><input id="ss-note" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} maxLength={1000} /></Field>
        <FormError error={add.error ?? update.error} />
        <button className="btn btn-primary" disabled={add.isPending}>Thêm buổi</button>
      </form>
    </section>
  );
}

function MakeupLine({ absence, studentName }: { absence: AbsenceRow; studentName: string }) {
  const toast = useToast();
  const [startsAt, setStartsAt] = useState('');
  const [durationMinutes, setDurationMinutes] = useState('90');
  const create = useCommand<CreateMakeupSessionInput>('createMakeupSession');
  if (absence.makeupSessionId) {
    return <p className="small muted">{studentName} · {attendanceStatusLabel(absence.status)} · Đã có buổi học bù</p>;
  }
  const submit = () => {
    if (!startsAt) return;
    create.mutate({
      attendanceId: absence.attendanceId, startsAt: fromLocalInput(startsAt), durationMinutes: Number(durationMinutes),
    }, { onSuccess: () => { toast('Đã tạo buổi học bù'); setStartsAt(''); } });
  };
  return (
    <form className="row-wrap" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <span className="small">{studentName} · {attendanceStatusLabel(absence.status)}</span>
      <input type="datetime-local" aria-label={`Giờ học bù của ${studentName}`} value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required />
      <input type="number" aria-label={`Phút học bù của ${studentName}`} min={1} max={1440} value={durationMinutes} onChange={(e) => setDurationMinutes(e.target.value)} required />
      <button className="btn btn-sm" disabled={create.isPending}>Tạo buổi học bù</button>
      <FormError error={create.error} />
    </form>
  );
}

function Enrollments({ data }: { data: ClassPayload }) {
  const toast = useToast();
  const confirm = useCommand<ConfirmEnrollmentInput>('confirmEnrollment');
  const defer = useCommand<DeferEnrollmentInput>('deferEnrollment');
  const resume = useCommand<ResumeEnrollmentInput>('resumeEnrollment');
  const transfer = useCommand<TransferEnrollmentInput>('transferEnrollment');
  const end = useCommand<EndEnrollmentInput>('endEnrollment');
  const [until, setUntil] = useState<Record<string, string>>({});
  const [target, setTarget] = useState<Record<string, string>>({});
  const busy = confirm.isPending || defer.isPending || resume.isPending || transfer.isPending || end.isPending;
  const act = (status: string) => status === 'confirmed' || status === 'studying' || status === 'deferred';
  return (
    <section className="card">
      <div className="card-head"><h2>Ghi danh</h2></div>
      {data.enrollments.length === 0 ? <Empty title="Chưa có ghi danh" /> : (
        <ul className="list">
          {data.enrollments.map((e) => (
            <li key={e.id} className="stack-sm">
              <div className="row">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="truncate">{e.contactName} <span className="mono small muted">{e.leadCode}</span></div>
                  {e.deferredUntil && <div className="small muted">Bảo lưu đến {fmtDate(e.deferredUntil)}</div>}
                </div>
                <Badge tone={tone(e.status)}>{enrollmentStatusLabel(e.status)}</Badge>
              </div>
              <div className="row-wrap">
                {e.status === 'pending' && <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => confirm.mutate({ enrollmentId: e.id, version: e.version }, { onSuccess: () => toast('Đã xác nhận chỗ') })}>Xác nhận</button>}
                {(e.status === 'confirmed' || e.status === 'studying') && (
                  <>
                    <input type="date" aria-label={`Ngày hết bảo lưu của ${e.contactName}`} value={until[e.id] ?? ''} onChange={(ev) => setUntil({ ...until, [e.id]: ev.target.value })} />
                    <button className="btn btn-sm" disabled={busy || !until[e.id]} onClick={() => defer.mutate({ enrollmentId: e.id, version: e.version, until: until[e.id]! }, { onSuccess: () => toast('Đã bảo lưu') })}>Bảo lưu</button>
                  </>
                )}
                {e.status === 'deferred' && <button className="btn btn-sm" disabled={busy} onClick={() => resume.mutate({ enrollmentId: e.id, version: e.version }, { onSuccess: () => toast('Đã học lại') })}>Học lại</button>}
                {act(e.status) && data.transferTargets.length > 0 && (
                  <>
                    <select aria-label={`Lớp đích của ${e.contactName}`} value={target[e.id] ?? ''} onChange={(ev) => setTarget({ ...target, [e.id]: ev.target.value })}>
                      <option value="">Chuyển tới…</option>
                      {data.transferTargets.map((t) => <option key={t.id} value={t.id}>{t.courseName} · {t.name}</option>)}
                    </select>
                    <button className="btn btn-sm" disabled={busy || !target[e.id]} onClick={() => transfer.mutate({ enrollmentId: e.id, version: e.version, toClassId: target[e.id]! }, { onSuccess: () => toast('Đã chuyển lớp') })}>Chuyển lớp</button>
                  </>
                )}
                {act(e.status) && (
                  <>
                    <button className="btn btn-sm" disabled={busy} onClick={() => end.mutate({ enrollmentId: e.id, version: e.version, outcome: 'completed' }, { onSuccess: () => toast('Đã kết thúc') })}>Học xong</button>
                    <button className="btn btn-sm" disabled={busy} onClick={() => end.mutate({ enrollmentId: e.id, version: e.version, outcome: 'withdrawn' }, { onSuccess: () => toast('Đã rút') })}>Rút</button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="card-body"><FormError error={confirm.error ?? defer.error ?? resume.error ?? transfer.error ?? end.error} /></div>
    </section>
  );
}

function Trials({ trials }: { trials: ClassPayload['trials'] }) {
  return (
    <section className="card">
      <div className="card-head"><h2>Học thử</h2></div>
      {trials.length === 0 ? <Empty title="Chưa có học thử" /> : (
        <ul className="list">
          {trials.map((t) => <li key={t.id}>{t.contactName} <span className="mono small muted">{t.leadCode}</span> · {t.status === 'booked' ? 'Đã hẹn' : t.status === 'done' ? 'Đã học' : 'Đã hủy'}</li>)}
        </ul>
      )}
    </section>
  );
}
