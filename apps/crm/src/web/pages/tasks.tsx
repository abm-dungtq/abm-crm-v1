import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import type { UpdateTaskInput } from '@abm/contracts';
import { useActor } from '../actor-context';
import { useApi, useCommand } from '../api';
import { Combobox } from '../components/combobox';
import { Icon } from '../components/icons';
import { CompleteTaskDialog } from '../components/lead-actions';
import { TaskBoard } from '../components/task-board';
import { PriorityBadge, TaskFormDialog, TaskStatusBadge, userOption } from '../components/task-form-dialog';
import { Alert, Badge, Empty, ErrorState, Loading, OverflowMenu, SegmentedControl, StageBadge, useDebounced, useToast } from '../components/ui';
import { quickDueValue } from '../date-time';
import { fmtDateTime, fmtDue, fmtDueRelative, fromLocalInput } from '../format';
import {
  DUE_FILTERS, TASK_LIST_CAP, dueCounts, filterTasks, hasActiveFilter, reachedListCap, taskPageTitle,
  type TaskFilter, type TaskSearch,
} from '../task-filters';
import type { DirectoryUser, TaskItem } from '../types';

function taskLeadCode(t: TaskItem) {
  if (!t.lead) return <Badge tone="neutral">Việc nội bộ</Badge>;
  if (t.lead.pipeline === 'learner') {
    return <Link to="/learners/$contactId" params={{ contactId: t.lead.contactId }}>{t.lead.code}</Link>;
  }
  return <Link to="/leads/$leadId" params={{ leadId: t.lead.id }}>{t.lead.code}</Link>;
}

const GROUPS = [
  { id: 'overdue', label: 'Quá hạn', tone: 'danger' },
  { id: 'today', label: 'Hôm nay', tone: 'warn' },
  { id: 'upcoming', label: 'Sắp tới', tone: 'neutral' },
  { id: 'nodue', label: 'Chưa đặt hạn', tone: 'neutral' },
] as const;

/** Quick reschedules offered in each open row's "⋯" menu: tomorrow 09:00 and three days out at 09:00. */
const RESCHEDULES = [
  { label: 'Dời sang mai 9:00', days: 1 },
  { label: 'Dời +3 ngày (9:00)', days: 3 },
] as const;

export function TasksPage() {
  const actor = useActor();
  const navigate = useNavigate();
  const search = useSearch({ from: '/tasks' });
  const { view, status, mine, assignee, due } = search;
  const isBoard = view === 'board';
  const completed = status === 'completed' && !isBoard;
  const isMine = mine === '1';
  const isSale = actor.role === 'sale';
  const mineSuffix = isMine ? '&mine=1' : '';

  const setSearch = (patch: Partial<TaskSearch>, replace = false) =>
    void navigate({ to: '/tasks', search: (s: TaskSearch) => ({ ...s, ...patch }), replace });

  // The search box filters at once; the URL follows after a short pause so typing does not flood the history.
  // The URL echoing back a value this page pushed must not overwrite what was typed since then; only an outside
  // change (back button, a link) replaces the box.
  const [qInput, setQInput] = useState(search.q ?? '');
  const lastPushedQ = useRef(search.q);
  useEffect(() => {
    if (search.q === lastPushedQ.current) return;
    lastPushedQ.current = search.q;
    setQInput(search.q ?? '');
  }, [search.q]);
  const debouncedQ = useDebounced(qInput.trim(), 250);
  useEffect(() => {
    const next = debouncedQ || undefined;
    if (next === search.q) return;
    lastPushedQ.current = next;
    setSearch({ q: next }, true);
  }, [debouncedQ]);
  // On a phone the filters beyond search fold behind "Lọc".
  const [filtersOpen, setFiltersOpen] = useState(false);

  // The open lists use the same queries as the board, so switching views reads the cache.
  const openQ = useApi<TaskItem[]>(!completed ? `/tasks?status=open${mineSuffix}` : null);
  const inProgressQ = useApi<TaskItem[]>(!completed ? `/tasks?status=in_progress${mineSuffix}` : null);
  const completedQ = useApi<TaskItem[]>(completed && !isBoard ? `/tasks?status=completed${mineSuffix}` : null);
  const directory = useApi<DirectoryUser[]>(isSale ? null : '/directory');
  const reschedule = useCommand<UpdateTaskInput>('updateTask');
  const toast = useToast();

  const [completing, setCompleting] = useState<TaskItem | null>(null);
  const [creating, setCreating] = useState(false);

  const filter: TaskFilter = {
    q: qInput,
    assignee,
    status: !completed && !isBoard && (status === 'open' || status === 'in_progress') ? status : undefined,
    due: completed ? undefined : due,
  };
  const loaded = completed ? (completedQ.data ?? []) : [...(openQ.data ?? []), ...(inProgressQ.data ?? [])];
  const listItems = filterTasks(loaded, filter);
  const counts = dueCounts(filterTasks(loaded, { ...filter, due: undefined }));
  const filtering = hasActiveFilter(filter);
  const listQueries = completed ? [completedQ] : [openQ, inProgressQ];
  const isLoading = listQueries.some((x) => x.isLoading);
  const loadError = listQueries.find((x) => x.error)?.error;
  const ready = !isLoading && !loadError && listQueries.every((x) => x.data);
  const capped = completed ? reachedListCap(completedQ.data) : reachedListCap(openQ.data, inProgressQ.data);

  const clearFilters = () => {
    setQInput('');
    setSearch({ q: undefined, assignee: undefined, due: undefined, status: completed ? 'completed' : undefined });
  };

  const moveDue = (t: TaskItem, days: number) => {
    const dueAt = fromLocalInput(quickDueValue(days, 9));
    reschedule.mutate(
      { taskId: t.id, expectedVersion: t.version, dueAt },
      {
        onSuccess: () => toast(`Đã dời hạn “${t.title}” sang ${fmtDue(dueAt)}`),
        onError: (err) => toast(err.message, 'danger'),
      },
    );
  };

  const people = (directory.data ?? []).map(userOption);
  // Filters hidden behind "Lọc" on a phone; the search box stays visible and is not counted.
  const hasExtraFilters = !isSale || !completed;
  const extraFilterCount = [!isSale && assignee, filter.status, filter.due].filter(Boolean).length;
  const scope = isSale
    ? 'Việc bạn phụ trách, cùng làm hoặc đã tạo.'
    : isMine
      ? 'Việc bạn phụ trách hoặc cùng làm.'
      : 'Việc của lead và việc nội bộ trong phạm vi bạn quản lý.';

  const filterBar = (
    <div className="task-filters" role="search" aria-label="Lọc công việc">
      <div className="search task-search">
        <Icon name="search" />
        <label className="visually-hidden" htmlFor="task-q">Tìm công việc</label>
        <input
          id="task-q"
          type="search"
          value={qInput}
          maxLength={100}
          placeholder="Tìm việc, khách, mã lead…"
          onChange={(e) => setQInput(e.target.value)}
        />
      </div>
      {hasExtraFilters && (
        <>
          <button
            type="button"
            className="btn task-filter-toggle"
            aria-expanded={filtersOpen}
            aria-controls="task-filters-extra"
            onClick={() => setFiltersOpen((v) => !v)}
          >
            <Icon name="filter" />
            Lọc
            {extraFilterCount > 0 && (
              <span className="chip-count num" aria-label={`${extraFilterCount} bộ lọc đang bật`}>{extraFilterCount}</span>
            )}
          </button>
          <div className="task-filters-extra" id="task-filters-extra" data-open={filtersOpen || undefined}>
            {!isSale && (
              <div className="task-filter-person">
                <Combobox
                  ariaLabel="Lọc theo người phụ trách"
                  value={assignee ?? ''}
                  onChange={(v) => setSearch({ assignee: v || undefined })}
                  options={people}
                  loading={directory.isLoading}
                  placeholder="Người phụ trách"
                  clearLabel="Bỏ lọc người phụ trách"
                />
              </div>
            )}
            {!completed && !isBoard && (
              <div className="chips" role="group" aria-label="Lọc theo trạng thái">
                {(['open', 'in_progress'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="chip"
                    aria-pressed={status === s}
                    onClick={() => setSearch({ status: status === s ? undefined : s })}
                  >
                    {s === 'open' ? 'Cần làm' : 'Đang làm'}
                  </button>
                ))}
              </div>
            )}
            {!completed && (
              <div className="chips" role="group" aria-label="Lọc theo hạn">
                {DUE_FILTERS.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    className="chip"
                    data-tone={d.id === 'overdue' && counts.overdue > 0 ? 'danger' : undefined}
                    aria-pressed={due === d.id}
                    onClick={() => setSearch({ due: due === d.id ? undefined : d.id })}
                  >
                    {d.label}
                    <span className="chip-count num">{counts[d.id]}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
      {filtering && (
        <button type="button" className="btn btn-sm btn-ghost" onClick={clearFilters}>
          Xóa bộ lọc
        </button>
      )}
    </div>
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{taskPageTitle(actor.role, isMine)}</h1>
          <p className="sub">{scope}</p>
        </div>
        <div className="row-wrap" style={{ gap: 10 }}>
          {!isSale && (
            <button
              type="button"
              className="chip"
              aria-pressed={isMine}
              onClick={() => setSearch({ mine: isMine ? undefined : '1' })}
            >
              Chỉ việc của tôi
            </button>
          )}
          <SegmentedControl
            ariaLabel="Chế độ hiển thị công việc"
            value={isBoard ? 'board' : 'list'}
            onChange={(nextView) =>
              setSearch(nextView === 'board' ? { view: 'board', status: undefined } : { view: 'list' })}
            options={[
              { value: 'list', label: 'Danh sách' },
              { value: 'board', label: 'Kanban' },
            ]}
          />
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            <Icon name="plus" />
            Tạo việc
          </button>
        </div>
      </div>

      {!isBoard && (
        <div className="tabs" role="tablist">
          <Link role="tab" aria-selected={!completed} to="/tasks" search={(s: TaskSearch) => ({ ...s, status: undefined })}>
            Đang mở
          </Link>
          <Link role="tab" aria-selected={completed} to="/tasks" search={(s: TaskSearch) => ({ ...s, status: 'completed' as const, due: undefined })}>
            Đã xong
          </Link>
        </div>
      )}

      {filterBar}

      {isBoard ? (
        <TaskBoard mine={isMine} filter={{ q: filter.q, assignee: filter.assignee, due: filter.due }} />
      ) : (
        <>
          {isLoading && <Loading />}
          {loadError && (
            <ErrorState error={loadError} onRetry={() => listQueries.forEach((x) => void x.refetch())} />
          )}
          {ready && capped && (
            <Alert tone="info">
              Danh sách chỉ tải {TASK_LIST_CAP} việc đầu tiên nên bộ lọc có thể bỏ sót việc.
              {!isSale && !isMine ? ' Bật “Chỉ việc của tôi” để xem gọn hơn.' : ''}
            </Alert>
          )}
          {ready && listItems.length === 0 && (
            <div className="card">
              {filtering ? (
                <Empty title="Không có việc khớp bộ lọc" icon="search">
                  <button type="button" className="btn btn-sm" style={{ marginTop: 8 }} onClick={clearFilters}>
                    Xóa bộ lọc
                  </button>
                </Empty>
              ) : (
                <Empty title={completed ? 'Chưa có việc hoàn thành' : 'Không còn việc mở'} icon="check" />
              )}
            </div>
          )}
          {ready && !completed && listItems.length > 0 && (
            <div className="grid">
              {GROUPS.map((g) => {
                const items = listItems.filter((t) => t.bucket === g.id);
                if (!items.length) return null;
                return (
                  <section className="card" key={g.id} aria-labelledby={`g-${g.id}`}>
                    <div className="card-head">
                      <h2 id={`g-${g.id}`}>{g.label}</h2>
                      <Badge tone={g.tone}>{items.length}</Badge>
                    </div>
                    <ul className="list">
                      {items.map((t) => (
                        <li key={t.id} className="row task-row">
                          <div className="task-row-main">
                            <div className="row-wrap">
                              <Link to="/tasks/$taskId" params={{ taskId: t.id }} className="task-row-title" title={t.title}>
                                {t.title}
                              </Link>
                              <PriorityBadge priority={t.priority} />
                              {t.status === 'in_progress' && <TaskStatusBadge status="in_progress" />}
                              {t.isNextAction && <Badge tone="neutral">Việc tiếp theo</Badge>}
                            </div>
                            <div className="small muted" style={{ marginTop: 2 }}>
                              {t.lead ? (
                                <>
                                  {taskLeadCode(t)} · {t.lead.contactName}
                                  {t.lead.accountName ? ` · ${t.lead.accountName}` : ''}
                                </>
                              ) : (
                                <Badge tone="neutral">Việc nội bộ</Badge>
                              )}
                              {!isSale && ` · ${t.assignee.name}`}
                            </div>
                          </div>
                          <div className="task-row-side">
                            <span
                              className="small nowrap"
                              style={g.id === 'overdue' ? { color: 'var(--danger)', fontWeight: 500 } : undefined}
                              title={t.dueAt ? `Hạn ${fmtDateTime(t.dueAt, true)}` : undefined}
                            >
                              {t.dueAt ? fmtDueRelative(t.dueAt) : 'Chưa đặt hạn'}
                            </span>
                            <div className="row">
                              {t.lead && (
                                <span className="hide-sm">
                                  <StageBadge stage={t.lead.stage} pipeline={t.lead.pipeline} />
                                </span>
                              )}
                              <button type="button" className="btn btn-sm" onClick={() => setCompleting(t)}>
                                Hoàn thành
                              </button>
                              <OverflowMenu
                                label={`Thao tác khác cho “${t.title}”`}
                                items={[
                                  ...RESCHEDULES.map((r) => ({
                                    label: r.label,
                                    icon: 'clock' as const,
                                    disabled: reschedule.isPending,
                                    onSelect: () => moveDue(t, r.days),
                                  })),
                                  {
                                    label: 'Mở việc',
                                    icon: 'arrow' as const,
                                    onSelect: () => void navigate({ to: '/tasks/$taskId', params: { taskId: t.id } }),
                                  },
                                ]}
                              />
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}
          {ready && completed && listItems.length > 0 && (
            <div className="card">
              <ul className="list">
                {listItems.map((t) => (
                  <li key={t.id}>
                    <div className="row-wrap">
                      <Link to="/tasks/$taskId" params={{ taskId: t.id }} className="task-row-title" title={t.title}>
                        {t.title}
                      </Link>
                      <PriorityBadge priority={t.priority} />
                    </div>
                    <div className="small muted" style={{ marginTop: 2 }}>
                      {t.lead ? taskLeadCode(t) : <Badge tone="neutral">Việc nội bộ</Badge>} · xong {fmtDateTime(t.completedAt)}
                      {t.outcome ? ` · ${t.outcome}` : ''}
                      {!isSale && ` · ${t.assignee.name}`}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <TaskFormDialog open={creating} onClose={() => setCreating(false)} />

      {completing && (
        <CompleteTaskDialog
          open
          onClose={() => setCompleting(null)}
          task={completing}
          leadCode={completing.lead?.code ?? 'Việc nội bộ'}
          requiresNext={Boolean(completing.lead && completing.isNextAction && completing.lead.status === 'active')}
        />
      )}
    </>
  );
}
