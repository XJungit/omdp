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
    var VISION_HINT = /\(vision bridge\)|deepseek-(vl|ocr)|janus|glm-[\d.]*v\b|agnes-|sensenova/i

    function currentModelLabel() {
      var buttons = document.querySelectorAll('button[aria-label]')
      for (var i = 0; i < buttons.length; i++) {
        var label = buttons[i].getAttribute('aria-label') || ''
        if (/选择模型|select model|current model/i.test(label)) return label
      }
      return ''
    }

    // 真实多模态能力缓存：key = 归一化后的模型标签，value = { known, multimodal }。
    // 由 host 的 /vision-bridge/capabilities 用 llm.resolveModelInfo 判定，
    // 比名字正则可靠——任意真实多模态模型（名字不在 VISION_HINT）都会走原生上传。
    var capabilityCache = {}
    var lastPolledLabel = ''

    function normalizeLabel(label) {
      return String(label || '').toLowerCase().replace(/\s+/g, '')
    }

    function fetchCapabilities(label) {
      var norm = normalizeLabel(label)
      if (!norm || capabilityCache[norm]) return
      fetch('/vision-bridge/capabilities?label=' + encodeURIComponent(label))
        .then(function (r) { return r.ok ? r.json() : null })
        .then(function (body) {
          if (body) capabilityCache[norm] = { known: !!body.known, multimodal: !!body.multimodal }
        })
        .catch(function () {})
    }

    function pollModel() {
      var label = currentModelLabel()
      if (label && label !== lastPolledLabel) {
        lastPolledLabel = label
        fetchCapabilities(label)
      }
    }

    function modelIsMultimodal(label) {
      var cap = capabilityCache[normalizeLabel(label)]
      // 已知且多模态 -> 原生上传；未知（解析失败）按纯文本兜底，保持现有文本模型行为。
      return !!(cap && cap.known && cap.multimodal)
    }

    function onPaste(event) {
      var files = imageFilesOf(event)
      if (files.length === 0) return
      var label = currentModelLabel()
      if (VISION_HINT.test(label)) return
      if (modelIsMultimodal(label)) return
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
          if (item.kind === 'file') {
            var f = item.getAsFile()
            if (f && /^image\//.test(f.type)) files.push(f)
          }
        }
      }
      if (files.length === 0 && dt && dt.files) {
        for (var j = 0; j < dt.files.length; j++) {
          var df = dt.files[j]
          if (/^image\//.test(df.type)) files.push(df)
        }
      }
      return files
    }

    function onDrop(event) {
      var files = filesOfDataTransfer(event.dataTransfer)
      if (files.length === 0) return
      var label = currentModelLabel()
      if (VISION_HINT.test(label)) return
      if (modelIsMultimodal(label)) return
      event.preventDefault()
      event.stopImmediatePropagation()
      Promise.all(files.map(uploadOne))
        .then(function (results) {
          var text = results.map(function (r) { return r.path }).filter(Boolean).join(' ')
          if (text) insertText(event.target, text + ' ')
        })
        .catch(function (error) {
          console.error('[dsh-vision-bridge] drop-to-path failed: ' + (error && error.message ? error.message : error))
        })
    }
    function apply(ctx) {
      document.addEventListener('paste', onPaste, true)
      document.addEventListener('drop', onDrop, true)
      pollModel() // 立即拉取一次，缩短首次粘贴前的空窗
      var pollTimer = setInterval(pollModel, 1000)
      if (typeof ctx.effect === 'function') {
        ctx.effect(() => () => {
          document.removeEventListener('paste', onPaste, true)
          document.removeEventListener('drop', onDrop, true)
          clearInterval(pollTimer)
        }, 'dsh-vision-bridge: paste/drop-to-path listener')
      }
    }

    exports.apply = apply
    exports.inject = []
    return module.exports
  },
})
