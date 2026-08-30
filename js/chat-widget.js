/**
 * js/chat-widget.js — the floating "Sahayak" AI assistant.
 *
 * Drop it on any page, after api.js:
 *   <script src="js/api.js"></script>
 *   <script src="js/chat-widget.js"></script>
 *
 * It builds its own markup and styles, so it does not need Tailwind and works
 * on login.html too. Dark mode follows the <html class="dark"> that theme.js sets.
 */

(function () {
  'use strict';

  if (window.__sahayakChatLoaded) return;
  window.__sahayakChatLoaded = true;

  const SESSION_KEY = 'sahayakChatSession';
  const OPEN_KEY = 'sahayakChatOpen';

  const SUGGESTIONS = [
    'My fan is sparking',
    'What are your prices?',
    'Is the plumber available today?',
    'Check my bookings'
  ];

  const GREETING =
    'Namaste! I am Sahayak, your SahayakSetu assistant. Describe what needs fixing and I will find you a verified worker nearby.';

  /* --------------------------- session id --------------------------- */

  function sessionId() {
    let id;
    try { id = localStorage.getItem(SESSION_KEY); } catch { /* ignore */ }
    if (!id) {
      id = (window.crypto && crypto.randomUUID)
        ? crypto.randomUUID()
        : 'ss-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      try { localStorage.setItem(SESSION_KEY, id); } catch { /* ignore */ }
    }
    return id;
  }

  /* ------------------------------ styles ----------------------------
     This block used to carry its own palette: a blue/green gradient
     launcher, a gradient header, Inter, 18px radii and a 50px shadow —
     the one place on the site that still looked like a bought-in chatbot.

     It now borrows the register tokens from css/style.css, so the widget
     inherits the real palette and the night theme for free. Each var()
     keeps a literal fallback, so the widget still renders correctly if it
     is ever dropped on a page without the stylesheet. */

  const CSS = `
  .ssc-root{
    --ssc-fill:var(--pine,#1f5140);
    --ssc-fill-hover:var(--pine-deep,#123027);
    --ssc-surface:var(--card,#ffffff);
    --ssc-ground:var(--paper,#f4f4ef);
    --ssc-border:var(--rule,#dcdcd3);
    --ssc-ink:var(--ink,#1f211d);
    --ssc-muted:var(--muted,#6a6a62);
    --ssc-tint:var(--pine-tint,#dfe9e4);
    font-family:Karla,system-ui,-apple-system,'Segoe UI',sans-serif;}
  /* Pine is lightened for text in the dark theme, so a filled pine surface
     needs the same dedicated value the site's buttons use. */
  html.dark .ssc-root{--ssc-fill:#2c6b56;--ssc-fill-hover:#358067;}

  /* The launcher is a labelled tab, not a floating gradient circle that
     scales on hover. It says what it does, and it stays put. */
  .ssc-launcher{position:fixed;right:20px;bottom:20px;z-index:2147483000;
    display:flex;align-items:center;gap:8px;padding:9px 13px;
    border:1px solid var(--ssc-fill);border-radius:4px;cursor:pointer;
    background:var(--ssc-fill);color:#fff;
    font:500 13px/1.15 Karla,system-ui,sans-serif;
    box-shadow:0 2px 6px rgba(31,33,29,.18);
    transition:background .15s ease,border-color .15s ease;}
  .ssc-launcher:hover{background:var(--ssc-fill-hover);border-color:var(--ssc-fill-hover);}
  .ssc-launcher svg{width:17px;height:17px;fill:currentColor;flex:0 0 auto;}
  .ssc-launcher .ssc-close-icon,.ssc-root.ssc-open .ssc-launcher .ssc-chat-icon{display:none;}
  .ssc-root.ssc-open .ssc-launcher .ssc-close-icon{display:block;}
  .ssc-lbl-open{display:none;}
  .ssc-root.ssc-open .ssc-lbl-open{display:inline;}
  .ssc-root.ssc-open .ssc-lbl-shut{display:none;}
  .ssc-root.ssc-has-bottom-nav .ssc-launcher{bottom:88px;}

  .ssc-panel{position:fixed;right:20px;bottom:72px;z-index:2147483000;
    width:min(376px,calc(100vw - 32px));height:min(548px,calc(100vh - 108px));
    background:var(--ssc-surface);border:1px solid var(--ssc-border);border-radius:6px;
    box-shadow:var(--lift-modal,0 12px 32px rgba(31,33,29,.18));
    display:flex;flex-direction:column;overflow:hidden;
    opacity:0;transform:translateY(6px);pointer-events:none;
    transition:opacity .16s ease,transform .16s ease;}
  .ssc-root.ssc-open .ssc-panel{opacity:1;transform:none;pointer-events:auto;}
  .ssc-root.ssc-has-bottom-nav .ssc-panel{bottom:140px;height:min(548px,calc(100vh - 176px));}

  .ssc-header{background:var(--ssc-fill);color:#fff;padding:12px 14px;
    display:flex;align-items:center;gap:10px;flex:0 0 auto;}
  .ssc-avatar{width:32px;height:32px;border-radius:3px;background:rgba(255,255,255,.15);
    display:flex;align-items:center;justify-content:center;font-size:15px;flex:0 0 auto;}
  .ssc-title{font-family:Bitter,Georgia,serif;font-size:15px;font-weight:500;line-height:1.2;}
  .ssc-status{font-size:11.5px;line-height:1.3;margin-top:2px;color:rgba(255,255,255,.72);}
  /* Degraded goes brass, not red — a fallback reply is not a failure. */
  .ssc-status.ssc-degraded{color:var(--brass-lift,#d5a941);}
  .ssc-header-btn{margin-left:auto;background:transparent;border:none;color:#fff;cursor:pointer;
    padding:6px;border-radius:3px;line-height:0;opacity:.8;}
  .ssc-header-btn:hover{background:rgba(255,255,255,.16);opacity:1;}
  .ssc-header-btn svg{width:17px;height:17px;fill:currentColor;}

  .ssc-body{flex:1 1 auto;overflow-y:auto;padding:14px;background:var(--ssc-ground);
    display:flex;flex-direction:column;gap:9px;overscroll-behavior:contain;}
  .ssc-body::-webkit-scrollbar{width:7px;}
  .ssc-body::-webkit-scrollbar-thumb{background:var(--ssc-border);border-radius:4px;}

  /* Bubbles keep the left/right split — that is the clearest signal of who
     said what — but at the register's 6px radius, with the inner top corner
     squared off so each turn reads as a slip pinned to its side. */
  .ssc-msg{max-width:85%;padding:9px 12px;font-size:13.5px;line-height:1.5;
    border-radius:6px;white-space:pre-wrap;word-wrap:break-word;overflow-wrap:anywhere;}
  .ssc-bot{align-self:flex-start;background:var(--ssc-surface);color:var(--ssc-ink);
    border:1px solid var(--ssc-border);border-top-left-radius:2px;}
  .ssc-user{align-self:flex-end;background:var(--ssc-fill);color:#fff;
    border:1px solid var(--ssc-fill);border-top-right-radius:2px;}
  /* Errors match the site's notice: a brick rule down the side, not a
     centred red pill. */
  .ssc-err{align-self:stretch;max-width:100%;background:transparent;border:0;
    border-left:3px solid var(--brick,#9c2f22);border-radius:0;
    padding:1px 0 1px 10px;font-size:12.5px;color:var(--brick,#9c2f22);}

  .ssc-typing{align-self:flex-start;background:var(--ssc-surface);border:1px solid var(--ssc-border);
    border-radius:6px;border-top-left-radius:2px;padding:12px;display:flex;gap:5px;}
  .ssc-typing span{width:5px;height:5px;border-radius:50%;background:var(--ssc-muted);
    animation:ssc-pulse 1.2s infinite ease-in-out;}
  .ssc-typing span:nth-child(2){animation-delay:.15s;}
  .ssc-typing span:nth-child(3){animation-delay:.3s;}
  /* Fades rather than bounces — it reports that work is happening without
     drawing the eye off the transcript. */
  @keyframes ssc-pulse{0%,100%{opacity:.25;}50%{opacity:.9;}}

  .ssc-chips{display:flex;flex-wrap:wrap;gap:6px;padding:0 14px 11px;background:var(--ssc-ground);flex:0 0 auto;}
  .ssc-chip{background:var(--ssc-surface);border:1px solid var(--ssc-border);color:var(--ssc-ink);
    border-radius:3px;padding:6px 10px;font-size:12px;cursor:pointer;font-family:inherit;
    transition:background .15s ease,border-color .15s ease;}
  .ssc-chip:hover{background:var(--ssc-tint);border-color:var(--ssc-fill);}

  .ssc-form{display:flex;align-items:flex-end;gap:8px;padding:10px 12px;flex:0 0 auto;
    background:var(--ssc-surface);border-top:1px solid var(--ssc-border);}
  .ssc-input{flex:1 1 auto;resize:none;border:1px solid var(--ssc-border);border-radius:4px;
    padding:9px 11px;font-size:13.5px;font-family:inherit;line-height:1.45;max-height:104px;
    background:var(--ssc-ground);color:var(--ssc-ink);}
  .ssc-input:focus{outline:none;border-color:var(--ssc-fill);box-shadow:0 0 0 3px var(--ssc-tint);}
  .ssc-send{flex:0 0 auto;width:38px;height:38px;border-radius:4px;cursor:pointer;
    background:var(--ssc-fill);border:1px solid var(--ssc-fill);color:#fff;
    display:flex;align-items:center;justify-content:center;
    transition:background .15s ease,border-color .15s ease;}
  .ssc-send:hover:not(:disabled){background:var(--ssc-fill-hover);border-color:var(--ssc-fill-hover);}
  .ssc-send:disabled{opacity:.4;cursor:not-allowed;}
  .ssc-send svg{width:17px;height:17px;fill:currentColor;}
  .ssc-foot{font-size:11px;color:var(--ssc-muted);text-align:center;padding:0 12px 9px;
    background:var(--ssc-surface);flex:0 0 auto;}

  @media (max-width:480px){
    .ssc-panel{right:12px;left:12px;width:auto;bottom:68px;height:min(70vh,520px);}
    .ssc-root.ssc-has-bottom-nav .ssc-panel{bottom:136px;}
    /* Tight screens keep the icon and drop the label. Both states are named
       so the open-state rule above cannot out-specify this. */
    .ssc-launcher{right:14px;padding:10px;}
    .ssc-launcher span,.ssc-root.ssc-open .ssc-launcher span{display:none;}
  }
  @media (prefers-reduced-motion:reduce){
    .ssc-launcher,.ssc-panel,.ssc-chip,.ssc-send{transition:none;}
    .ssc-typing span{animation:none;opacity:.6;}
  }`;

  const ICON_CHAT = '<svg class="ssc-chat-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3C6.99 3 3 6.36 3 10.5c0 2.2 1.13 4.17 2.94 5.52-.13 1.2-.6 2.3-1.36 3.2-.22.26-.02.66.32.62 1.9-.24 3.5-.96 4.6-1.79.79.2 1.63.3 2.5.3 5.01 0 9-3.36 9-7.5S17.01 3 12 3Zm-3.5 8.75a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5Zm3.5 0a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5Zm3.5 0a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5Z"/></svg>';
  const ICON_CLOSE = '<svg class="ssc-close-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M18.3 5.71 12 12.01l-6.3-6.3-1.4 1.41 6.29 6.3-6.3 6.3 1.42 1.4 6.29-6.29 6.3 6.3 1.4-1.42-6.29-6.29 6.3-6.3z"/></svg>';
  const ICON_SEND = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z"/></svg>';
  const ICON_RESET = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4z"/></svg>';

  /* ------------------------------ build ----------------------------- */

  let root, body, input, sendBtn, chips, statusEl, typingEl = null;
  let busy = false;
  let historyLoaded = false;

  function build() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    root = document.createElement('div');
    root.className = 'ssc-root';
    // The launcher used to carry a red notification dot on first load, which
    // implied an unread message that did not exist. It is gone; the button
    // says what it is instead.
    root.innerHTML = `
      <button class="ssc-launcher" type="button" aria-label="Open the Sahayak assistant" aria-expanded="false">
        ${ICON_CHAT}${ICON_CLOSE}<span class="ssc-lbl-shut">Ask Sahayak</span><span class="ssc-lbl-open">Close</span>
      </button>
      <section class="ssc-panel" role="dialog" aria-label="Sahayak assistant" aria-modal="false">
        <header class="ssc-header">
          <div class="ssc-avatar">स</div>
          <div>
            <div class="ssc-title">Sahayak</div>
            <div class="ssc-status"><span class="ssc-status-text">Connecting…</span></div>
          </div>
          <button class="ssc-header-btn ssc-reset" type="button" title="Start a new conversation" aria-label="Start a new conversation">${ICON_RESET}</button>
        </header>
        <div class="ssc-body" role="log" aria-live="polite" aria-atomic="false"></div>
        <div class="ssc-chips"></div>
        <form class="ssc-form">
          <textarea class="ssc-input" rows="1" placeholder="Ask me anything…" maxlength="1000"
                    aria-label="Message to the Sahayak assistant"></textarea>
          <button class="ssc-send" type="submit" aria-label="Send message">${ICON_SEND}</button>
        </form>
        <div class="ssc-foot">AI assistant — please double-check anything important.</div>
      </section>`;
    document.body.appendChild(root);

    body = root.querySelector('.ssc-body');
    input = root.querySelector('.ssc-input');
    sendBtn = root.querySelector('.ssc-send');
    chips = root.querySelector('.ssc-chips');
    statusEl = root.querySelector('.ssc-status-text');

    // Don't sit on top of a fixed bottom navigation bar.
    const bottomNav = Array.from(document.querySelectorAll('nav')).find((nav) => {
      const cs = getComputedStyle(nav);
      return cs.position === 'fixed' && cs.display !== 'none' && parseFloat(cs.bottom || '999') < 40;
    });
    if (bottomNav) root.classList.add('ssc-has-bottom-nav');

    root.querySelector('.ssc-launcher').addEventListener('click', toggle);
    root.querySelector('.ssc-reset').addEventListener('click', reset);
    root.querySelector('.ssc-form').addEventListener('submit', (e) => { e.preventDefault(); send(input.value); });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input.value); }
    });
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 104) + 'px';
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && root.classList.contains('ssc-open')) toggle();
    });

    renderChips();
  }

  /* ----------------------------- rendering -------------------------- */

  function addMessage(text, who) {
    const el = document.createElement('div');
    el.className = 'ssc-msg ' + (who === 'user' ? 'ssc-user' : who === 'error' ? 'ssc-err' : 'ssc-bot');
    el.textContent = text;
    body.appendChild(el);
    body.scrollTop = body.scrollHeight;
    return el;
  }

  function showTyping() {
    typingEl = document.createElement('div');
    typingEl.className = 'ssc-typing';
    typingEl.innerHTML = '<span></span><span></span><span></span>';
    typingEl.setAttribute('aria-label', 'Sahayak is typing');
    body.appendChild(typingEl);
    body.scrollTop = body.scrollHeight;
  }

  function hideTyping() {
    if (typingEl) { typingEl.remove(); typingEl = null; }
  }

  function renderChips() {
    chips.innerHTML = '';
    SUGGESTIONS.forEach((text) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'ssc-chip';
      chip.textContent = text;
      chip.addEventListener('click', () => send(text));
      chips.appendChild(chip);
    });
  }

  function setBusy(state) {
    busy = state;
    sendBtn.disabled = state;
    input.disabled = state;
  }

  /* ------------------------------ actions --------------------------- */

  async function toggle() {
    const opening = !root.classList.contains('ssc-open');
    root.classList.toggle('ssc-open', opening);
    root.querySelector('.ssc-launcher').setAttribute('aria-expanded', String(opening));
    root.querySelector('.ssc-launcher').setAttribute('aria-label',
      opening ? 'Close the Sahayak assistant' : 'Open the Sahayak assistant');
    try { localStorage.setItem(OPEN_KEY, opening ? '1' : '0'); } catch { /* ignore */ }

    if (opening) {
      if (!historyLoaded) await loadHistory();
      setTimeout(() => input.focus(), 220);
    }
  }

  async function loadHistory() {
    historyLoaded = true;
    try {
      const messages = await window.API.chat.history(sessionId());
      if (messages && messages.length) {
        messages.forEach((m) => addMessage(m.content, m.role === 'user' ? 'user' : 'bot'));
        chips.style.display = 'none';
        return;
      }
    } catch { /* server down — fall through to the greeting */ }
    addMessage(GREETING, 'bot');
  }

  async function send(raw) {
    const text = String(raw || '').trim();
    if (!text || busy) return;

    if (!historyLoaded) { historyLoaded = true; addMessage(GREETING, 'bot'); }

    input.value = '';
    input.style.height = 'auto';
    chips.style.display = 'none';
    addMessage(text, 'user');
    setBusy(true);
    showTyping();

    try {
      const data = await window.API.chat.send(text, sessionId());
      hideTyping();
      addMessage(data.reply, 'bot');
      if (data.source === 'fallback') {
        setStatus('offline assistant', false);
      } else {
        setStatus('online', true);
      }
    } catch (err) {
      hideTyping();
      addMessage(err.message || 'Something went wrong. Please try again.', 'error');
    } finally {
      setBusy(false);
      input.focus();
    }
  }

  function reset() {
    try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
    body.innerHTML = '';
    chips.style.display = '';
    historyLoaded = true;
    addMessage(GREETING, 'bot');
    input.focus();
  }

  function setStatus(text, good) {
    statusEl.textContent = text;
    // The pip is gone; a degraded (fallback) status tints the status line
    // brass instead. "good" here means the live AI is answering.
    const line = root.querySelector('.ssc-status');
    if (line) line.classList.toggle('ssc-degraded', !good);
  }

  async function probe() {
    try {
      const health = await window.API.chat.health();
      setStatus(health.ai === 'openai' ? 'online' : 'offline assistant', health.ai === 'openai');
    } catch {
      setStatus('server offline', false);
    }
  }

  /* ------------------------------- init ----------------------------- */

  function init() {
    if (!window.API) {
      console.warn('[chat-widget] js/api.js must be loaded before js/chat-widget.js');
      return;
    }
    build();
    probe();
    let wasOpen = false;
    try { wasOpen = localStorage.getItem(OPEN_KEY) === '1'; } catch { /* ignore */ }
    if (wasOpen) toggle();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
