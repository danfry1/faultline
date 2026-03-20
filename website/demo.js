/* demo.js — Animated ESLint simulation (4-act loop) for the faultline homepage.
   All content is built from hardcoded helper functions wrapping static string
   literals. No user input is involved. */

(function () {
  'use strict';

  // Syntax helpers — wrap text in .token-* spans
  function kw(t)   { return '<span class="token-keyword">' + t + '</span>'; }
  function fn(t)   { return '<span class="token-function">' + t + '</span>'; }
  function tp(t)   { return '<span class="token-type">' + t + '</span>'; }
  function str(t)  { return '<span class="token-string">' + t + '</span>'; }
  function num(t)  { return '<span class="token-number">' + t + '</span>'; }
  function fl(t)   { return '<span class="token-faultline">' + t + '</span>'; }
  function prop(t) { return '<span class="token-property">' + t + '</span>'; }

  function line(n, content) {
    return '<div class="demo-line"><span class="demo-gutter">' + n + '</span><span class="demo-line-code">' + content + '</span></div>';
  }

  // ── Captions for each act ──────────────────────────────────────────────────
  var captions = [
    'An untyped throw. No structure, no data, catch gets <code>unknown</code>.',
    'One-line fix. Now it carries a tag, code, status, and typed data.',
    'But this catch block doesn\u2019t handle all the errors\u2026',
    'Handled. <code>e.data.userId</code> is <code>string</code> \u2014 fully typed.'
  ];

  // ── Act 1: Raw throw ──────────────────────────────────────────────────────
  function buildAct1() {
    return (
      line(1, kw('async') + ' ' + kw('function') + ' ' + fn('getUser') + '(id: ' + tp('string') + ') {') +
      line(2, '  ' + kw('const') + ' user = ' + kw('await') + ' db.' + fn('find') + '(id);') +
      line(3, '  ' + kw('if') + ' (!user) {') +
      line(4, '    <span class="demo-squiggly" id="squig-1">' + kw('throw') + ' ' + kw('new') + ' ' + tp('Error') + '(' + str('"User not found"') + ');</span>') +
      line(5, '  }') +
      line(6, '  ' + kw('return') + ' user;') +
      line(7, '}') +
      '<div class="demo-tooltip" id="tip-1"><span class="tooltip-icon">\u26A0</span> <span class="tooltip-rule">faultline/no-raw-throw</span> Use a typed error factory</div>'
    );
  }

  // ── Act 2: Fixed with typed factory ────────────────────────────────────────
  function buildAct2() {
    return (
      line(1, kw('async') + ' ' + kw('function') + ' ' + fn('getUser') + '(id: ' + tp('string') + ') {') +
      line(2, '  ' + kw('const') + ' user = ' + kw('await') + ' db.' + fn('find') + '(id);') +
      line(3, '  ' + kw('if') + ' (!user) {') +
      line(4, '    ' + kw('throw') + ' ' + fl('UserErrors') + '.' + fl('NotFound') + '({ ' + prop('userId') + ': id });') +
      line(5, '  }') +
      line(6, '  ' + kw('return') + ' user;') +
      line(7, '}') +
      '<div class="demo-gutter-pulse" id="pulse-2"></div>'
    );
  }

  // ── Act 3: Uncovered catch ─────────────────────────────────────────────────
  function buildAct3() {
    return (
      line(1, kw('try') + ' {') +
      line(2, '  ' + kw('const') + ' user = ' + kw('await') + ' ' + fn('getUser') + '(id);') +
      line(3, '<span class="demo-squiggly" id="squig-3">} ' + kw('catch') + ' (e) {</span>') +
      line(4, '<span class="demo-squiggly" id="squig-3b">  ' + kw('return') + ' { ' + prop('status') + ': ' + num('500') + ' };</span>') +
      line(5, '}') +
      '<div class="demo-tooltip" id="tip-3"><span class="tooltip-icon">\u26A0</span> <span class="tooltip-rule">faultline/uncovered-catch</span> NotFound, Unauthorized not handled</div>'
    );
  }

  // ── Act 4: Typed catch ─────────────────────────────────────────────────────
  function buildAct4() {
    return (
      line(1, kw('try') + ' {') +
      line(2, '  ' + kw('const') + ' user = ' + kw('await') + ' ' + fn('getUser') + '(id);') +
      line(3, '} ' + kw('catch') + ' (e) {') +
      line(4, '  ' + kw('if') + ' (' + fl('isErrorTag') + '(e, ' + fl('UserErrors') + '.' + fl('NotFound') + ')) {') +
      line(5, '    ' + kw('return') + ' { ' + prop('status') + ': ' + num('404') + ', ' + prop('userId') + ': e.data.userId };') +
      line(6, '  } <span class="demo-type-hint" id="hint-4">// ~~~~~~ ' + tp('string') + '</span>') +
      line(7, '}') +
      '<div class="demo-gutter-pulse" id="pulse-4"></div>'
    );
  }

  // ── Build the editor ───────────────────────────────────────────────────────
  function buildEditor() {
    var el = document.getElementById('demo-editor');
    if (!el) return null;

    el.innerHTML =
      '<div class="demo-tab-bar">' +
        '<span class="demo-tab-icon">TS</span>' +
        '<span class="demo-tab-label">user-service.ts</span>' +
      '</div>' +
      '<div class="demo-code-area">' +
        '<div class="demo-act" id="act-1">' + buildAct1() + '</div>' +
        '<div class="demo-act" id="act-2">' + buildAct2() + '</div>' +
        '<div class="demo-act" id="act-3">' + buildAct3() + '</div>' +
        '<div class="demo-act" id="act-4">' + buildAct4() + '</div>' +
      '</div>' +
      '<div class="demo-caption" id="demo-caption"></div>' +
      '<div class="demo-steps">' +
        '<button class="demo-step is-active" data-act="0"></button>' +
        '<button class="demo-step" data-act="1"></button>' +
        '<button class="demo-step" data-act="2"></button>' +
        '<button class="demo-step" data-act="3"></button>' +
      '</div>';

    // Bind step dot clicks
    var dots = el.querySelectorAll('.demo-step');
    for (var i = 0; i < dots.length; i++) {
      dots[i].addEventListener('click', (function (idx) {
        return function () { jumpTo(idx); };
      })(i));
    }

    return el;
  }

  // ── Animation ──────────────────────────────────────────────────────────────
  var timers = [];

  function schedule(callback, ms) {
    timers.push(setTimeout(callback, ms));
  }

  function clearAllTimers() {
    for (var i = 0; i < timers.length; i++) clearTimeout(timers[i]);
    timers = [];
  }

  function setCaption(index) {
    var el = document.getElementById('demo-caption');
    if (el) el.innerHTML = captions[index];

    // Update step dots
    var dots = document.querySelectorAll('.demo-step');
    for (var i = 0; i < dots.length; i++) {
      dots[i].classList.toggle('is-active', i === index);
    }
  }

  function showAct(actId, captionIndex) {
    var acts = document.querySelectorAll('.demo-act');
    for (var i = 0; i < acts.length; i++) acts[i].classList.remove('is-active');

    var els = document.querySelectorAll('.demo-squiggly, .demo-tooltip, .demo-gutter-pulse, .demo-type-hint');
    for (var i = 0; i < els.length; i++) els[i].classList.remove('is-visible');

    var target = document.getElementById(actId);
    if (target) target.classList.add('is-active');

    setCaption(captionIndex);
  }

  function show(elemId) {
    var el = document.getElementById(elemId);
    if (el) el.classList.add('is-visible');
  }

  function runDemoLoop() {
    clearAllTimers();

    // Act 1: raw throw → squiggly appears
    showAct('act-1', 0);
    schedule(function () {
      show('squig-1');
      show('tip-1');
    }, 800);

    // Act 2: the fix
    schedule(function () {
      showAct('act-2', 1);
      schedule(function () { show('pulse-2'); }, 400);
    }, 4000);

    // Act 3: uncovered catch
    schedule(function () {
      showAct('act-3', 2);
      schedule(function () {
        show('squig-3');
        show('squig-3b');
        show('tip-3');
      }, 800);
    }, 7500);

    // Act 4: typed catch
    schedule(function () {
      showAct('act-4', 3);
      schedule(function () {
        show('hint-4');
        show('pulse-4');
      }, 500);
    }, 11500);

    // Loop
    schedule(function () { runDemoLoop(); }, 15500);
  }

  function jumpTo(index) {
    clearAllTimers();
    var acts = ['act-1', 'act-2', 'act-3', 'act-4'];
    showAct(acts[index], index);

    // Show the decorations for this act after a beat
    schedule(function () {
      if (index === 0) { show('squig-1'); show('tip-1'); }
      if (index === 2) { show('squig-3'); show('squig-3b'); show('tip-3'); }
      if (index === 1) { show('pulse-2'); }
      if (index === 3) { show('hint-4'); show('pulse-4'); }
    }, 400);

    // Resume auto-play after a long pause
    schedule(function () { runDemoLoop(); }, 8000);
  }

  window.restartDemo = function () {
    clearAllTimers();
    runDemoLoop();
  };

  // Init
  var editor = buildEditor();
  if (editor) runDemoLoop();
})();
