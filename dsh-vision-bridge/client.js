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
// host half.
window.__ModuleLoader__.load({
  id: 'dsh-vision-bridge',
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

    function onPaste(event) {
      var files = imageFilesOf(event)
      if (files.length === 0) return
      if (VISION_HINT.test(currentModelLabel())) return
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
      if (VISION_HINT.test(currentModelLabel())) return
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
      if (typeof ctx.effect === 'function') {
        ctx.effect(() => () => { document.removeEventListener('paste', onPaste, true); document.removeEventListener('drop', onDrop, true) }, 'dsh-vision-bridge: paste/drop-to-path listener')
      }
    }

    exports.apply = apply
    exports.inject = []
    return module.exports
  },
})
