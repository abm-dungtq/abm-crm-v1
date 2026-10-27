import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { CompleteTaskInput, UpdateTaskInput } from '@abm/contracts';
import { useApi, useCommand } from '../api';
import { fmtDateTime, fmtDueRelative } from '../format';
import { TASK_LIST_CAP, filterTasks, reachedListCap, type TaskFilter } from '../task-filters';
import type { TaskItem } from '../types';
import { Icon } from './icons';
import { CompleteTaskDialog } from './lead-actions';
import { PriorityBadge } from './task-form-dialog';
import { Alert, Avatar, Badge, ErrorState, Loading, OverflowMenu, StageBadge, useToast, type OverflowMenuItem } from './ui';

type ColumnId = 'open' | 'in_progress' | 'completed';

const COMPLETED_SHOWN = 50;

const COLUMNS: { id: ColumnId; title: string; subtitle: string }[] = [
  { id: 'open', title: 'Cần làm', subtitle: 'Việc gắn lead & việc nội bộ đang mở' },
  { id: 'in_progress', title: 'Đang làm', subtitle: 'Việc gắn lead không chuyển sang Đang làm' },
  { id: 'completed', title: 'Xong', subtitle: `Hoàn thành gần đây, tối đa ${COMPLETED_SHOWN} việc` },
];

const isLeadTask = (t: TaskItem) => t.kind === 'crm' || t.lead !== null;

function taskLeadLink(t: TaskItem) {
  if (!t.lead) return <Badge tone="neutral">Việc nội bộ</Badge>;
  if (t.lead.pipeline === 'learner') {
    return (
      <Link to="/learners/$contactId" params={{ contactId: t.lead.contactId }} className="mono small">
        {t.lead.code}
      </Link>
    );
  }
  return (
    <Link to="/leads/$leadId" params={{ leadId: t.lead.id }} className="mono small">
      {t.lead.code}
    </Link>
  );
}

function TaskCardView({ task, dragging, onMove }: { task: TaskItem; dragging?: boolean; onMove?: (to: ColumnId) => void }) {
  const overdue = task.bucket === 'overdue' && task.status !== 'completed';
  const moves: OverflowMenuItem[] = onMove && task.status !== 'completed'
    ? COLUMNS.filter((c) => c.id !== task.status && !(c.id === 'in_progress' && isLeadTask(task))).map((c) => ({
      label: `Chuyển sang ${c.title}`,
      onSelect: () => onMove(c.id),
    }))
    : [];
  return (
    <article
      className="deal-card"
      data-alert={overdue || undefined}
      style={dragging ? { opacity: 0.85, cursor: 'grabbing' } : { cursor: task.status === 'completed' ? 'default' : 'grab' }}
    >
      <div className="row" style={{ gap: 6, alignItems: 'flex-start' }}>
        <div className="row-wrap" style={{ gap: 6, flex: 1, minWidth: 0 }}>
          {taskLeadLink(task)}
          <PriorityBadge priority={task.priority} />
          {task.isNextAction && <Badge tone="neutral">Việc tiếp theo</Badge>}
        </div>
        {moves.length > 0 && (
          // The card itself is a drag handle; keys and presses on the menu must not start a drag.
          <span className="deal-card-menu" onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            <OverflowMenu label={`Chuyển việc “${task.title}”`} items={moves} />
          </span>
        )}
      </div>
      <Link to="/tasks/$taskId" params={{ taskId: task.id }} className="title">
        {task.title}
      </Link>
      {task.lead && (
        <span className="small muted truncate">
          {task.lead.contactName}{task.lead.accountName ? ` · ${task.lead.accountName}` : ''}
        </span>
      )}
      <div className="small text-2" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <Icon name="clock" style={{ width: 14, height: 14, flex: 'none' }} />
        {task.status === 'completed' ? (
          <span className="muted">Xong {fmtDateTime(task.completedAt)}</span>
        ) : task.dueAt ? (
          <span
            style={overdue ? { color: 'var(--danger)', fontWeight: 500 } : undefined}
            title={`Hạn ${fmtDateTime(task.dueAt, true)}`}
          >
            {fmtDueRelative(task.dueAt)}
          </span>
        ) : (
          <span className="muted">Chưa đặt hạn</span>
        )}
      </div>
      <div className="foot">
        <Avatar name={task.assignee.name} />
        <span className="truncate">{task.assignee.name}</span>
        <span className="spacer" />
        {task.lead && <StageBadge stage={task.lead.stage} pipeline={task.lead.pipeline} />}
      </div>
    </article>
  );
}

function DraggableTaskCard({ task, onMove }: { task: TaskItem; onMove: (to: ColumnId) => void }) {
  const disabled = task.status === 'completed';
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { task },
    disabled,
  });
  const style = {
    transform: transform ? `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)` : undefined,
    transition,
    opacity: isDragging ? 0.35 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <TaskCardView task={task} onMove={onMove} />
    </div>
  );
}

function KanbanColumn({
  id,
  title,
  subtitle,
  items,
  onMove,
}: {
  id: ColumnId;
  title: string;
  subtitle: string;
  items: TaskItem[];
  onMove: (task: TaskItem, to: ColumnId) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <section
      ref={setNodeRef}
      className="column"
      role="listitem"
      aria-label={title}
      data-col={id}
      style={isOver ? { borderColor: 'var(--accent)', boxShadow: '0 0 0 2px var(--accent-weak)' } : undefined}
    >
      <div className="column-head">
        <div className="title">
          {title}
          <span className="muted num" style={{ fontWeight: 400 }}>{items.length}</span>
        </div>
        <div className="meta">{subtitle}</div>
      </div>
      <div className="column-body" style={{ minHeight: 160 }}>
        <SortableContext items={items.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {items.length === 0 && (
            <div className="small muted" style={{ padding: '16px 4px', textAlign: 'center' }}>
              Không có việc ở cột này
            </div>
          )}
          {items.map((t) => (
            <DraggableTaskCard key={t.id} task={t} onMove={(to) => onMove(t, to)} />
          ))}
        </SortableContext>
      </div>
    </section>
  );
}

export function TaskBoard({ mine = false, filter = {} }: { mine?: boolean; filter?: Omit<TaskFilter, 'status'> }) {
  const suffix = mine ? '&mine=1' : '';
  const openQ = useApi<TaskItem[]>(`/tasks?status=open${suffix}`);
  const inProgressQ = useApi<TaskItem[]>(`/tasks?status=in_progress${suffix}`);
  const completedQ = useApi<TaskItem[]>(`/tasks?status=completed${suffix}`);

  const updateTask = useCommand<UpdateTaskInput>('updateTask');
  const completeTask = useCommand<CompleteTaskInput>('completeTask');
  const toast = useToast();

  const [activeTask, setActiveTask] = useState<TaskItem | null>(null);
  const [completing, setCompleting] = useState<TaskItem | null>(null);
  // On a phone one column shows at a time; this picks it.
  const [shownCol, setShownCol] = useState<ColumnId>('open');

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const openItems = filterTasks(openQ.data ?? [], filter);
  const inProgressItems = filterTasks(inProgressQ.data ?? [], filter);
  // A due filter (overdue, today…) describes work still to do; finished tasks are shown regardless of their old deadline.
  const completedItems = filterTasks((completedQ.data ?? []).slice(0, COMPLETED_SHOWN), { ...filter, due: undefined });

  const byCol: Record<ColumnId, TaskItem[]> = {
    open: openItems,
    in_progress: inProgressItems,
    completed: completedItems,
  };

  const resolveColumn = (id: string): ColumnId | null => {
    if (id === 'open' || id === 'in_progress' || id === 'completed') return id;
    if (openItems.some((t) => t.id === id)) return 'open';
    if (inProgressItems.some((t) => t.id === id)) return 'in_progress';
    if (completedItems.some((t) => t.id === id)) return 'completed';
    return null;
  };

  /** Moves a task to a column, by drag or by the card's "Chuyển sang…" menu. */
  const moveTask = (task: TaskItem, targetCol: ColumnId) => {
    if (targetCol === task.status) return;
    if (isLeadTask(task)) {
      if (targetCol === 'in_progress') {
        toast('Việc gắn lead chỉ có Cần làm và Xong', 'danger');
        return;
      }
      if (targetCol === 'completed') setCompleting(task);
      return;
    }
    if (targetCol === 'open' || targetCol === 'in_progress') {
      updateTask.mutate(
        { taskId: task.id, expectedVersion: task.version, status: targetCol },
        {
          onSuccess: () => toast(`Đã chuyển “${task.title}” sang ${targetCol === 'open' ? 'Cần làm' : 'Đang làm'}`),
          onError: (err) => toast(err.message, 'danger'),
        },
      );
      return;
    }
    completeTask.mutate(
      { taskId: task.id, expectedVersion: task.version },
      {
        onSuccess: () => toast(`Đã hoàn thành: ${task.title}`),
        onError: (err) => toast(err.message, 'danger'),
      },
    );
  };

  const onDragStart = (event: DragStartEvent) => {
    const found = [...openItems, ...inProgressItems].find((t) => t.id === String(event.active.id)) ?? null;
    setActiveTask(found);
  };

  const onDragEnd = (event: DragEndEvent) => {
    setActiveTask(null);
    const { active, over } = event;
    if (!over) return;
    const task = [...openItems, ...inProgressItems].find((t) => t.id === String(active.id));
    if (!task) return;
    const targetCol = resolveColumn(String(over.id));
    if (targetCol) moveTask(task, targetCol);
  };

  if (openQ.isLoading || inProgressQ.isLoading || completedQ.isLoading) {
    return <Loading rows={5} />;
  }
  const error = openQ.error || inProgressQ.error || completedQ.error;
  if (error) {
    return (
      <ErrorState
        error={error}
        onRetry={() => {
          void openQ.refetch();
          void inProgressQ.refetch();
          void completedQ.refetch();
        }}
      />
    );
  }

  return (
    <>
      {reachedListCap(openQ.data, inProgressQ.data) && (
        <Alert tone="info">
          Bảng chỉ tải {TASK_LIST_CAP} việc đầu tiên của mỗi cột nên có thể thiếu việc. Bật “Chỉ việc của tôi” để xem gọn hơn.
        </Alert>
      )}
      <div className="board-switcher" role="group" aria-label="Chọn cột Kanban">
        {COLUMNS.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-pressed={shownCol === c.id}
            className="board-switcher-btn"
            onClick={() => setShownCol(c.id)}
          >
            {c.title}
            <span className="num">{byCol[c.id].length}</span>
          </button>
        ))}
      </div>
      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActiveTask(null)}>
        <div className="board task-board" role="list" aria-label="Bảng Kanban công việc" data-shown={shownCol}>
          {COLUMNS.map((col) => (
            <KanbanColumn
              key={col.id}
              id={col.id}
              title={col.title}
              subtitle={col.subtitle}
              items={byCol[col.id]}
              onMove={moveTask}
            />
          ))}
        </div>
        <DragOverlay>
          {activeTask ? <TaskCardView task={activeTask} dragging /> : null}
        </DragOverlay>
      </DndContext>

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
