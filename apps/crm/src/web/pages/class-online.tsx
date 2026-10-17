import { Link, useParams } from '@tanstack/react-router';
import { ClassOnlineProgram } from '../components/class-online-program';

export function ClassOnlinePage() {
  const { classId } = useParams({ from: '/classes/$classId/online' });
  return (
    <>
      <div className="page-head">
        <div>
          <div className="small"><Link to="/my-classes">← Lớp của tôi</Link></div>
          <h1>Chương trình học online</h1>
        </div>
      </div>
      <ClassOnlineProgram classId={classId} />
    </>
  );
}
