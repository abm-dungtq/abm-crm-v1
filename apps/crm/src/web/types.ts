import type { ChannelAccountStatus, ChannelKind, ConversationMode, RoleCode, SenderKind, StageCode } from '@abm/contracts';

// Response shapes of src/worker/queries.ts (kept separate so the browser build never pulls Worker types).

export interface Actor {
  id: string;
  organizationId: string;
  departmentId: string | null;
  teamId: string | null;
  role: RoleCode;
  displayName: string;
}

export interface Me extends Actor { mustChangePassword: boolean }

export interface AdminUser {
  id: string; name: string; email: string; role: RoleCode; status: 'active' | 'disabled'; version: number;
  teamName: string | null; departmentName: string | null;
  /** SQLite booleans arrive as 0/1. */
  mustChangePassword: number; hasPassword: number; tempPasswordExpiresAt: string | null;
  agentTokens: number;
}
export interface IssuedPassword { name: string; email: string; password: string; expiresAt: string }

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
  pipeline?: 'b2b' | 'learner';
  stage: StageCode | string;
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
  productId?: string | null;
  productName?: string | null;
  courseId?: string | null;
  courseName?: string | null;
  owner: { id: string; name: string | null } | null;
  team: { id: string; name: string | null } | null;
  contactId?: string;
  contactName: string;
  account: { id: string; name: string | null } | null;
  nextAction: { id: string; title: string | null; dueAt: string | null } | null;
  health: LeadHealth;
}

/** Opt-in /leads?view=page and /accounts?view=page; legacy endpoints return arrays. */
export interface ListPage<T> { items: T[]; truncated: boolean }
export interface LeadPage extends ListPage<LeadItem> { counts: Record<string, number> | null }

export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface TaskItem {
  id: string;
  kind: 'crm' | 'internal';
  title: string;
  description: string | null;
  priority: TaskPriority;
  parentTaskId: string | null;
  dueAt: string | null;
  status: string;
  outcome: string | null;
  completedAt: string | null;
  version: number;
  assignee: { id: string; name: string };
  isNextAction: boolean;
  lead: {
    id: string; code: string; stage: string; status: string; version: number;
    pipeline: string; contactId: string; contactName: string; accountName: string | null;
  } | null;
  bucket: 'overdue' | 'today' | 'upcoming' | 'nodue' | 'done';
}

export interface TaskDetail extends TaskItem {
  createdBy: { id: string; name: string } | null;
  members: { id: string; name: string }[];
  subtasks: { id: string; title: string; status: string }[];
  parent: { id: string; title: string } | null;
  /** Set on a task made from chat ("Tạo từ chat"). */
  source: TaskSourceDetail | null;
}

/** Where a task made from chat came from; the title is null and `canOpen` false when the reader is not in that chat. */
export interface TaskSourceDetail extends ChatTaskSource {
  conversationTitle: string | null;
  canOpen: boolean;
}

export interface DirectoryUser {
  id: string;
  name: string;
  role: RoleCode;
  teamName: string | null;
}

export interface ChatAttachment {
  id: string;
  fileName: string;
  contentType: string;
  size: number;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  authorKind: 'user' | 'agent' | 'system';
  authorUserId: string | null;
  authorAgentId: string | null;
  authorName: string | null;
  /** The quoted message ("Trả lời"); `replyTo` is its preview, filled by read endpoints only. */
  replyToMessageId: string | null;
  replyTo: ChatQuotePreview | null;
  /** Root of the thread this message replies in; null for a main-flow message. */
  threadRootId: string | null;
  /** A thread reply also shown in the main flow ("Cũng gửi vào nhóm"). */
  alsoInMain: boolean;
  body: string;
  mentions: string[];
  meta: Record<string, unknown> | null;
  createdAt: string;
  deleted: boolean;
  duplicate?: boolean;
  attachments?: ChatAttachment[];
  /** Set on a top-level message that has a thread. */
  thread: ChatThreadSummary | null;
}

/** The quoted message shown above a quote reply. `snippet` is empty when the quoted message was recalled. */
export interface ChatQuotePreview {
  id: string;
  authorName: string | null;
  snippet: string;
  deleted: boolean;
  threadRootId: string | null;
}

/** The thread card under a root message, with the reader's follow state. */
export interface ChatThreadSummary {
  rootId: string;
  conversationId: string;
  replyCount: number;
  lastReplyAt: string | null;
  lastActivityAt: string;
  isTopic: boolean;
  closed: boolean;
  closedAt: string | null;
  /** Up to 3 people who replied, newest reply first. */
  repliers: { userId: string; name: string }[];
  /** Up to 3 latest replies, newest first. */
  latest: { id: string; authorName: string | null; snippet: string; createdAt: string }[];
  following: boolean;
  muted: boolean;
  /** Replies by others after the reader's thread read marker; 0 when the reader does not follow. */
  unread: number;
}

export interface ChatThreadDetail {
  root: ChatMessage;
  thread: ChatThreadSummary | null;
  /** Oldest first. */
  replies: ChatMessage[];
  hasMore: boolean;
}

/** One row of the "Chuỗi" tab. */
export type ChatFollowedThread = ChatThreadSummary & {
  conversationTitle: string;
  conversationKind: 'group' | 'direct';
  rootAuthorName: string | null;
  rootSnippet: string;
  rootDeleted: boolean;
};

/** The main-flow window around one message (newest first), used to jump to an older message. */
export interface ChatMessageContext {
  conversationId: string;
  messageId: string;
  threadRootId: string | null;
  messages: ChatMessage[];
}

export type ChatThreadSubscriptionState = 'following' | 'muted' | 'none';

export interface ChatConversationSummary {
  id: string;
  kind: 'group' | 'direct';
  title: string;
  agentReadable: boolean;
  lastMessage: string;
  lastMessageAt: string | null;
  updatedAt: string;
  unread: number;
  /** Unread thread-only replies in this conversation's followed, unmuted threads. */
  threadUnread: number;
  mode: ChatConversationMode;
  /** Set on a department group. */
  departmentId: string | null;
  /** Set on a subgroup: its department group, and that group's title. */
  parentConversationId: string | null;
  parentTitle: string | null;
  /** A system group (Inbox, department group): members follow the org chart, nobody edits them by hand. */
  system: boolean;
}

/** "chat": quote and thread replies; "topic": every new top-level message starts a topic. */
export type ChatConversationMode = 'chat' | 'topic';

export interface ChatMember {
  id: string;
  name: string;
  role: 'owner' | 'member';
}

export interface ChatAgentItem {
  id: string;
  name: string;
  canDm: boolean;
  canGroup: boolean;
  enabled?: boolean;
}

export interface AdminChatAgent {
  id: string;
  displayName: string;
  dmAgentKey: string | null;
  groupAgentKey: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ChatTaskSuggestion {
  title: string;
  assigneeName: string;
  assigneeUserId: string | null;
  dueDate: string | null;
}

/** One message (`scope 'message'`) or a whole thread (`scope 'thread'`, `messageId` is then the root). */
export interface ChatTaskSource {
  conversationId: string;
  messageId: string;
  scope: 'message' | 'thread';
}

/** A task Trợ lý proposed, stored in `meta.taskDrafts` of its message until the requester creates it. */
export interface ChatTaskDraft {
  title: string;
  description: string | null;
  assigneeName: string | null;
  assigneeUserId: string | null;
  memberNames: string[];
  memberUserIds: string[];
  /** Names that matched no conversation member, or more than one. */
  unresolvedNames: string[];
  /** `YYYY-MM-DD`. */
  dueDate: string | null;
  source: ChatTaskSource | null;
  createdTaskId: string | null;
}

/** The draft the server builds without Trợ lý. */
export interface ChatManualTaskDraft {
  title: string;
  description: string;
  assigneeUserId: null;
  memberUserIds: string[];
  dueDate: null;
  source: ChatTaskSource;
}

/** `POST /chat/conversations/:id/task-drafts`: Trợ lý is drafting (the card arrives by socket), or the manual draft. */
export type ChatTaskDraftResponse = { mode: 'agent' } | { mode: 'manual'; draft: ChatManualTaskDraft };

/** `meta.taskCard` of the system message posted where a task made from chat came from. */
export interface ChatTaskCard {
  taskId: string;
  title: string;
  assigneeName: string | null;
  dueAt: string | null;
  createdByName: string | null;
}

export interface ChatConversationDetail {
  id: string;
  kind: 'group' | 'direct' | 'task';
  title: string;
  taskId: string | null;
  /** A system group (Inbox or department group): members follow the roster and cannot be edited by hand. */
  system: boolean;
  agentReadable: boolean;
  /** "Chủ đề" mode turns every new message into a topic. */
  mode: ChatConversationMode;
  /** Set on a department group. */
  departmentId: string | null;
  /** Set on a subgroup: its department group, and that group's title. */
  parentConversationId: string | null;
  parentTitle: string | null;
  /** Subgroups of a department group that the reader belongs to, sorted by title; empty otherwise. */
  subgroups: { id: string; title: string }[];
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
  members: ChatMember[];
  agents?: ChatAgentItem[];
}

export interface DashboardPipelineBreakdown {
  activeLeads: number;
  queueLeads: number;
  wonCount: number;
  lostCount: number;
  pipelineValue: number;
}

export interface Dashboard {
  truncated: {
    leads: { shown: number; total: number } | null;
    tasks: { shown: number; total: number } | null;
    attention: { shown: number; total: number } | null;
    upcoming: { shown: number; total: number } | null;
  };
  kpi: {
    activeLeads: number; queueLeads: number; pipelineValue: number; tasksToday: number; overdueTasks: number;
    firstContactBreaches: number; staleLeads: number; wonCount: number; wonValue: number; lostCount: number;
    byPipeline?: { b2b: DashboardPipelineBreakdown; learner: DashboardPipelineBreakdown };
  };
  byPipeline?: { b2b: DashboardPipelineBreakdown; learner: DashboardPipelineBreakdown };
  pipeline: { stage: StageCode; count: number; value: number }[];
  bySale: { id: string; name: string; active: number; overdue: number; stale: number; won: number; lost: number; value: number }[];
  attention: LeadItem[];
  upcoming: (TaskItem & { lead: NonNullable<TaskItem['lead']> })[];
  lostReasons: { code: string; count: number }[];
}

export interface ApprovalItem {
  id: string;
  kind: 'owner_change' | 'agent_stage_change' | 'agent_assign';
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
  users: AdminUser[];
  counts: { leads: number; audit: number; outboxPending: number; approvalsPending: number; agentKillSwitch: number };
}

export type OverviewPeriod = 'month' | 'quarter' | 'year';
export interface OverviewCard {
  id: string; code: string; title: string; ownerName: string | null; value: number | null;
  risk: boolean; nextActionDueAt: string | null; closedAt: string | null;
}
export interface OverviewColumn { key: 'queue' | StageCode; count: number; value: number; atRisk: number; leads: OverviewCard[] }
export interface Overview {
  period: { key: OverviewPeriod; start: string };
  departments: { id: string; name: string }[];
  departmentId: string | null;
  truncated: { shown: number; total: number } | null;
  kpi: {
    openLeads: number; pipelineValue: number; queueLeads: number;
    wonCount: number; wonValue: number; lostCount: number; lostValue: number; winRate: number | null;
    overdueTasks: number; slaBreaches: number; pendingApprovals: number; agentActionsToday: number;
  };
  columns: OverviewColumn[];
  approvals: {
    byKind: { kind: string; count: number }[];
    oldest: { id: string; kind: string; toStage: string | null; leadId: string; leadCode: string; requester: string | null; requestedByKind: 'human' | 'agent'; createdAt: string }[];
  };
  bot: { agentWritesOpen: boolean; activeTokens: number; agentWrites7d: number; outbox: { status: string; count: number }[] };
  matrix: { stages: StageCode[]; departments: OverviewMatrixRow[]; teams: OverviewMatrixRow[] };
  workload: { id: string; name: string; teamName: string | null; open: number; overdue: number; stale: number; won: number; lost: number }[];
  sources: { code: string; total: number; won: number; lost: number; winRate: number | null }[];
  recentAudit: { id: string; command: string; entity: string; leadId: string; leadCode: string; actorName: string | null; actorKind: string; createdAt: string }[];
}
export interface OverviewMatrixRow {
  id: string; name: string; departmentId: string;
  cells: { stage: StageCode; count: number; value: number; atRisk: number }[];
}

// ---------- learner flow (src/worker/learner-queries.ts) ----------

export interface LearnerRow {
  contactId: string; name: string; phone: string | null; ownerName: string | null; stage: string; stageLabel: string;
  course: string; productId?: string | null; productName?: string | null; courseId?: string | null; courseName?: string | null;
  source: string; sourceLabel: string; contract: string | null; holdExpiresAt: string | null;
  version: number; held: boolean; canClaim: boolean;
}
export interface LearnerList { items: LearnerRow[]; truncated: boolean }

export interface LearnerContact {
  id: string; name: string; version: number; held: boolean; phone: string | null; email: string | null;
  ownerName: string | null; holdExpiresAt: string | null;
}
export interface LearnerStep {
  code: string; label: string; required: boolean; status: 'open' | 'done' | 'skipped'; skipReason: string | null; doneAt: string | null;
}
export interface LearnerLead {
  id: string; code: string; stage: string; stageLabel: string; status: 'active' | 'won' | 'lost'; source: string; sourceLabel: string;
  needSummary: string; version: number; createdAt: string; closedAt: string | null; lostReason: string | null; lostNote: string | null; wonNote: string | null;
  productId?: string | null; productName?: string | null; courseId?: string | null; courseName?: string | null;
  contract: { id: string; name: string | null } | null; nextAction: { id: string; title: string; dueAt: string } | null; steps: LearnerStep[];
}
export interface LearnerProduct {
  id: string; version: number; productId: string; name: string; priceVnd: number; attachedAt: string; detachedAt: string | null;
}
export interface LearnerConsent { purpose: string; label: string; granted: boolean; note: string | null; recordedAt: string | null }
export interface LearnerActivity { id: string; lead_id: string; type: string; summary: string; occurredAt: string; actorName: string | null }
export interface LearnerPermissions { work: boolean; claim: boolean; changeOwner: boolean }
export type LearnerDetail =
  | {
    restricted: true; contact: LearnerContact; permissions: LearnerPermissions;
    summary: { stage: string; stageLabel: string; source: string; sourceLabel: string } | null;
  }
  | {
    restricted: false; contact: LearnerContact; permissions: LearnerPermissions; leads: LearnerLead[]; products: LearnerProduct[];
    detachedProducts: LearnerProduct[]; consents: LearnerConsent[]; enrollments: LearnerEnrollment[]; activities: LearnerActivity[]; ownerCandidates: Member[];
  };
export interface LearnerEnrollment {
  id: string; version: number; status: string; leadId: string; leadCode: string; classId: string; className: string; courseName: string;
}

export interface ProductCourseItem {
  id: string;
  productId: string;
  name: string;
  status: 'active' | 'inactive';
  version: number;
}

export interface ProductItem {
  id: string;
  name: string;
  description: string | null;
  priceVnd: number;
  active: boolean;
  version: number;
  courses?: ProductCourseItem[];
}

export interface PartnerRow {
  id: string; name: string; status: string; startsOn: string | null; endsOn: string | null; accountId: string; accountName: string;
  version: number; learnerCount: number; stepsTotal: number; stepsDone: number;
}
export interface PartnerDetail {
  contract: { id: string; name: string; status: string; startsOn: string | null; endsOn: string | null; note: string | null; accountId: string; accountName: string; version: number };
  steps: { id: string; name: string; position: number; doneAt: string | null; version: number }[];
  learners: { leadId: string; code: string; contactId: string; name: string; phone: string | null; ownerName: string | null; stage: string; stageLabel: string; createdAt: string }[];
}
export type ImportAccountState = 'existing' | 'no_email' | 'email_taken' | 'new';
export interface ImportPreview {
  committed: boolean;
  create: { line: number; name: string; phone: string | null; email: string | null; account?: ImportAccountState }[];
  errors: { line: number | null; message: string }[];
  summary?: {
    newAccounts: number;
    existingAccounts: number;
    noEmail: number;
    emailTaken: number;
  };
}

// ---------- omnichannel inbox (src/worker/inbox/inbox-routes.ts) ----------
export interface InboxConversation {
  id: string;
  channelAccountId: string;
  accountName: string;
  channel: ChannelKind;
  kind: 'direct' | 'group';
  externalThreadId: string;
  contactId: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  mode: ConversationMode;
  assigneeUserId: string | null;
  assigneeName: string | null;
  assignedAt: string | null;
  handoffReason: string | null;
  lastMessageAt: string | null;
  lastInboundAt: string | null;
  lastStaffReplyAt: string | null;
  slaDueAt: string | null;
  createdAt: string;
  updatedAt: string;
  lastMessageBody: string | null;
  lastMessageSenderKind: SenderKind | null;
  lastMessageCreatedAt: string | null;
  unreadCount?: number;
  leadCode?: string | null;
}

/** Server-side filters of GET /inbox/conversations; `assignee` is a user id or `none` for unassigned. */
export interface ConversationFilter {
  mode?: ConversationMode;
  kind?: 'direct' | 'group';
  assignee?: string;
  account?: string;
  q?: string;
  before?: string;
}

export type InboxMessageStatus = 'received' | 'pending' | 'sent' | 'failed';
export interface InboxMessage {
  id: string;
  direction: 'in' | 'out';
  senderKind: SenderKind;
  senderExternalId: string | null;
  sentByUserId: string | null;
  sentByName: string | null;
  /** Group member name joined for a customer message. Absent on older payloads. */
  senderDisplayName?: string | null;
  /** Group member avatar joined for a customer message. Absent on older payloads. */
  senderAvatarUrl?: string | null;
  externalMsgId: string | null;
  body: string;
  /** JSON array of { url, name?, mimeType? }, or null. */
  attachmentsJson: string | null;
  status: InboxMessageStatus;
  createdAt: string;
}

export interface UploadedInboxMedia {
  key: string;
  url: string;
  mimeType: string;
  size: number;
}
export interface SendMessageResult { messageId: string; mode: ConversationMode; assigneeUserId: string | null }
export interface SetModeResult { mode: ConversationMode; assigneeUserId: string | null }

export interface ChannelAccount {
  id: string;
  channel: ChannelKind;
  externalId: string | null;
  displayName: string;
  agentKey: string | null;
  botEnabled: boolean;
  sendPaused: boolean;
  dailySendCap: number;
  quietStart: string | null;
  quietEnd: string | null;
  status: ChannelAccountStatus;
  /** Login QR as a data URL; only Admin receives it. */
  qrImage: string | null;
  qrExpiresAt: string | null;
  /** Seconds of QR life left when the Worker built this response. Null when there is no QR. */
  qrExpiresInSeconds: number | null;
  lastSeenAt: string | null;
  /** Error code the bridge last reported while the account is in error; only Admin receives it. */
  lastError: string | null;
  /** Zalo OA only. When on, the bot may confirm a valid 199k receipt. */
  registrationPolicy: boolean;
  /** Exact https://zalo.me/g/... link. Required while registrationPolicy is on. */
  registrationGroupUrl: string | null;
  createdAt: string;
  updatedAt: string;
}
/** GET /inbox/accounts. `bridgeOnline` is computed on the Worker: the bridge polled within the last 90 seconds. */
export interface ChannelAccountList {
  accounts: ChannelAccount[];
  bridgeOnline: boolean;
  bridgeLastSeenAt: string | null;
}
export interface ChannelAccountUpdate {
  botEnabled?: boolean;
  sendPaused?: boolean;
  dailySendCap?: number;
  quietStart?: string | null;
  quietEnd?: string | null;
  agentKey?: string;
}
/** PUT /inbox/accounts/:id/registration-policy. An empty link is sent as null. */
export interface RegistrationPolicyUpdate {
  enabled: boolean;
  groupUrl?: string | null;
}

/** `enabled` true means the customer-facing bot is switched OFF everywhere. */
export interface CustomerBotSwitch { enabled: boolean; updatedAt: string | null }

// ---------- inbox assignment (src/worker/inbox/assignment.ts) ----------
export type AssignMode = 'manual' | 'round_robin';
/** `scheduledSendsEnabled` is the organization-wide switch for recurring group posts (off until the pilot ends). */
export interface InboxSettings {
  assignMode: AssignMode;
  slaMinutes: number;
  scheduledSendsEnabled: boolean;
  updatedByUserId: string | null;
  updatedAt: string | null;
}
/** `scheduledSendsEnabled` is admin-only on the Worker. */
export interface InboxSettingsUpdate { assignMode?: AssignMode; slaMinutes?: number; scheduledSendsEnabled?: boolean }
/** Active inbox staff; `roundRobin` marks the roles that can be put on duty. */
export interface RosterMember {
  userId: string;
  displayName: string;
  role: RoleCode;
  onDuty: boolean;
  lastAssignedAt: string | null;
  roundRobin: boolean;
}
export interface AssignResult { assigneeUserId: string; assigneeName: string }

// ---------- lead intake (src/worker/inbox/intake.ts) ----------
export const INTAKE_FIELDS = ['name', 'phone', 'email', 'program', 'need', 'interest', 'note', 'summary'] as const;
export type IntakeField = (typeof INTAKE_FIELDS)[number];
export type IntakeValues = Partial<Record<IntakeField, string>> & { productId?: string };
export type IntakeStatus = 'pending' | 'classified' | 'discarded';
export type IntakePipeline = 'b2b' | 'learner';
export interface LeadIntake {
  id: string;
  conversationId: string;
  conversationName: string | null;
  externalThreadId: string;
  channel: ChannelKind;
  accountName: string;
  contactId: string | null;
  /** Current values. */
  fields: IntakeValues;
  /** Differing values from a later extraction, waiting for a staff member to accept them. */
  proposed: IntakeValues;
  status: IntakeStatus;
  leadId: string | null;
  classifiedByUserId: string | null;
  classifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface ClassifyIntakeResult { intakeId: string; leadId: string; leadCode?: string; contactId: string }

export interface InboxContactCrm {
  contact: {
    id: string;
    displayName: string;
    name?: string;
    ownerUserId: string | null;
    ownerName: string | null;
    holdExpiresAt: string | null;
    phone: string | null;
    email: string | null;
    restricted: boolean;
  };
  leads: LeadItem[];
  hasOpenLead: boolean;
  openLeadCode: string | null;
}

// ---------- Zalo groups and recurring posts (src/worker/inbox/group-schedules.ts) ----------
/** A Zalo group conversation; `id` is the conversation id. */
export interface ZaloGroup {
  id: string;
  channelAccountId: string;
  accountName: string;
  accountStatus: ChannelAccountStatus;
  sendPaused: boolean;
  externalThreadId: string;
  displayName: string | null;
  summaryEnabled: boolean;
  scheduledOptOut: boolean;
  botReplyEnabled: boolean;
  /** Null uses the default learner-care agent. */
  agentKey: string | null;
  /** ISO time until which Long stays quiet after someone typed on the bot account. */
  botPausedUntil: string | null;
  lastMessageAt: string | null;
  activeSchedules: number;
  leftAt: string | null;
  leaveRequestedAt: string | null;
}
export interface LeaveZaloGroupResult { id: string; leaveRequestedAt: string }
export interface ZaloGroupUpdate {
  summaryEnabled?: boolean;
  scheduledOptOut?: boolean;
  botReplyEnabled?: boolean;
  /** Null clears a custom agent so the group uses the default. */
  agentKey?: string | null;
}
/** One Zalo account in a group. `isStaff` applies to every group of that channel account. */
export interface ZaloGroupMember {
  externalUserId: string;
  displayName: string | null;
  avatarUrl: string | null;
  isStaff: boolean;
  updatedAt: string;
}

export type GroupScheduleStatus = 'draft' | 'pending_approval' | 'active' | 'paused';
export type ScheduleSkipReason = 'feature_off' | 'bot_switch_on' | 'account_unavailable' | 'group_opted_out' | 'quiet_hours' | 'daily_cap';
/** `weekdaysMask`: bit 0 = Monday … bit 6 = Sunday; `timeOfDay` is HH:MM Vietnam time. */
export interface GroupScheduleInput { templateText: string; weekdaysMask: number; timeOfDay: string }
export interface GroupSchedule extends GroupScheduleInput {
  id: string;
  conversationId: string;
  conversationName: string | null;
  externalThreadId: string;
  channelAccountId: string;
  accountName: string;
  status: GroupScheduleStatus;
  createdByUserId: string | null;
  createdByName: string | null;
  approvedByUserId: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastSkipReason: ScheduleSkipReason | null;
  createdAt: string;
  updatedAt: string;
}

// ---------- LMS (src/worker/lms-programs.ts, src/worker/lms-accounts.ts) ----------
export interface LmsLessonVideo {
  id: string;
  version: number;
  title: string;
  streamUid: string;
  position: number;
}

export interface LmsLessonItem {
  id: string;
  version: number;
  sectionId: string;
  title: string;
  groupTitle: string | null;
  position: number;
  hidden: boolean;
  videos: LmsLessonVideo[];
}

export interface LmsLearnerWithoutAccount {
  contactId: string;
  displayName: string;
  email: string | null;
}

export interface LmsProgramInfo {
  id: string;
  version: number;
  title: string;
  contentVersion: number;
  publishedAt: string | null;
  reviewDays: number | null;
  clonedFromProgramId: string | null;
}

export type ClassLmsDetail =
  | { program: null }
  | {
    program: LmsProgramInfo;
    lessons: LmsLessonItem[];
    counts: {
      enrolled: number;
      withAccount: number;
      withoutEmail: number;
    };
    learnersWithoutAccount: LmsLearnerWithoutAccount[];
    hasDefaultPassword: boolean;
  };

export interface LmsProgramOptionLesson {
  id: string;
  sectionId: string;
  title: string;
  groupTitle: string | null;
  position: number;
}

export interface LmsProgramOption {
  programId: string;
  classId: string | null;
  className: string | null;
  courseName: string | null;
  title: string;
  lessonCount: number;
  lessons?: LmsProgramOptionLesson[];
}

export type ImportLessonVideoStatus =
  | 'ready'
  | 'duplicate'
  | 'no_program'
  | 'no_lesson'
  | 'bad_link'
  | 'error';

export interface ImportLessonVideoRow {
  line: number;
  title: string;
  streamUid: string;
  status: ImportLessonVideoStatus;
  message?: string;
  programId?: string;
  programTitle?: string;
  className?: string;
  lessonId?: string;
  lessonTitle?: string;
  sectionId?: string;
}

export interface ImportLessonVideosResult {
  committed: boolean;
  rows: ImportLessonVideoRow[];
  summary: {
    ready: number;
    duplicate: number;
    unmatched: number;
    errors: number;
  };
}

export interface LmsOpenClass {
  id: string;
  name: string;
  courseName: string;
  scheduleText: string | null;
  hasProgram: boolean;
}

export interface CreateClassLearnerAccountsResult {
  created: number;
  skippedNoEmail: string[];
  skippedEmailTaken: string[];
}

export interface LearnerAccountProgramItem {
  programId: string;
  title: string;
  className: string | null;
  via: 'enrollment' | 'grant';
  accessId?: string;
  accessVersion?: number;
  mode?: 'grant' | 'block';
}

export interface LearnerAccountRow {
  id: string;
  version: number;
  contactId: string;
  displayName: string;
  email: string;
  status: 'active' | 'disabled';
  usesDefaultPassword: boolean;
  lastLoginAt: string | null;
  lockedUntil: string | null;
  programs: LearnerAccountProgramItem[];
}

export interface LearnerAccountSettings {
  hasDefaultPassword: boolean;
}

