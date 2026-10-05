import { Link, useParams } from '@tanstack/react-router';
import { useApi } from '../api';
import { ErrorState, Loading, useToast } from '../components/ui';
import { fmtMoney } from '../format';

interface ChargeGuide {
  chargeId: string;
  code: string;
  contactName: string;
  remaining: number;
  bankName: string | null;
  bankAccountNo: string | null;
  bankAccountHolder: string | null;
  transferContent: string;
}

export function FeeGuidePage() {
  const { chargeId } = useParams({ from: '/fees/guide/$chargeId' });
  const guide = useApi<ChargeGuide>(`/fees/charges/${chargeId}/guide`);
  const toast = useToast();
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast('Đã sao chép');
    } catch {
      toast('Không sao chép được', 'danger');
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Hướng dẫn chuyển khoản</h1>
          <p className="sub">{guide.data ? `${guide.data.contactName} · ${guide.data.code}` : 'Thông tin để học viên chuyển đúng khoản.'}</p>
        </div>
        <Link to="/fees" className="btn">Về học phí</Link>
      </div>
      {guide.isLoading && <Loading rows={3} />}
      {guide.error && <ErrorState error={guide.error} onRetry={() => guide.refetch()} />}
      {guide.data && <GuideBody guide={guide.data} copy={copy} />}
    </>
  );
}

function GuideBody({ guide, copy }: { guide: ChargeGuide; copy: (text: string) => void }) {
  const bankLines = [guide.bankName, guide.bankAccountNo, guide.bankAccountHolder].filter((line): line is string => Boolean(line && line.trim()));
  return (
    <div className="stack">
      <section className="card">
        <div className="card-head"><h2>Tài khoản nhận</h2><span className="spacer" />{bankLines.length > 0 && <button className="btn btn-sm" onClick={() => copy(bankLines.join('\n'))}>Sao chép</button>}</div>
        <div className="card-body">
          {bankLines.length === 0 && <p>Admin chưa nhập tài khoản nhận tiền</p>}
          {bankLines.length > 0 && (
            <div className="stack-sm">
              {guide.bankName && <div>{guide.bankName}</div>}
              {guide.bankAccountNo && <div className="mono">{guide.bankAccountNo}</div>}
              {guide.bankAccountHolder && <div>{guide.bankAccountHolder}</div>}
            </div>
          )}
        </div>
      </section>
      <section className="card">
        <div className="card-head"><h2>Số tiền còn lại</h2><span className="spacer" /><button className="btn btn-sm" onClick={() => copy(String(guide.remaining))}>Sao chép</button></div>
        <div className="card-body"><p className="num">{fmtMoney(guide.remaining, false)}</p></div>
      </section>
      <section className="card">
        <div className="card-head"><h2>Nội dung chuyển khoản</h2><span className="spacer" /><button className="btn btn-sm" onClick={() => copy(guide.transferContent)}>Sao chép</button></div>
        <div className="card-body"><p className="mono">{guide.transferContent}</p></div>
      </section>
    </div>
  );
}
