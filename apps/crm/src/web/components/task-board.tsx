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
import { fmtDateTime, fmtDue } from '../format';
import type { TaskItem } from '../types';
import { Icon } from './icons';
import { CompleteTaskDialog } from './lead-actions';
import { PriorityBadge } from './task-form-dialog';
import { Avatar, Badge, ErrorState, Loading, StageBadge, useToast } from './ui';

type ColumnId = 'open' | 'in_progress' | 'completed';

const COLUMNS: { id: ColumnId; title: string; subtitle: string }[] = [
  { id: 'open', title: 'Cần làm', subtitle: 'Việc gắn lead & việc nội bộ đang mở' },
  { id: 'in_progress', title: 'Đang làm', subtitle: 'Chỉ dành cho việc nội bộ' },
  { id: 'completed', title: 'Xong', subtitle: '50 việc hoàn thành gần nhất' },
];

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

function TaskCardView({ task, dragging }: { task: TaskItem; dragging?: boolean }) {
  const overdue = task.bucket === 'overdue' && task.status !== 'completed';
  return (
    <article
      className="deal-card"
      data-alert={overdue || undefined}
      style={dragging ? { opacity: 0.85, cursor: 'grabbing' } : { cursor: task.status === 'completed' ? 'default' : 'grab' }}
    >
      <div className="row-wrap" style={{ gap: 6 }}>
        {taskLeadLink(task)}
        <PriorityBadge priority={task.priority} />
        {task.isNextAction && <Badge tone="accent">Next Action</Badge>}
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
          <span style={overdue ? { color: 'var(--danger)', fontWeight: 500 } : undefined}>
            {fmtDue(task.dueAt)}
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

function DraggableTaskCard({ task }: { task: TaskItem }) {
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
      <TaskCardView task={task} />
    </div>
  );
}

function KanbanColumn({
  id,
  title,
  subtitle,
  items,
}: {
  id: ColumnId;
  title: string;
  subtitle: string;
  items: TaskItem[];
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <section
      ref={setNodeRef}
      className="column"
      role="listitem"
      aria-label={title}
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
              Kéo việc vào cột này
            </div>
          )}
          {items.map((t) => (
            <DraggableTaskCard key={t.id} task={t} />
          ))}
        </SortableContext>
      </div>
    </section>
  );
}

export function TaskBoard({ mine = false }: { mine?: boolean }) {
  const suffix = mine ? '&mine=1' : '';
  const openQ = useApi<TaskItem[]>(`/tasks?status=open${suffix}`);
  const inProgressQ = useApi<TaskItem[]>(`/tasks?status=in_progress${suffix}`);
  const completedQ = useApi<TaskItem[]>(`/tasks?status=completed${suffix}`);

  const updateTask = useCommand<UpdateTaskInput>('updateTask');
  const completeTask = useCommand<CompleteTaskInput>('completeTask');
  const toast = useToast();

  const [activeTask, setActiveTask] = useState<TaskItem | null>(null);
  const [completing, setCompleting] = useState<TaskItem | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const openItems = openQ.data ?? [];
  const inProgressItems = inProgressQ.data ?? [];
  const completedItems = (completedQ.data ?? []).slice(0, 50);

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
    if (!targetCol || targetCol === task.status) return;

    if (task.kind === 'crm' || task.lead !== null) {
      if (targetCol === 'in_progress') {
        toast('Việc gắn lead chỉ có Cần làm và Xong', 'danger');
        return;
      }
      if (targetCol === 'completed') {
        setCompleting(task);
        return;
      }
      return;
    }

    if (targetCol === 'open' || targetCol === 'in_progress') {
      updateTask.mutate(
        { taskId: task.id, expectedVersion: task.version, status: targetCol },
        {
          onError: (err) => toast(err.message, 'danger'),
        },
      );
      return;
    }

    if (targetCol === 'completed') {
      completeTask.mutate(
        { taskId: task.id, expectedVersion: task.version },
        {
          onSuccess: () => toast(`Đã hoàn thành: ${task.title}`),
          onError: (err) => toast(err.message, 'danger'),
        },
      );
    }
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
      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActiveTask(null)}>
        <div className="board" role="list" aria-label="Bảng Kanban công việc">
          {COLUMNS.map((col) => (
            <KanbanColumn
              key={col.id}
              id={col.id}
              title={col.title}
              subtitle={col.subtitle}
              items={byCol[col.id]}
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
