// Browser half of the dsh-vision-bridge plugin: paste-to-path.
//
// A capture-phase paste listener runs before the composer's own handler.
// When the clipboard carries image files, the default intake (attachment ->
// host image admission -> "model does not support images" for text-only
// models) is suppressed; the bytes go to the plugin's host route
// (POST /vision-bridge/paste), land as a private temp file, and the returned
// path is inserted into the composer as plain text. A text-only model then
// sees a file path, which is also the read_image tool's primary trigger.
//
// When the current model is a "(vision bridge)" wrapped entry (or a real
// vision model), the paste is left alone: the wrapped entry converts pastes
// at request time with the thumbnail preserved, and real vision models read
// images natively.
//
// Hand-written in the lazy-CJS bundle protocol (window.__ModuleLoader__.load
// with a factory returning cordis-plugin exports), so no build step and no
// imports from dsh client packages — the same zero-dependency stance as the
// host half. The registered id MUST be the package name (@omdp/dsh-vision-bridge):
// dsh-client-modules rejects any bundle whose __ModuleLoader__.load id does
// not match the package it was loaded for.
window.__ModuleLoader__.load({
  id: '@omdp/dsh-vision-bridge',
  factory: () => {
    var module = { exports: {} }
    var exports = module.exports

    function imageFilesOf(event) {
      var items = event.clipboardData && event.clipboardData.items
      if (!items) return []
      var files = []
      for (var i = 0; i < items.length; i++) {
        var item = items[i]
        if (item.kind !== 'file') continue
        var file = item.getAsFile()
        if (file && /^image\//.test(file.type)) files.push(file)
      }
      return files
    }

    function insertText(target, text) {
      var el =
        target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')
          ? target
          : document.activeElement
      if (!el || (el.tagName !== 'TEXTAREA' && el.tagName !== 'INPUT')) return
      el.focus()
      var inserted = false
      try {
        inserted = document.execCommand('insertText', false, text)
      } catch {
        inserted = false
      }
      if (!inserted) {
        var proto =
          el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
        var setter = Object.getOwnPropertyDescriptor(proto, 'value').set
        setter.call(el, el.value + text)
        el.dispatchEvent(new Event('input', { bubbles: true }))
      }
    }

    function uploadOne(file) {
      return file.arrayBuffer().then((buffer) =>
        fetch('/vision-bridge/paste', { method: 'POST', body: buffer }).then((res) => {
          if (!res.ok) {
            return res
              .json()
              .catch(() => ({}))
              .then((body) => {
                throw new Error(body.error || 'paste upload failed (' + res.status + ')')
              })
          }
          return res.json()
        }),
      )
    }

    // The takeover is for text-only models: the (vision bridge) variants
    // convert pastes at request time with the thumbnail preserved, and real
    // vision models read images natively — both keep the original paste UX.
    // Keep explicit aliases as a fast path while the host capability lookup
    // is still in flight. Boundaries are important: DSV4F must not match DSV4FV.
    var VISION_HINT = /\(vision bridge\)|dsv4fv\b|deepseek-v4-flash-vision(?:-exp)?\b|deepseek-(vl|ocr)|janus|glm-[\d.]*v\b|agnes-|sensenova/i
    var TEXT_HINT = /\bdsv4f\b|deepseek-v4-flash(?![-\s]?vision)/i

    // 真实多模态能力缓存：key = 归一化后的模型标签，value = { known, multimodal }。
    // 由 host 的 /vision-bridge/capabilities 用 llm.resolveModelInfo 判定。
    // pending 与 known:false 必须区分：能力查询尚未完成时不能贸然拦截原生图片事件。
    var capabilityCache = Object.create(null)
    var capabilityPending = Object.create(null)
    var lastModelLabel = ''
    var modelButton = null
    var modelCheckTimer = null
    var modelObserver = null
    var modelButtonObserver = null

    function normalizeLabel(label) {
      return String(label || '').toLowerCase().replace(/[^a-z0-9]+/g, '')
    }

    function isModelButtonLabel(label) {
      return /选择模型|select model|current model/i.test(String(label || ''))
    }

    function disconnectObserver(observer) {
      if (observer) observer.disconnect()
      return null
    }

    function findModelButton() {
      if (modelButton && modelButton.isConnected) {
        var cachedLabel = modelButton.getAttribute('aria-label') || ''
        if (isModelButtonLabel(cachedLabel)) return modelButton
        modelButton = null
        modelButtonObserver = disconnectObserver(modelButtonObserver)
      }
      var buttons = document.querySelectorAll('button[aria-label]')
      for (var i = 0; i < buttons.length; i++) {
        var label = buttons[i].getAttribute('aria-label') || ''
        if (isModelButtonLabel(label)) return buttons[i]
      }
      return null
    }

    function currentModelLabel() {
      var button = findModelButton()
      return button ? button.getAttribute('aria-label') || '' : ''
    }

    function fetchCapabilities(label) {
      var norm = normalizeLabel(label)
      if (!norm || capabilityCache[norm] || capabilityPending[norm]) return
      capabilityPending[norm] = true
      fetch('/vision-bridge/capabilities?label=' + encodeURIComponent(label))
        .then(function (r) { return r.ok ? r.json() : null })
        .then(function (body) {
          if (body) capabilityCache[norm] = { known: !!body.known, multimodal: !!body.multimodal }
        })
        .catch(function () {})
        .then(function () { delete capabilityPending[norm] })
    }

    function checkModel() {
      var button = findModelButton()
      if (button !== modelButton) {
        modelButtonObserver = disconnectObserver(modelButtonObserver)
        modelButton = button
        if (button && typeof MutationObserver === 'function') {
          modelButtonObserver = new MutationObserver(function () { queueModelCheck() })
          modelButtonObserver.observe(button, {
            attributes: true,
            attributeFilter: ['aria-label'],
            characterData: true,
            subtree: true,
          })
        }
      }
      var label = button ? button.getAttribute('aria-label') || '' : ''
      if (!label) {
        lastModelLabel = ''
        return
      }
      if (label !== lastModelLabel) {
        lastModelLabel = label
        fetchCapabilities(label)
      }
    }

    function queueModelCheck() {
      if (modelCheckTimer !== null) return
      modelCheckTimer = setTimeout(function () {
        modelCheckTimer = null
        checkModel()
      }, 0)
    }

    function nodeHasModelButton(node) {
      if (!node || node.nodeType !== 1) return false
      if (node.matches && node.matches('button[aria-label]') && isModelButtonLabel(node.getAttribute('aria-label'))) return true
      if (!node.querySelectorAll) return false
      var buttons = node.querySelectorAll('button[aria-label]')
      for (var i = 0; i < buttons.length; i++) {
        if (isModelButtonLabel(buttons[i].getAttribute('aria-label'))) return true
      }
      return false
    }

    function modelButtonWasRemoved(node) {
      return node === modelButton || !!(node && node.contains && modelButton && node.contains(modelButton))
    }

    function onModelMutations(records) {
      for (var i = 0; i < records.length; i++) {
        var record = records[i]
        for (var j = 0; j < record.addedNodes.length; j++) {
          if (nodeHasModelButton(record.addedNodes[j])) {
            queueModelCheck()
            return
          }
        }
        for (var k = 0; k < record.removedNodes.length; k++) {
          if (modelButtonWasRemoved(record.removedNodes[k])) {
            modelButton = null
            modelButtonObserver = disconnectObserver(modelButtonObserver)
            queueModelCheck()
            return
          }
        }
      }
    }

    function onModelClick(event) {
      var target = event.target
      var button = target && target.closest ? target.closest('button[aria-label]') : null
      if (button && isModelButtonLabel(button.getAttribute('aria-label'))) queueModelCheck()
    }

    // native = leave DSH's original image path untouched
    // bridge = text model, convert the image to a temporary path
    // pending = capability lookup has not completed; fail open to native handling
    function imageDecision(label) {
      if (VISION_HINT.test(label)) return 'native'
      if (TEXT_HINT.test(label)) return 'bridge'
      var cap = capabilityCache[normalizeLabel(label)]
      if (!cap || !cap.known) return 'pending'
      return cap.multimodal ? 'native' : 'bridge'
    }

    function onPaste(event) {
      var files = imageFilesOf(event)
      if (files.length === 0) return
      var label = currentModelLabel()
      var decision = imageDecision(label)
      if (decision !== 'bridge') {
        // native and pending both fail open: never block DSH's own image path
        // while a capability lookup is incomplete or unavailable.
        if (decision === 'pending') fetchCapabilities(label)
        return
      }
      event.preventDefault()
      event.stopImmediatePropagation()
      var target = event.target
      Promise.all(files.map(uploadOne))
        .then((results) => {
          var text = results
            .map((r) => r.path)
            .filter(Boolean)
            .join(' ')
          if (text) insertText(target, text + ' ')
        })
        .catch((error) => {
          console.error('[dsh-vision-bridge] paste-to-path failed: ' + (error && error.message ? error.message : error))
        })
    }


    function filesOfDataTransfer(dt) {
      var files = []
      if (dt && dt.items) {
        for (var i = 0; i < dt.items.length; i++) {
          var item = dt.items[i]
          if (item.kind !== 'file') continue
          var file = item.getAsFile && item.getAsFile()
          if (file && /^image\//.test(file.type)) files.push(file)
        }
      }
      if (files.length === 0 && dt && dt.files) {
        for (var j = 0; j < dt.files.length; j++) {
          var dataFile = dt.files[j]
          if (/^image\//.test(dataFile.type)) files.push(dataFile)
        }
      }
      return files
    }

    // Let the file-drop plugin synchronously clear its overlay/depth state,
    // but give it an empty payload so it does not insert the same image path.
    // The marker prevents this synthetic event from re-entering onDrop.
    function resetFileDropOverlay() {
      try {
        var reset = new Event('drop', { bubbles: true, cancelable: true })
        Object.defineProperty(reset, 'dataTransfer', {
          configurable: true,
          value: { types: ['Files'], items: [], files: [], getData: function () { return '' } },
        })
        Object.defineProperty(reset, '__dshVisionBridgeReset', { value: true })
        document.dispatchEvent(reset)
      } catch (error) {
        console.warn('[dsh-vision-bridge] drop overlay reset failed: ' + (error && error.message ? error.message : error))
      }
    }

    function onDrop(event) {
      if (event.__dshVisionBridgeReset) return
      var files = filesOfDataTransfer(event.dataTransfer)
      if (files.length === 0) return
      var label = currentModelLabel()
      var decision = imageDecision(label)
      if (decision !== 'bridge') {
        if (decision === 'pending') fetchCapabilities(label)
        return
      }
      resetFileDropOverlay()
      event.preventDefault()
      event.stopImmediatePropagation()
      var target = event.target
      Promise.all(files.map(uploadOne))
        .then(function (results) {
          var text = results.map(function (r) { return r.path }).filter(Boolean).join(' ')
          if (text) insertText(target, text + ' ')
        })
        .catch(function (error) {
          console.error('[dsh-vision-bridge] drop-to-path failed: ' + (error && error.message ? error.message : error))
        })
    }

    function apply(ctx) {
      document.addEventListener('paste', onPaste, true)
      document.addEventListener('drop', onDrop, true)
      document.addEventListener('click', onModelClick, true)
      checkModel() // 初始检查一次；后续仅在模型按钮相关 DOM 变化时检查
      if (typeof MutationObserver === 'function') {
        modelObserver = new MutationObserver(onModelMutations)
        modelObserver.observe(document.documentElement || document, {
          subtree: true,
          childList: true,
          attributes: true,
          attributeFilter: ['aria-label'],
        })
      }
      if (typeof ctx.effect === 'function') {
        ctx.effect(() => () => {
          document.removeEventListener('paste', onPaste, true)
          document.removeEventListener('drop', onDrop, true)
          document.removeEventListener('click', onModelClick, true)
          if (modelCheckTimer !== null) clearTimeout(modelCheckTimer)
          modelCheckTimer = null
          if (modelObserver) modelObserver.disconnect()
          modelObserver = null
        }, 'dsh-vision-bridge: paste/drop/model observer')
      }
    }

    exports.apply = apply
    exports.inject = []
    return module.exports
  },
})
