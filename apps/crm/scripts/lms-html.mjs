// Pure HTML helpers for parsing an ABM LMS handbook and injecting the parent-iframe postMessage bridge.

const SECTION_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const BRIDGE_MARKER = '<!-- abm-lms-bridge -->';

export const BRIDGE_SCRIPT = `<script>(function(){
  function gotoSection(id){
    if(typeof id!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(id))return;
    var esc=typeof CSS!=='undefined'&&CSS.escape?CSS.escape(id):id;
    var nav=document.querySelector('[data-target="'+esc+'"]');
    if(nav)nav.click();
    else{var el=document.getElementById(id);if(el&&el.scrollIntoView)el.scrollIntoView();}
  }
  window.addEventListener('message',function(event){
    if(event.source!==window.parent)return;
    var data=event.data;
    if(data&&data.type==='abm-lms:goto'&&typeof data.sectionId==='string'){
      gotoSection(data.sectionId);
    }
  });
  document.addEventListener('click',function(event){
    var link=event.target&&event.target.closest?event.target.closest('a[target]'):null;
    if(link&&!/noopener/.test(link.rel))link.rel=(link.rel?link.rel+' ':'')+'noopener noreferrer';
    var target=event.target&&event.target.closest?event.target.closest('[data-target]'):null;
    if(!target)return;
    var sectionId=target.dataset?target.dataset.target:target.getAttribute('data-target');
    if(sectionId&&/^[A-Za-z0-9_-]{1,64}$/.test(sectionId)){
      window.parent.postMessage({type:'abm-lms:section',sectionId:sectionId},'*');
    }
  });
  function onHash(){
    if(location.hash&&location.hash.length>1){
      gotoSection(decodeURIComponent(location.hash.slice(1)));
    }
  }
  if(document.readyState==='loading')window.addEventListener('DOMContentLoaded',onHash);
  else onHash();
})();</script>`;

function decodeEntities(str) {
  return str
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function cleanText(rawHtml, stripEmoji = false) {
  let s = rawHtml
    .replace(/<span\b[^>]*class="[^"]*\b(?:n-ico|q-ico|ico|icon|soon-tag)\b[^"]*"[^>]*>[\s\S]*?<\/span>/gi, ' ')
    .replace(/<i\b[^>]*>[\s\S]*?<\/i>/gi, ' ')
    .replace(/<[^>]+>/g, '');
  s = decodeEntities(s);
  if (stripEmoji) {
    s = s.replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D]/gu, '');
  }
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Parses a self-contained HTML handbook into program metadata and ordered lessons.
 * @param {string} html
 * @param {{ skip?: string[]; groups?: { prefix: string; title: string }[] }} [options]
 */
export function parseHandbook(html, { skip = ['home'], groups = [] } = {}) {
  if (typeof html !== 'string' || !html.trim()) {
    throw new Error('Nội dung HTML cẩm nang trống');
  }

  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? cleanText(titleMatch[1], false) : '';

  const navWithoutIconSpans = html.replace(
    /<span\b[^>]*class="[^"]*\b(?:n-ico|q-ico|ico|icon|soon-tag)\b[^"]*"[^>]*>[\s\S]*?<\/span>/gi,
    ' ',
  );
  const navMap = new Map();
  const navRe = /<([a-zA-Z0-9-]+)\b[^>]*\bdata-target=(?:"([^"]+)"|'([^']+)')[^>]*>([\s\S]*?)<\/\1>/g;
  let navMatch;
  while ((navMatch = navRe.exec(navWithoutIconSpans)) !== null) {
    const targetId = navMatch[2] ?? navMatch[3];
    if (!navMap.has(targetId)) {
      const text = cleanText(navMatch[4], true);
      if (text) navMap.set(targetId, text);
    }
  }

  const skipSet = new Set(skip);
  const seenIds = new Set();
  const sectionMatches = [];
  const sectionRe = /<section\b[^>]*\bid="([^"]+)"[^>]*>/gi;
  let secMatch;
  while ((secMatch = sectionRe.exec(html)) !== null) {
    sectionMatches.push({
      sectionId: secMatch[1],
      contentStart: secMatch.index + secMatch[0].length,
      tagStart: secMatch.index,
    });
  }

  const lessons = [];
  for (let i = 0; i < sectionMatches.length; i++) {
    const { sectionId, contentStart } = sectionMatches[i];
    if (!SECTION_ID_RE.test(sectionId)) {
      throw new Error(`Mã phần (section id) không hợp lệ: "${sectionId}"`);
    }
    if (seenIds.has(sectionId)) {
      throw new Error(`Trùng mã phần (section id): "${sectionId}"`);
    }
    seenIds.add(sectionId);
    if (skipSet.has(sectionId)) continue;

    const nextStart = i + 1 < sectionMatches.length ? sectionMatches[i + 1].tagStart : html.length;
    const sectionSlice = html.slice(contentStart, nextStart);
    const closeIdx = sectionSlice.search(/<\/section\b/i);
    const sectionBody = closeIdx >= 0 ? sectionSlice.slice(0, closeIdx) : sectionSlice;

    let lessonTitle = navMap.get(sectionId) ?? '';
    if (!lessonTitle) {
      const headingMatch = sectionBody.match(/<(h[12])\b[^>]*>([\s\S]*?)<\/\1>/i);
      if (headingMatch) {
        lessonTitle = cleanText(headingMatch[2], true);
      }
    }
    if (!lessonTitle) {
      lessonTitle = sectionId;
    }

    let groupTitle = null;
    for (const g of groups) {
      if (g && typeof g.prefix === 'string' && g.prefix && sectionId.startsWith(g.prefix)) {
        groupTitle = g.title;
        break;
      }
    }

    lessons.push({
      sectionId,
      title: lessonTitle,
      groupTitle,
      position: lessons.length,
    });
  }

  if (lessons.length === 0) {
    throw new Error('Không tìm thấy phần bài học nào trong cẩm nang');
  }
  if (lessons.length > 300) {
    throw new Error(`Cẩm nang có quá nhiều phần (${lessons.length} > 300)`);
  }

  const warnings = [];
  if (/\b(?:localStorage|sessionStorage)\b/.test(html)) {
    warnings.push('Cẩm nang có tham chiếu localStorage/sessionStorage (bị chặn trong iframe sandbox học viên)');
  }

  return {
    title: title || lessons[0].title,
    lessons,
    warnings,
  };
}

/**
 * Injects the postMessage bridge (and optional CSS hide rule) right before the last </body>.
 * @param {string} html
 * @param {{ hideSelector?: string }} [options]
 */
export function injectBridge(html, { hideSelector } = {}) {
  if (typeof html !== 'string') {
    throw new Error('Nội dung HTML không hợp lệ');
  }
  const bodyCloseMatches = [...html.matchAll(/<\/body\s*>/gi)];
  if (bodyCloseMatches.length === 0) {
    throw new Error('Không tìm thấy thẻ đóng </body> trong cẩm nang');
  }
  if (html.includes(BRIDGE_MARKER)) {
    return html;
  }
  const lastMatch = bodyCloseMatches[bodyCloseMatches.length - 1];
  const idx = lastMatch.index;
  const styleTag = hideSelector && hideSelector.trim()
    ? `<style>${hideSelector.trim()}{display:none!important}</style>`
    : '';
  const injection = `${BRIDGE_MARKER}${styleTag}${BRIDGE_SCRIPT}`;
  return html.slice(0, idx) + injection + html.slice(idx);
}
