import type { ReactNode } from 'react';
import { attendanceStatusLabel, sourceLabel, stageLabel } from '@abm/contracts';
import { useActor } from '../actor-context';
import { useApi } from '../api';
import { Alert, Empty, ErrorState, Loading } from '../components/ui';
import { fmtDate, fmtDateTime, fmtMoney } from '../format';

interface CountRow { stage?: string; source?: string; count: number }
interface ClassCount { classId: string; className: string; courseName: string; learners: number }
interface Unmarked { sessionId: string; startsAt: string; kind: string; className: string; courseName: string }
interface Streak { enrollmentId: string; name: string; className: string }
interface Debt { bucket: string; amountVnd: number }
interface Cash { day: string; amountVnd: number }
interface HoursRow { teacherId: string; teacherName: string; hours: number }
interface ContractRow { contractName: string | null; companyName: string | null; count: number }
interface AttendanceRow { status: string; count: number }

interface LearnerReport {
  pipeline?: CountRow[];
  classCounts?: ClassCount[];
  unmarkedToday?: Unmarked[];
  absenceStreaks?: Streak[];
  debtAging?: Debt[];
  cashByDay?: Cash[];
  teachingHours?: { note: string; rows: HoursRow[] };
  myAttendance?: AttendanceRow[];
  myHours?: { note: string; hours: number };
  bySource?: { source: string; count: number }[];
  byContract?: ContractRow[];
}

const kindLabel = (kind: string) => (kind === 'trial' ? 'Học thử' : kind === 'makeup' ? 'Học bù' : 'Buổi học');
const bucketLabel = (bucket: string) => ({ '0-30': '0–30 ngày', '31-60': '31–60 ngày', '61-90': '61–90 ngày', '90+': 'Trên 90 ngày' }[bucket] ?? bucket);
const fmtHours = (hours: number) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(hours);

export function LearnerReportsPage() {
  const actor = useActor();
  const blocked = actor.role === 'head';
  const q = useApi<LearnerReport>(blocked ? null : '/reports/learner');
  const report = q.data;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Báo cáo học viên</h1>
          <p className="sub">Mỗi vai trò chỉ thấy phần việc của mình.</p>
        </div>
      </div>
      {blocked && <Alert tone="info">Vai trò này không xem báo cáo học viên.</Alert>}
      {q.isLoading && <Loading rows={4} />}
      {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {report && (
        <div className="grid">
          {report.pipeline && (
            <Section title="Hành trình học viên">
              <CountTable rows={report.pipeline} label={(row) => stageLabel(row.stage ?? '', 'learner')} empty="Chưa có lead học viên" />
            </Section>
          )}
          {report.bySource && (
            <Section title="Theo nguồn">
              <CountTable rows={report.bySource} label={(row) => sourceLabel(row.source ?? '')} empty="Chưa có lead học viên" />
            </Section>
          )}
          {report.byContract && (
            <Section title="Theo hợp đồng đối tác">
              {report.byContract.length === 0 ? <Empty title="Chưa có lead học viên" /> : (
                <div className="table-wrap">
                  <table className="table responsive">
                    <thead><tr><th>Hợp đồng</th><th>Công ty</th><th className="right">Số lead</th></tr></thead>
                    <tbody>
                      {report.byContract.map((row, i) => (
                        <tr key={`${row.contractName ?? 'none'}-${row.companyName ?? 'none'}-${i}`}>
                          <td>{row.contractName ?? 'Không theo hợp đồng'}</td>
                          <td data-label="Công ty">{row.companyName ?? '—'}</td>
                          <td data-label="Số lead" className="right num">{row.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>
          )}
          {report.classCounts && (
            <Section title="Sĩ số lớp đang mở">
              {report.classCounts.length === 0 ? <Empty title="Chưa có lớp đang mở" /> : (
                <div className="table-wrap">
                  <table className="table responsive">
                    <thead><tr><th>Lớp</th><th>Khóa</th><th className="right">Học viên</th></tr></thead>
                    <tbody>
                      {report.classCounts.map((row) => (
                        <tr key={row.classId}>
                          <td>{row.className}</td>
                          <td data-label="Khóa">{row.courseName}</td>
                          <td data-label="Học viên" className="right num">{row.learners}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>
          )}
          {report.unmarkedToday && (
            <Section title="Buổi hôm nay chưa điểm danh hết">
              {report.unmarkedToday.length === 0 ? <Empty title="Hôm nay không còn buổi nào thiếu điểm danh" /> : (
                <div className="table-wrap">
                  <table className="table responsive">
                    <thead><tr><th>Buổi</th><th>Lớp</th><th>Khóa</th></tr></thead>
                    <tbody>
                      {report.unmarkedToday.map((row) => (
                        <tr key={row.sessionId}>
                          <td>{kindLabel(row.kind)} · {fmtDateTime(row.startsAt)}</td>
                          <td data-label="Lớp">{row.className}</td>
                          <td data-label="Khóa">{row.courseName}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>
          )}
          {report.absenceStreaks && (
            <Section title="Vắng hai buổi liền">
              {report.absenceStreaks.length === 0 ? <Empty title="Không có học viên vắng hai buổi liền" /> : (
                <div className="table-wrap">
                  <table className="table responsive">
                    <thead><tr><th>Học viên</th><th>Lớp</th></tr></thead>
                    <tbody>
                      {report.absenceStreaks.map((row) => (
                        <tr key={row.enrollmentId}>
                          <td>{row.name}</td>
                          <td data-label="Lớp">{row.className}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>
          )}
          {report.myAttendance && (
            <Section title="Điểm danh các lớp của tôi">
              {report.myAttendance.length === 0 ? <Empty title="Chưa có điểm danh" /> : (
                <div className="table-wrap">
                  <table className="table responsive">
                    <thead><tr><th>Trạng thái</th><th className="right">Số lượt</th></tr></thead>
                    <tbody>
                      {report.myAttendance.map((row) => (
                        <tr key={row.status}>
                          <td>{attendanceStatusLabel(row.status)}</td>
                          <td data-label="Số lượt" className="right num">{row.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>
          )}
          {report.myHours && (
            <Section title="Giờ dạy của tôi trong tháng">
              <p className="text-2">{report.myHours.note}</p>
              <p className="num">{fmtHours(report.myHours.hours)} giờ</p>
            </Section>
          )}
          {report.teachingHours && (
            <Section title="Giờ dạy trong tháng">
              <p className="text-2">{report.teachingHours.note}</p>
              {report.teachingHours.rows.length === 0 ? <Empty title="Chưa có giờ dạy trong tháng" /> : (
                <div className="table-wrap">
                  <table className="table responsive">
                    <thead><tr><th>Giáo viên</th><th className="right">Giờ</th></tr></thead>
                    <tbody>
                      {report.teachingHours.rows.map((row) => (
                        <tr key={row.teacherId}>
                          <td>{row.teacherName}</td>
                          <td data-label="Giờ" className="right num">{fmtHours(row.hours)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>
          )}
          {report.debtAging && (
            <Section title="Công nợ theo tuổi">
              <div className="table-wrap">
                <table className="table responsive">
                  <thead><tr><th>Tuổi khoản</th><th className="right">Còn lại</th></tr></thead>
                  <tbody>
                    {report.debtAging.map((row) => (
                      <tr key={row.bucket}>
                        <td>{bucketLabel(row.bucket)}</td>
                        <td data-label="Còn lại" className="right num">{fmtMoney(row.amountVnd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          )}
          {report.cashByDay && (
            <Section title="Tiền thu theo ngày">
              {report.cashByDay.length === 0 ? <Empty title="30 ngày qua chưa có khoản thu" /> : (
                <div className="table-wrap">
                  <table className="table responsive">
                    <thead><tr><th>Ngày</th><th className="right">Tiền</th></tr></thead>
                    <tbody>
                      {report.cashByDay.map((row) => (
                        <tr key={row.day}>
                          <td>{fmtDate(`${row.day}T00:00:00+07:00`)}</td>
                          <td data-label="Tiền" className="right num">{fmtMoney(row.amountVnd)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>
          )}
        </div>
      )}
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card">
      <div className="card-head"><h2>{title}</h2></div>
      <div className="card-body stack">{children}</div>
    </section>
  );
}

function CountTable({ rows, label, empty }: { rows: CountRow[]; label: (row: CountRow) => string; empty: string }) {
  if (rows.length === 0) return <Empty title={empty} />;
  return (
    <div className="table-wrap">
      <table className="table responsive">
        <thead><tr><th>Nhóm</th><th className="right">Số lead</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.stage ?? row.source}>
              <td>{label(row)}</td>
              <td data-label="Số lead" className="right num">{row.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
