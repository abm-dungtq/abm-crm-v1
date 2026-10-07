// Generates seed/demo.sql: synthetic evaluation data only (fictional people, companies,
// phone numbers and .example emails). Times are SQL expressions relative to the moment the
// seed runs, so SLA states (on time / warning / breach) are meaningful right after seeding.
// Usage: node seed/generate-demo-seed.mjs
//        node seed/generate-demo-seed.mjs --demo-eval   (writes seed/b2b-demo.sql; does not touch demo.sql)
import { writeFileSync } from 'node:fs';
import { addWorkingMinutes, workingMinutesBetween } from '../../../packages/contracts/src/working-time.ts';

const demoEval = process.argv.includes('--demo-eval');
const SKIP_TABLES = new Set(['organization', 'department', 'team', 'app_user']);
const USER_SLOT = {
  'u-admin': 'slot-admin-1',
  'u-bgd': 'slot-head-1',
  'u-head': 'slot-head-1',
  'u-hung': 'slot-leader-1',
  'u-lan': 'slot-sale-1',
  'u-long': 'slot-sale-2',
  'u-mai': 'slot-leader-2',
  'u-huy': 'slot-sale-3',
};
const KEEP_ID = new Set(['org-abm', 'dep-kd', 'team-kd1', 'team-kd2']);

function remapId(value) {
  if (!demoEval || typeof value !== 'string') return value;
  if (USER_SLOT[value]) return USER_SLOT[value];
  if (KEEP_ID.has(value)) return value;
  if (/^(?:lead|ct|acc|ac|task|aud|apv)-\d/.test(value) || /^cp-[pe]-/.test(value) || /^act-/.test(value)) return `demo-${value}`;
  return value;
}

function remapRow(row) {
  const next = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === 'payload_json' && typeof value === 'string') {
      next[key] = value.replaceAll('u-long', USER_SLOT['u-long']).replaceAll('u-lan', USER_SLOT['u-lan']);
    } else next[key] = remapId(value);
  }
  return next;
}

const ts = (hours) => `strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '${hours >= 0 ? '+' : ''}${hours} hours')`;
// Working-hour offsets (first-contact SLA) are absolute instants computed now, so regenerate right before seeding.
const GEN_NOW = new Date();
const wh = (hours) => {
  if (hours >= 0) return `'${addWorkingMinutes(GEN_NOW, hours * 60).toISOString()}'`;
  let lo = GEN_NOW.getTime() - 400 * 86_400_000, hi = GEN_NOW.getTime();
  while (hi - lo > 60_000) {
    const mid = (lo + hi) / 2;
    if (workingMinutesBetween(new Date(mid), GEN_NOW) > -hours * 60) lo = mid; else hi = mid;
  }
  return `'${new Date(hi).toISOString()}'`;
};
const q = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : (v.startsWith?.('strftime(') || /^'\d{4}-/.test(v)) ? v : `'${String(v).replaceAll("'", "''")}'`);
const out = [];
const insert = (table, row) => {
  if (demoEval && SKIP_TABLES.has(table)) return;
  const written = demoEval ? remapRow(row) : row;
  const cols = Object.keys(written);
  out.push(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((c) => q(written[c])).join(', ')});`);
};
const stamp = (h = -720) => ({ created_at: ts(h), updated_at: ts(h) });

insert('organization', { id: 'org-abm', name: 'ABM (dữ liệu mẫu)', ...stamp() });
insert('department', { id: 'dep-kd', organization_id: 'org-abm', name: 'Phòng Kinh doanh', ...stamp() });
insert('team', { id: 'team-kd1', department_id: 'dep-kd', name: 'Kinh doanh 1', ...stamp() });
insert('team', { id: 'team-kd2', department_id: 'dep-kd', name: 'Kinh doanh 2', ...stamp() });

const users = [
  ['u-admin', 'Quản trị hệ thống', 'admin', null, null],
  ['u-bgd', 'Nguyễn Minh Anh', 'director', null, null],
  ['u-head', 'Lê Thu Hà', 'head', 'dep-kd', null],
  ['u-hung', 'Phạm Văn Hùng', 'leader', 'dep-kd', 'team-kd1'],
  ['u-lan', 'Đỗ Ngọc Lan', 'sale', 'dep-kd', 'team-kd1'],
  ['u-long', 'Vũ Đức Long', 'sale', 'dep-kd', 'team-kd1'],
  ['u-mai', 'Hoàng Mai', 'leader', 'dep-kd', 'team-kd2'],
  ['u-huy', 'Bùi Quang Huy', 'sale', 'dep-kd', 'team-kd2'],
];
for (const [id, name, role, dep, team] of users) {
  insert('app_user', { id, organization_id: 'org-abm', department_id: dep, team_id: team, display_name: name,
    email: `${id.slice(2)}@demo.abm.example`, role, ...stamp() });
}
const teamOf = Object.fromEntries(users.map(([id, , , , team]) => [id, team]));
// Live eval has one sale on kd1 and two sales on kd2. The users array above stays the demo.sql roster.
if (demoEval) teamOf['u-long'] = 'team-kd2';

// [code, contact, title, company, tax, industry, city, source, need, owner, stage, hoursInStage, value, extra]
const leads = [
  ['Trần Thị Mai Anh', 'Giám đốc vận hành', 'Công ty TNHH Gốm Sứ Thanh Lam Demo', '0310000001', 'Sản xuất', 'Bình Dương', 'website', 'Cần CRM quản lý đại lý và đơn hàng', 'u-lan', 'new', -3, null, {}],
  ['Lý Văn Phúc', 'Chủ doanh nghiệp', 'Cửa hàng Nội thất Phúc An Demo', null, 'Bán lẻ', 'TP.HCM', 'facebook', 'Hỏi gói phần mềm bán hàng cho 3 chi nhánh', 'u-long', 'new', -8, null, {}],
  ['Phan Thanh Tùng', 'Trưởng phòng IT', 'Công ty CP Logistics Sao Việt Demo', '0310000003', 'Logistics', 'Hải Phòng', 'zalo', 'Tìm giải pháp quản lý kho', 'u-huy', 'new', -30, null, {}],
  ['Ngô Bảo Ngọc', 'Kế toán trưởng', 'Công ty TNHH Dược phẩm Lộc Thọ Demo', '0310000004', 'Dược phẩm', 'Hà Nội', 'landing', 'Muốn demo module công nợ', 'u-lan', 'contacted', -20, 95000000, {}],
  ['Đặng Quốc Việt', 'Giám đốc', 'Công ty CP Xây dựng Hưng Thịnh Demo', '0310000005', 'Xây dựng', 'Đà Nẵng', 'referral', 'Quản lý hồ sơ dự án và nhà thầu phụ', 'u-long', 'contacted', -130, 150000000, { overdue: true }],
  ['Vương Thu Trang', 'Trưởng phòng Marketing', 'Công ty TNHH Mỹ phẩm Cỏ Mây Demo', '0310000006', 'Mỹ phẩm', 'TP.HCM', 'form', 'Tự động hóa chăm sóc khách hàng sau mua', 'u-lan', 'qualified', -40, 210000000, {}],
  ['Hồ Minh Khang', 'CEO', 'Công ty CP Công nghệ Nam Phương Demo', '0310000007', 'Công nghệ', 'Cần Thơ', 'partner', 'Thay hệ thống CRM cũ', 'u-huy', 'qualified', -90, 380000000, {}],
  ['Lâm Ngọc Hân', 'Giám đốc tài chính', 'Công ty TNHH Thực phẩm Sạch Xanh Demo', '0310000008', 'Thực phẩm', 'Long An', 'website', 'Đồng bộ đơn hàng với kế toán', 'u-lan', 'consulting', -60, 180000000, {}],
  ['Tạ Đình Phong', 'Phó giám đốc', 'Công ty CP Cơ khí Đông Á Demo', '0310000009', 'Sản xuất', 'Bắc Ninh', 'self', 'Quản lý báo giá và hợp đồng', 'u-long', 'consulting', -260, 420000000, { overdue: true }],
  ['Kiều Anh Thư', 'Giám đốc kinh doanh', 'Công ty TNHH Thời trang Mộc Demo', '0310000010', 'Thời trang', 'TP.HCM', 'facebook', 'Pipeline cho 20 nhân viên bán hàng', 'u-huy', 'quoted', -30, 450000000, {}],
  ['Mạc Văn Toàn', 'Trưởng phòng mua hàng', 'Công ty CP Nhựa Tân Tiến Demo', '0310000011', 'Sản xuất', 'Đồng Nai', 'landing', 'So sánh báo giá 2 phương án triển khai', 'u-lan', 'quoted', -100, 260000000, {}],
  ['Chu Thị Hằng', 'Tổng giám đốc', 'Tập đoàn Giáo dục Ánh Dương Demo', '0310000012', 'Giáo dục', 'Hà Nội', 'referral', 'CRM tuyển sinh cho 8 cơ sở', 'u-long', 'negotiating', -140, 1200000000, {}],
  ['Âu Dương Khải', 'Giám đốc', 'Công ty TNHH Du lịch Biển Xanh Demo', '0310000013', 'Du lịch', 'Khánh Hòa', 'zalo', 'Quản lý booking đoàn và đại lý', 'u-huy', 'negotiating', -70, 640000000, {}],
  ['Quách Gia Bảo', 'Giám đốc điều hành', 'Công ty CP Nông sản Việt Demo', '0310000014', 'Nông nghiệp', 'Đắk Lắk', 'partner', 'Ký hợp đồng triển khai giai đoạn 1', 'u-lan', 'closing', -45, 320000000, {}],
  ['Tôn Nữ Diệu', 'Trưởng phòng hành chính', 'Bệnh viện Tư nhân An Tâm Demo', '0310000015', 'Y tế', 'Huế', 'website', 'Chốt gói CSKH bệnh nhân', 'u-huy', 'closing', -20, 520000000, {}],
  ['La Thành Nam', 'Giám đốc', 'Công ty TNHH In ấn Kim Phát Demo', '0310000016', 'In ấn', 'TP.HCM', 'self', 'Triển khai CRM cho phòng kinh doanh', 'u-long', 'won', -100, 260000000, {}],
  ['Bạch Tuyết Nhung', 'CEO', 'Công ty CP Spa Thanh Xuân Demo', '0310000017', 'Làm đẹp', 'Hà Nội', 'facebook', 'Quản lý khách hàng thành viên', 'u-huy', 'won', -30, 180000000, {}],
  ['Thái Hoàng Long', 'Chủ doanh nghiệp', 'Cửa hàng Điện máy Hoàng Long Demo', null, 'Bán lẻ', 'Vĩnh Long', 'zalo', 'Phần mềm quản lý bảo hành', 'u-lan', 'lost', -50, 60000000, { lost: ['price', null] }],
  ['Diệp Văn Cường', 'Giám đốc', 'Công ty TNHH Vận tải Cường Thịnh Demo', '0310000019', 'Logistics', 'Bình Dương', 'referral', 'Theo dõi tài xế và chuyến hàng', 'u-long', 'lost', -80, 300000000, { lost: ['competitor', 'Khách chọn giải pháp nội bộ của tập đoàn'] }],
  ['Hà Thị Thu', 'Nhân viên mua hàng', 'Công ty TNHH Bao bì Thu Hà Demo', null, 'Sản xuất', 'Long An', 'website', 'Điền form xin báo giá CRM', null, 'new', -1, null, {}],
  ['Mai Xuân Trường', 'Chủ shop', null, null, null, 'TP.HCM', 'facebook', 'Inbox fanpage hỏi giá phần mềm', null, 'new', -3, null, {}],
  ['Lưu Quang Vinh', 'Giám đốc đầu tư', 'Công ty CP Đầu tư Lam Sơn Xanh Demo', '0310000022', 'Tài chính', 'TP.HCM', 'referral', 'Anh Toàn giới thiệu, cần CRM cho 4 dự án', null, 'new', -5, null, {}],
];

let n = 0;
const leadRefs = {};
for (const [contact, title, company, tax, industry, city, source, need, owner, stage, hoursInStage, value, extra] of leads) {
  n++;
  const code = `L-${String(n).padStart(4, '0')}`;
  const id = `lead-${String(n).padStart(2, '0')}`;
  const contactId = `ct-${n}`;
  const accountId = company ? `acc-${n}` : null;
  const createdH = Math.min(hoursInStage, -1) - (stage === 'new' ? 0 : 24 * 3);
  if (company) insert('account', { id: accountId, organization_id: 'org-abm', name: company, tax_code: tax, industry, city, ...stamp(createdH) });
  insert('contact', { id: contactId, organization_id: 'org-abm', display_name: contact, job_title: title, ...stamp(createdH) });
  if (company) out.push(`INSERT INTO account_contact (id, account_id, contact_id, role, is_primary, created_at) VALUES ('${remapId(`ac-${n}`)}', '${remapId(accountId)}', '${remapId(contactId)}', 'Người liên hệ chính', 1, ${ts(createdH)});`);
  const phone = `0900${String(100000 + n).slice(-6)}`;
  insert('contact_point', { id: `cp-p-${n}`, contact_id: contactId, type: 'phone', value: phone, normalized_value: phone, created_at: ts(createdH) });
  const email = `lienhe${n}@khachhang-demo.example`;
  insert('contact_point', { id: `cp-e-${n}`, contact_id: contactId, type: 'email', value: email, normalized_value: email, created_at: ts(createdH) });

  // Assigned new leads are measured in working hours (first-contact SLA), the rest in calendar hours.
  const at = (h) => (stage === 'new' && owner ? wh(h) : ts(h));
  const status = !owner ? 'queue' : stage === 'won' || stage === 'lost' ? stage : 'active';
  const contacted = stage !== 'new';
  const taskId = status === 'active' ? `task-${n}` : null;
  insert('lead', {
    id, code, organization_id: 'org-abm', department_id: 'dep-kd', team_id: owner ? teamOf[owner] : null,
    account_id: accountId, contact_id: contactId, source, need_summary: need, expected_value: value,
    owner_user_id: owner, stage, status, next_action_task_id: taskId,
    lost_reason: extra.lost?.[0] ?? null, lost_note: extra.lost?.[1] ?? null,
    first_contact_at: contacted ? ts(createdH + 3) : null,
    assigned_at: owner ? (stage === 'new' ? at(hoursInStage) : ts(createdH + 1)) : null,
    stage_entered_at: at(hoursInStage), last_activity_at: contacted ? ts(Math.max(hoursInStage, -48)) : null,
    closed_at: status === 'won' || status === 'lost' ? ts(hoursInStage) : null,
    created_by_user_id: owner ?? 'u-head', created_at: at(createdH), updated_at: at(hoursInStage),
  });
  leadRefs[code] = { id, owner, stage };

  if (taskId) {
    const first = stage === 'new';
    const due = first ? hoursInStage + 4 : extra.overdue ? -20 : (n % 3 === 0 ? 3 : n % 3 === 1 ? 26 : 50);
    const titles = {
      new: 'Liên hệ lần đầu', contacted: 'Gửi tài liệu giới thiệu và hẹn lịch demo', qualified: 'Khảo sát nhu cầu chi tiết với phòng ban',
      consulting: 'Demo giải pháp cho ban giám đốc', quoted: 'Gọi lại xác nhận phản hồi báo giá', negotiating: 'Thống nhất điều khoản thanh toán',
      closing: 'Gửi hợp đồng bản cuối để ký',
    };
    insert('task', { id: taskId, lead_id: id, title: titles[stage], due_at: wh(due), assignee_user_id: owner,
      status: 'open', created_by_user_id: owner, created_at: at(hoursInStage), updated_at: at(hoursInStage) });
  }
  if (contacted) {
    const acts = [
      ['call', `Gọi lần đầu cho ${contact}, khách xác nhận nhu cầu: ${need.toLowerCase()}.`, createdH + 3],
      ['email', 'Gửi email giới thiệu năng lực và case study cùng ngành.', createdH + 6],
    ];
    if (['qualified', 'consulting', 'quoted', 'negotiating', 'closing', 'won'].includes(stage)) acts.push(['meeting', 'Họp online 45 phút, khách chia sẻ quy trình hiện tại và đầu mối quyết định.', createdH + 30]);
    if (['quoted', 'negotiating', 'closing', 'won'].includes(stage)) acts.push(['proposal_sent', 'Gửi báo giá và đề xuất triển khai 2 giai đoạn.', hoursInStage + 1]);
    if (['negotiating', 'closing'].includes(stage)) acts.push(['customer_reply', 'Khách phản hồi: đồng ý phạm vi, cần giãn tiến độ thanh toán.', Math.min(hoursInStage + 10, -1)]);
    let k = 0;
    for (const [type, summary, h] of acts) {
      insert('activity', { id: `act-${n}-${k++}`, lead_id: id, type, summary, actor_user_id: owner, actor_kind: 'human', occurred_at: ts(Math.min(h, -1)), created_at: ts(Math.min(h, -1)) });
    }
    insert('activity', { id: `act-${n}-st`, lead_id: id, type: 'stage_changed', summary: `Chuyển sang stage hiện tại`, actor_user_id: owner, actor_kind: 'human', occurred_at: ts(hoursInStage), created_at: ts(hoursInStage) });
    if (stage === 'lost') insert('activity', { id: `act-${n}-lost`, lead_id: id, type: 'note', summary: 'Đóng Lost, đã ghi lý do.', actor_user_id: owner, actor_kind: 'human', occurred_at: ts(hoursInStage), created_at: ts(hoursInStage) });
  }
  insert('audit_log', { id: `aud-${n}`, actor_user_id: owner ?? 'u-head', actor_kind: 'human', command: 'createLead', entity: 'lead', entity_id: id,
    before_json: null, after_json: JSON.stringify({ source, status: owner ? 'active' : 'queue' }), created_at: ts(createdH) });
}

const approvals = [
  { id: 'apv-1', kind: 'owner_change', lead: 'L-0009', payload: { fromUserId: 'u-long', toUserId: 'u-lan' }, reason: 'Khách chuyển văn phòng ra Hà Nội, chị Lan đang phụ trách khu vực phía Bắc.', by: 'u-long', kindBy: 'human', h: -5 },
  { id: 'apv-2', kind: 'agent_stage_change', lead: 'L-0006', payload: { toStage: 'consulting', agentName: 'Trợ lý TQD (Lark DM)', evidence: 'Khách xác nhận ngân sách và lịch demo trong tin nhắn Lark lúc 9:12.' }, reason: 'Khách đã xác nhận ngân sách và người quyết định.', by: null, kindBy: 'agent', h: -3 },
  { id: 'apv-3', kind: 'agent_stage_change', lead: 'L-0013', payload: { toStage: 'closing', agentName: 'Trợ lý TQD (Lark DM)', evidence: 'Khách gửi biên bản đồng ý điều khoản qua email.' }, reason: 'Khách đồng ý điều khoản thanh toán.', by: null, kindBy: 'agent', h: -2 },
];
for (const a of approvals) {
  insert('approval', { id: a.id, kind: a.kind, lead_id: leadRefs[a.lead].id, target_version: 1, payload_json: JSON.stringify(a.payload),
    reason: a.reason, status: 'pending', requested_by_user_id: a.by, requested_by_kind: a.kindBy, created_at: ts(a.h), updated_at: ts(a.h) });
}
if (demoEval) {
  out.push(`INSERT INTO lead_counter (organization_id, next_value) VALUES ('org-abm', ${n + 1}) ON CONFLICT(organization_id) DO UPDATE SET next_value=excluded.next_value;`);
} else {
  insert('lead_counter', { organization_id: 'org-abm', next_value: n + 1 });
}

const header = demoEval
  ? `-- generated-at: ${new Date().toISOString()}\n-- Generated by seed/generate-demo-seed.mjs --demo-eval. Synthetic data only; do not edit by hand.\n-- No organization, department, team, or app_user rows. Staff ids are slot tokens swapped at load.\n`
  : '-- Generated by seed/generate-demo-seed.mjs. Synthetic data only; do not edit by hand.\n';
const fileName = demoEval ? 'b2b-demo.sql' : 'demo.sql';
writeFileSync(new URL(`./${fileName}`, import.meta.url), header + out.join('\n') + '\n');
console.log(`${fileName}: ${n} leads, ${out.length} statements`);
