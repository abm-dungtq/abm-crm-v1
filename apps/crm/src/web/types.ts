import type { RoleCode, StageCode } from '@abm/contracts';

// Response shapes of src/worker/queries.ts (kept separate so the browser build never pulls Worker types).

export interface Actor {
  id: string;
  organizationId: string;
  departmentId: string | null;
  teamId: string | null;
  role: RoleCode;
  displayName: string;
}

export interface DemoUser { id: string; name: string; role: RoleCode; teamName: string | null }

export type HealthState = 'ok' | 'warn' | 'breach';
export interface LeadHealth {
  firstContact: { state: HealthState | 'release'; minutes: number } | null;
  stageSla: { state: HealthState; days: number; limit: number } | null;
  nextActionOverdue: boolean;
}

export interface LeadItem {
  id: string;
  code: string;
  stage: StageCode;
  status: 'queue' | 'active' | 'won' | 'lost';
  source: string;
  needSummary: string;
  expectedValue: number | null;
  version: number;
  firstContactAt: string | null;
  assignedAt: string | null;
  stageEnteredAt: string;
  lastActivityAt: string | null;
  createdAt: string;
  closedAt: string | null;
  lostReason: string | null;
  owner: { id: string; name: string | null } | null;
  team: { id: string; name: string | null } | null;
  contactName: string;
  account: { id: string; name: string | null } | null;
  nextAction: { id: string; title: string | null; dueAt: string | null } | null;
  health: LeadHealth;
}

export interface TaskItem {
  id: string;
  title: string;
  dueAt: string;
  status: string;
  outcome: string | null;
  completedAt: string | null;
  version: number;
  assignee: { id: string; name: string };
  isNextAction: boolean;
  lead: { id: string; code: string; stage: string; status: string; version: number; contactName: string; accountName: string | null };
  bucket: 'overdue' | 'today' | 'upcoming' | 'done';
}

export interface Dashboard {
  kpi: {
    activeLeads: number; queueLeads: number; pipelineValue: number; tasksToday: number; overdueTasks: number;
    firstContactBreaches: number; staleLeads: number; wonCount: number; wonValue: number; lostCount: number;
  };
  pipeline: { stage: StageCode; count: number; value: number }[];
  bySale: { id: string; name: string; active: number; overdue: number; stale: number; won: number; lost: number; value: number }[];
  attention: LeadItem[];
  upcoming: TaskItem[];
  lostReasons: { code: string; count: number }[];
}

export interface ApprovalItem {
  id: string;
  kind: 'owner_change' | 'agent_stage_change';
  status: 'pending' | 'approved' | 'rejected' | 'stale';
  version: number;
  reason: string | null;
  createdAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
  requestedByKind: 'human' | 'agent';
  requester: string;
  decider: string | null;
  targetVersion: number;
  isStale: boolean;
  payload: { toStage?: StageCode; agentName?: string; evidence?: string; fromUserName?: string | null; toUserName?: string | null };
  lead: { id: string; code: string; stage: StageCode; contactName: string };
  canDecide: boolean;
}

export interface AuditItem {
  id: string;
  command: string;
  entity: string;
  entityId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: string;
  actorKind: string;
  actorName: string | null;
  lead: { id: string; code: string };
}

export interface ActivityItem { id: string; type: string; summary: string; occurredAt: string; actorKind?: string; actorName: string | null; leadCode?: string; leadId?: string }
export interface LeadTask { id: string; title: string; dueAt: string; status: string; outcome: string | null; completedAt: string | null; version: number; assigneeName: string | null }
export interface Member { id: string; name: string; role: string }

export interface LeadDetail {
  lead: LeadItem & { lostNote: string | null; wonNote: string | null };
  contactPoints: { type: string; value: string }[];
  account: { id: string; name: string; taxCode: string | null; industry: string | null; city: string | null } | null;
  tasks: LeadTask[];
  activities: ActivityItem[];
  approvals: ApprovalItem[];
  audit: AuditItem[] | null;
  teamMembers: Member[];
  permissions: {
    assign: boolean; release: boolean; logActivity: boolean; changeStage: boolean;
    transitions: StageCode[]; requestOwnerChange: boolean; completeTask: boolean;
  };
}

export interface AccountItem {
  id: string; name: string; taxCode: string | null; industry: string | null; city: string | null;
  leadCount: number; openCount: number; wonValue: number; pipelineValue: number; lastActivityAt: string | null; owners: string | null;
}

export interface AccountDetail {
  account: { id: string; name: string; taxCode: string | null; industry: string | null; city: string | null; createdAt: string };
  contacts: { id: string; name: string; jobTitle: string | null; role: string | null; isPrimary: boolean; points: { type: string; value: string }[] }[];
  leads: LeadItem[];
  activities: ActivityItem[];
}

export interface AdminOverview {
  departments: { id: string; name: string }[];
  teams: { id: string; name: string; departmentName: string }[];
  users: { id: string; name: string; email: string; role: RoleCode; status: string; teamName: string | null; departmentName: string | null }[];
  counts: { leads: number; audit: number; outboxPending: number; approvalsPending: number };
}
