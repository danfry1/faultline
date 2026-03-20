/* ── faultline – shared JS ─────────────────────────────────
   Nav hamburger, syntax highlighter, copy buttons, install picker.
   Plain browser JS — no modules, no build step.
   All innerHTML usage processes only hardcoded token sets from static
   string constants defined in this file — never user input.
   ───────────────────────────────────────────────────────── */

// ── Token sets ───────────────────────────────────────────

var codeKeywords = new Set([
  'const', 'let', 'var', 'async', 'await', 'return', 'new', 'throw',
  'if', 'else', 'try', 'catch', 'switch', 'case', 'default', 'break',
  'function', 'import', 'export', 'from', 'type', 'interface', 'extends',
  'typeof', 'readonly', 'as', 'for', 'of', 'in', 'true', 'false',
])

var codeTypes = new Set([
  'Promise', 'Result', 'AppError', 'Infer', 'TaskResult', 'TypedPromise',
  'User', 'string', 'number', 'boolean', 'void', 'never', 'unknown',
  'Record', 'Partial', 'Extract', 'Exclude',
])

var codeFaultline = new Set([
  'defineErrors', 'defineError', 'defineBoundary', 'configureErrors',
  'ok', 'err', 'isOk', 'isErr', 'isErrTag', 'match', 'catchTag',
  'all', 'attempt', 'attemptAsync', 'fromUnknown', 'narrowError',
  'isAppError', 'isErrorTag', 'typedAsync',
  'serializeError', 'deserializeError', 'serializeResult', 'deserializeResult',
  'SystemErrors', 'UserErrors', 'PaymentErrors', 'HttpErrors',
  'ValidationErrors', 'ErrorOutput',
])

// ── Initialization ───────────────────────────────────────

enhanceCodeBlocks()
bindCopyButtons()
setupInstallPicker()

// ── Nav hamburger ────────────────────────────────────────

;(function () {
  var hamburger = document.querySelector('.nav-hamburger')
  var navLinks = document.querySelector('.nav-links')

  if (hamburger && navLinks) {
    hamburger.addEventListener('click', function () {
      var expanded = hamburger.getAttribute('aria-expanded') === 'true'
      hamburger.setAttribute('aria-expanded', String(!expanded))
      navLinks.classList.toggle('open')
    })

    navLinks.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') {
        hamburger.setAttribute('aria-expanded', 'false')
        navLinks.classList.remove('open')
      }
    })
  }
})()

// ── Syntax highlighter ───────────────────────────────────

function enhanceCodeBlocks() {
  var blocks = document.querySelectorAll('.code-block')

  for (var i = 0; i < blocks.length; i++) {
    var block = blocks[i]
    var code = block.querySelector('code')
    if (!code) continue

    var rawCode = normalizeCode(code.textContent || '')
    var showLineNumbers = block.dataset.lineNumbers !== 'false'

    block.dataset.rawCode = rawCode

    if (block.dataset.compact === 'true') {
      block.classList.add('is-compact')
    }

    var fragment = document.createDocumentFragment()
    var lines = rawCode.split('\n')

    for (var j = 0; j < lines.length; j++) {
      var line = lines[j]
      var lineElement = document.createElement('span')
      lineElement.className = 'code-line'

      if (showLineNumbers) {
        var numberElement = document.createElement('span')
        numberElement.className = 'code-line-no'
        numberElement.textContent = String(j + 1)
        lineElement.appendChild(numberElement)
      }

      var contentElement = document.createElement('span')
      contentElement.className = 'code-line-content'
      // highlightTS only processes hardcoded token sets from this file,
      // not user-supplied content, so the resulting HTML is safe to assign.
      contentElement.innerHTML = line.length === 0 ? '&nbsp;' : highlightTS(line)
      lineElement.appendChild(contentElement)
      fragment.appendChild(lineElement)
    }

    code.replaceChildren(fragment)
  }
}

function highlightTS(line) {
  var i = 0
  var html = ''

  while (i < line.length) {
    var ch = line[i]

    // Comments
    if (line[i] === '/' && line[i + 1] === '/') {
      html += wrap(esc(line.slice(i)), 'token-comment')
      break
    }

    // Strings — single, double, backtick
    if (ch === "'" || ch === '"' || ch === '`') {
      var s = readString(line, i, ch)
      html += wrap(esc(s.text), 'token-string')
      i = s.end
      continue
    }

    // Numbers
    if (isDigit(ch)) {
      var n = readWhile(line, i, function (c) { return /[\d_.]/.test(c) })
      html += wrap(esc(n.text), 'token-number')
      i = n.end
      continue
    }

    // Identifiers / keywords / types / faultline API
    if (isIdentStart(ch)) {
      var id = readWhile(line, i, function (c) { return /[\w$]/.test(c) })
      var next = nextNonWS(line, id.end)

      if (codeKeywords.has(id.text)) {
        html += wrap(esc(id.text), 'token-keyword')
      } else if (codeFaultline.has(id.text)) {
        html += wrap(esc(id.text), 'token-faultline')
      } else if (codeTypes.has(id.text)) {
        html += wrap(esc(id.text), 'token-type')
      } else if (next === '(') {
        html += wrap(esc(id.text), 'token-function')
      } else if (next === ':') {
        html += wrap(esc(id.text), 'token-property')
      } else {
        html += esc(id.text)
      }

      i = id.end
      continue
    }

    // Fat arrow
    if (line[i] === '=' && line[i + 1] === '>') {
      html += wrap('=&gt;', 'token-operator')
      i += 2
      continue
    }

    // Punctuation
    if ('{}()[].,;:=<>|&!?+-*/'.indexOf(ch) !== -1) {
      html += wrap(esc(ch), 'token-operator')
      i += 1
      continue
    }

    html += esc(ch)
    i += 1
  }

  return html
}

// ── Highlighter helpers ──────────────────────────────────

function wrap(text, cls) {
  return '<span class="' + cls + '">' + text + '</span>'
}

function esc(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function normalizeCode(text) {
  return text.replace(/^\n+/, '').replace(/\s+$/, '')
}

function readString(text, start, quote) {
  var i = start + 1
  while (i < text.length) {
    if (text[i] === '\\') { i += 2; continue }
    if (text[i] === quote) { i += 1; break }
    i += 1
  }
  return { text: text.slice(start, i), end: i }
}

function readWhile(text, start, pred) {
  var i = start
  while (i < text.length && pred(text[i])) { i += 1 }
  return { text: text.slice(start, i), end: i }
}

function nextNonWS(text, start) {
  var i = start
  while (i < text.length && /\s/.test(text[i])) { i += 1 }
  return text[i] || ''
}

function isDigit(ch) {
  return /\d/.test(ch)
}

function isIdentStart(ch) {
  return /[A-Za-z_$]/.test(ch)
}

// ── Copy buttons ─────────────────────────────────────────

function bindCopyButtons() {
  // Direct text copy — [data-copy] attribute holds the text
  var directButtons = document.querySelectorAll('[data-copy]')
  for (var i = 0; i < directButtons.length; i++) {
    directButtons[i].addEventListener('click', handleDirectCopy)
  }

  // Block copy — [data-copy-block] holds the target element's ID
  var blockButtons = document.querySelectorAll('[data-copy-block]')
  for (var j = 0; j < blockButtons.length; j++) {
    blockButtons[j].addEventListener('click', handleBlockCopy)
  }

  // Code block copy — .code-copy inside a .code-block
  var codeButtons = document.querySelectorAll('.code-copy')
  for (var k = 0; k < codeButtons.length; k++) {
    codeButtons[k].addEventListener('click', handleCodeCopy)
  }
}

function handleDirectCopy() {
  var text = this.getAttribute('data-copy')
  if (text) copyText(this, text)
}

function handleBlockCopy() {
  var targetId = this.getAttribute('data-copy-block')
  if (!targetId) return
  var target = document.getElementById(targetId)
  if (!target) return
  var text = target.dataset.rawCode || target.textContent || ''
  copyText(this, text)
}

function handleCodeCopy() {
  var block = this.closest('.code-block')
  if (!block) return
  var text = block.dataset.rawCode || block.textContent || ''
  copyText(this, text)
}

function copyText(btn, text) {
  var original = btn.textContent

  navigator.clipboard.writeText(text).then(
    function () { btn.textContent = 'Copied!' },
    function () { btn.textContent = 'Copy failed' }
  )

  setTimeout(function () {
    btn.textContent = original
  }, 1500)
}

// ── Install picker ───────────────────────────────────────

function setupInstallPicker() {
  var tabs = document.getElementById('install-tabs')
  var cmdEl = document.getElementById('install-cmd')
  var copyBtn = document.getElementById('install-copy')
  if (!tabs || !cmdEl || !copyBtn) return

  var commands = {
    npm:  'npm install faultline',
    bun:  'bun add faultline',
    pnpm: 'pnpm add faultline',
    yarn: 'yarn add faultline',
  }

  var allTabs = tabs.querySelectorAll('.install-tab')

  for (var i = 0; i < allTabs.length; i++) {
    allTabs[i].addEventListener('click', function () {
      for (var j = 0; j < allTabs.length; j++) {
        allTabs[j].classList.remove('is-active')
      }
      this.classList.add('is-active')

      var pm = this.dataset.pm
      var cmd = commands[pm] || commands.npm
      cmdEl.textContent = cmd
      copyBtn.setAttribute('data-copy', cmd)
    })
  }
}
