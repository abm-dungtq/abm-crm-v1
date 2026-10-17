import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { BRIDGE_SCRIPT, injectBridge, parseHandbook } from './lms-html.mjs';

const BSR_UPLOAD_DIR = 'C:\\Users\\ABM\\.paseo\\uploads\\upload_bbf2cd32-3c86-48f7-87e8-d3c066f0a90d';

test('parseHandbook: inline HTML with 3 sections (including home), nav items, emoji stripped, groups applied', () => {
  const html = `<!doctype html>
<html>
<head><title>Cẩm nang &amp; Thực hành &#39;AI&#39;</title></head>
<body>
  <nav>
    <button class="nav-item" data-target="home"><span class="n-ico">🏠</span>Trang chủ</button>
    <button class="nav-item" data-target="b1p1"><span class="n-ico">🔥</span>Phần 1 — Khởi động</button>
    <button class="nav-item" data-target="b2m1">💡 Module 1 &amp; 2</button>
  </nav>
  <main>
    <section id="home"><h1>Trang chủ</h1></section>
    <section id="b1p1"><h1>Tiêu đề phụ 1</h1></section>
    <section id="b2m1"><h1>Tiêu đề phụ 2</h1><script>localStorage.getItem('x')</script></section>
  </main>
</body>
</html>`;

  const result = parseHandbook(html, {
    skip: ['home'],
    groups: [
      { prefix: 'b1', title: 'Buổi 1' },
      { prefix: 'b2', title: 'Buổi 2' },
    ],
  });

  assert.equal(result.title, "Cẩm nang & Thực hành 'AI'");
  assert.equal(result.lessons.length, 2);
  assert.deepEqual(result.lessons, [
    {
      sectionId: 'b1p1',
      title: 'Phần 1 — Khởi động',
      groupTitle: 'Buổi 1',
      position: 0,
    },
    {
      sectionId: 'b2m1',
      title: 'Module 1 & 2',
      groupTitle: 'Buổi 2',
      position: 1,
    },
  ]);
  assert.equal(result.warnings.length, 1);
});

test('parseHandbook & injectBridge: error cases and idempotent bridge injection', () => {
  const dupHtml = `<html><head><title>Dup</title></head><body>
    <section id="s1"><h1>Một</h1></section>
    <section id="s1"><h1>Hai</h1></section>
  </body></html>`;
  assert.throws(() => parseHandbook(dupHtml), /Trùng mã phần/);

  const badIdHtml = `<html><head><title>Bad</title></head><body>
    <section id="bad id!"><h1>Một</h1></section>
  </body></html>`;
  assert.throws(() => parseHandbook(badIdHtml), /không hợp lệ/);

  const emptyLessonsHtml = `<html><head><title>Empty</title></head><body>
    <section id="home"><h1>Home</h1></section>
  </body></html>`;
  assert.throws(() => parseHandbook(emptyLessonsHtml), /Không tìm thấy phần bài học/);

  assert.throws(() => injectBridge('<html><div>No body close</div></html>'), /<\/body>/);

  const validHtml = '<html><body><section id="s1"><h1>Một</h1></section></body></html>';
  const once = injectBridge(validHtml, { hideSelector: '.topbar' });
  assert.ok(once.includes(BRIDGE_SCRIPT));
  assert.ok(once.includes('<style>.topbar{display:none!important}</style>'));

  const twice = injectBridge(once, { hideSelector: '.topbar' });
  assert.equal(twice, once);
  const occurrences = twice.split('<!-- abm-lms-bridge -->').length - 1;
  assert.equal(occurrences, 1);
});

test('parseHandbook: BSR handbook real file (26 lessons)', (t) => {
  if (!existsSync(BSR_UPLOAD_DIR)) {
    t.skip('BSR upload directory not present on this machine');
    return;
  }
  const htmlFiles = readdirSync(BSR_UPLOAD_DIR).filter((f) => f.toLowerCase().endsWith('.html'));
  if (htmlFiles.length !== 1) {
    t.skip('Expected exactly one .html file in BSR upload directory');
    return;
  }

  const html = readFileSync(join(BSR_UPLOAD_DIR, htmlFiles[0]), 'utf8');
  const parsed = parseHandbook(html, {
    skip: ['home'],
    groups: [
      { prefix: 'b1', title: 'Buổi 1' },
      { prefix: 'b2', title: 'Buổi 2' },
      { prefix: 'b3', title: 'Buổi 3' },
      { prefix: 'lib', title: 'Thư viện' },
    ],
  });

  assert.equal(parsed.lessons.length, 26);
  const ids = parsed.lessons.map((l) => l.sectionId);
  assert.ok(ids.includes('b1p1'));
  assert.ok(ids.includes('b2m7'));
  assert.ok(ids.includes('b3data'));
  assert.ok(ids.includes('quiz'));
  assert.ok(!ids.includes('home'));
});
