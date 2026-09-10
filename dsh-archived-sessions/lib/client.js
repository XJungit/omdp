window.__ModuleLoader__.load({
  id: "@muwinds/dsh-archived-sessions",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    let react = require("react");

    // ---------- styles ----------
    var STYLE_ID = "dsw-arch-style";
    var CSS =
      ".dsw-arch-page{font-size:13px;padding:2px 2px 24px;}" +
      ".dsw-arch-toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px;}" +
      ".dsw-arch-page-title{font-weight:600;color:var(--dsw-alias-label-primary);}" +
      ".dsw-arch-meta{color:var(--dsw-alias-label-secondary);font-size:12px;}" +
      ".dsw-arch-btn{background:transparent;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);border-radius:6px;padding:3px 7px;font-size:12px;cursor:pointer;margin-right:4px;white-space:nowrap;}" +
      ".dsw-arch-btn:hover:not(:disabled){border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);}" +
      ".dsw-arch-btn-danger{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary);}" +
      ".dsw-arch-btn:disabled{opacity:0.45;cursor:default;}" +
      ".dsw-arch-table{width:100%;border-collapse:collapse;table-layout:fixed;}" +
      ".dsw-arch-table th{text-align:left;font-weight:600;color:var(--dsw-alias-label-secondary);font-size:12px;padding:6px 8px;border-bottom:1px solid var(--dsw-alias-border-l1);}" +
      ".dsw-arch-table td{padding:8px 8px;border-bottom:1px solid var(--dsw-alias-border-l1);vertical-align:top;}" +
      ".dsw-arch-table tr:last-child td{border-bottom:none;}" +
      ".dsw-arch-table th:nth-child(1),.dsw-arch-table td:nth-child(1){width:32px;text-align:center;padding-left:2px;padding-right:2px;}" +
      ".dsw-arch-table th:nth-child(2),.dsw-arch-table td:nth-child(2){width:auto;}" +
      ".dsw-arch-table th:nth-child(3),.dsw-arch-table td:nth-child(3){width:104px;}" +
      ".dsw-arch-table th:nth-child(4),.dsw-arch-table td:nth-child(4){width:92px;padding-left:2px;padding-right:2px;}" +
      ".dsw-arch-size{white-space:nowrap;}" +
      ".dsw-arch-actions{white-space:nowrap;}" +
      ".dsw-arch-title-click{cursor:pointer;color:var(--dsw-alias-label-primary);}" +
      ".dsw-arch-title-click:hover{text-decoration:underline;}" +
      ".dsw-arch-id,.dsw-arch-path{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px;color:var(--dsw-alias-label-secondary);word-break:break-all;margin-top:2px;}" +
      ".dsw-arch-selectbar{display:flex;align-items:center;gap:8px;padding:6px 10px;margin-bottom:10px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;font-size:12px;flex-wrap:wrap;}" +
      ".dsw-arch-selectbar .dsw-arch-meta{flex:1;}" +
      ".dsw-arch-detail{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:10px 12px;font-size:12px;text-align:left;}" +
      ".dsw-arch-detail-head{margin-bottom:8px;}" +
      ".dsw-arch-detail-body{max-height:360px;overflow:auto;}" +
      ".dsw-arch-msg{margin-bottom:8px;white-space:pre-wrap;word-break:break-word;}" +
      ".dsw-arch-msg-role{display:inline-block;font-weight:600;margin-right:6px;}" +
      ".dsw-arch-msg-user .dsw-arch-msg-role{color:var(--dsw-alias-label-primary);}" +
      ".dsw-arch-msg-assistant .dsw-arch-msg-role{color:var(--dsw-alias-brand-primary);}" +
      ".dsw-arch-msg-tool .dsw-arch-msg-role{color:var(--dsw-alias-state-warn-primary);}" +
      ".dsw-arch-msg-time{color:var(--dsw-alias-label-secondary);font-size:11px;margin-left:6px;}" +
      ".dsw-arch-detail-note{color:var(--dsw-alias-label-secondary);font-size:11px;margin-bottom:8px;}" +
      ".dsw-arch-error{color:var(--dsw-alias-state-error-primary);font-size:12px;margin-bottom:8px;}" +
      ".dsw-arch-empty{color:var(--dsw-alias-label-secondary);padding:28px 0;text-align:center;}" +
      ".dsw-arch-badge{display:inline-block;border:1px solid var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-state-warn-primary);border-radius:4px;padding:1px 6px;font-size:11px;}";

    function ensureStyle() {
      try {
        if (document.getElementById(STYLE_ID)) return;
        var el = document.createElement("style");
        el.id = STYLE_ID;
        el.textContent = CSS;
        document.head.appendChild(el);
      } catch (e) {
        // ignore
      }
    }

    // ---------- api ----------
    function api(action, args) {
      return fetch("/dsh-archived/" + action, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(args || {})
      }).then(function (res) {
        return res.json().catch(function () {
          return null;
        });
      }).then(function (payload) {
        if (payload === null || typeof payload !== "object") {
          var err = new Error("请求失败：服务返回了无效响应");
          throw err;
        }
        if (payload.error) {
          var e2 = new Error(String(payload.error));
          throw e2;
        }
        return payload;
      });
    }

    // ---------- page component ----------
    function ArchivedSessionsPage() {
      var _useState = react.useState(true);
      var loading = _useState[0];
      var setLoading = _useState[1];
      var _useState2 = react.useState(null);
      var error = _useState2[0];
      var setError = _useState2[1];
      var _useState3 = react.useState([]);
      var items = _useState3[0];
      var setItems = _useState3[1];
      var _useState4 = react.useState(0);
      var total = _useState4[0];
      var setTotal = _useState4[1];
      var _useState5 = react.useState(null);
      var busy = _useState5[0];
      var setBusy = _useState5[1];
      var _useState6 = react.useState(null);
      var confirmId = _useState6[0];
      var setConfirmId = _useState6[1];
      var _useState7 = react.useState([]);
      var selected = _useState7[0];
      var setSelected = _useState7[1];
      var _useState8 = react.useState(null);
      var batchBusy = _useState8[0];
      var setBatchBusy = _useState8[1];
      var _useState9 = react.useState(null);
      var batchConfirm = _useState9[0];
      var setBatchConfirm = _useState9[1];
      var _useState10 = react.useState(null);
      var expandedId = _useState10[0];
      var setExpandedId = _useState10[1];
      var _useState11 = react.useState(null);
      var detail = _useState11[0];
      var setDetail = _useState11[1];
      var _useState12 = react.useState([]);
      var orphans = _useState12[0];
      var setOrphans = _useState12[1];
      var _useState13 = react.useState(false);
      var showOrphans = _useState13[0];
      var setShowOrphans = _useState13[1];
      var _useState14 = react.useState(null);
      var orphanBusy = _useState14[0];
      var setOrphanBusy = _useState14[1];
      var _useState15 = react.useState(false);
      var confirmSweep = _useState15[0];
      var setConfirmSweep = _useState15[1];

      function describe(err) {
        if (err === null || err === undefined) return String(err);
        if (typeof err === "object" && typeof err.message === "string") return err.message;
        return String(err);
      }

      function applyList(res) {
        var next = res && Array.isArray(res.items) ? res.items : [];
        setItems(next);
        setTotal(res && typeof res.totalBytes === "number" ? res.totalBytes : 0);
        var ids = {};
        for (var i = 0; i < next.length; i++) ids[next[i].id] = true;
        setSelected(function (sel) {
          return sel.filter(function (id) { return ids[id]; });
        });
        if (expandedId && !ids[expandedId]) {
          setExpandedId(null);
          setDetail(null);
        }
      }

      function load() {
        setLoading(true);
        setError(null);
        api("list", {}).then(function (res) {
          applyList(res);
          setLoading(false);
        }).catch(function (err) {
          setError(describe(err));
          setLoading(false);
        });
      }

      react.useEffect(function () {
        load();
      }, []);

      function refreshViews() {
        try {
          if (ctx.workspaces && typeof ctx.workspaces.refresh === "function") {
            var p = ctx.workspaces.refresh();
            if (p && typeof p.catch === "function") p.catch(function () {});
          }
        } catch (e) {
          // ignore
        }
        try {
          if (ctx.sessions && typeof ctx.sessions.refresh === "function") {
            var p2 = ctx.sessions.refresh();
            if (p2 && typeof p2.catch === "function") p2.catch(function () {});
          }
        } catch (e) {
          // ignore
        }
      }

      function reloadAfterAction() {
        refreshViews();
        return api("list", {}).then(applyList);
      }

      // ---- orphan management ----
      function loadOrphans() {
        setShowOrphans(true);
        setOrphanBusy("load");
        setError(null);
        api("orphans", {}).then(function (res) {
          setOrphans(res && Array.isArray(res.items) ? res.items : []);
          setOrphanBusy(null);
        }).catch(function (err) {
          setError(describe(err));
          setOrphanBusy(null);
        });
      }

      function sweepOrphans() {
        setOrphanBusy("sweep");
        setError(null);
        api("sweep", {}).then(function (res) {
          setConfirmSweep(false);
          setOrphans([]);
          setOrphanBusy(null);
          refreshViews();
          return api("list", {}).then(applyList);
        }).catch(function (err) {
          setError(describe(err));
          setOrphanBusy(null);
        });
      }

      // ---- row operations ----
      function unarchive(id) {
        setBusy("unarchive:" + id);
        setError(null);
        api("unarchive", { sessionId: id })
          .then(function () { return reloadAfterAction(); })
          .catch(function (err) { setError(describe(err)); })
          .finally(function () { setBusy(null); });
      }

      // Single-button two-step delete: 删除 -> 确认 (auto-reverts after 5s).
      function armDelete(id) {
        setConfirmId(id);
        try {
          if (ctx.timer && typeof ctx.timer.timeout === "function") {
            ctx.timer.timeout(function () {
              setConfirmId(function (cur) { return cur === id ? null : cur; });
            }, 5000);
          }
        } catch (e) {
          // timer unavailable; stay armed until the user acts
        }
      }

      function doDelete(id) {
        setBusy("delete:" + id);
        setError(null);
        api("delete", { sessionId: id })
          .then(function () { return reloadAfterAction(); })
          .catch(function (err) { setError(describe(err)); })
          .finally(function () {
            setBusy(null);
            setConfirmId(null);
          });
      }

      // ---- selection ----
      function toggleSelect(id) {
        setSelected(function (sel) {
          return sel.includes(id) ? sel.filter(function (x) { return x !== id; }) : sel.concat([id]);
        });
      }

      function toggleSelectAll() {
        setSelected(function (sel) {
          return sel.length === items.length ? [] : items.map(function (item) { return item.id; });
        });
      }

      // ---- batch operations ----
      function runBatch(ids, kind) {
        setBatchBusy(kind);
        setError(null);
        var results = [];
        var cursor = Promise.resolve();
        var method = kind === "delete" ? "delete" : "unarchive";
        for (var i = 0; i < ids.length; i++) {
          (function (id) {
            cursor = cursor.then(function () {
              return api(method, { sessionId: id })
                .then(function () { results.push({ id: id, ok: true }); })
                .catch(function (err) { results.push({ id: id, ok: false, error: describe(err) }); });
            });
          })(ids[i]);
        }
        cursor.then(function () {
          var failed = results.filter(function (r) { return !r.ok; });
          if (failed.length > 0) {
            setError((kind === "delete" ? "删除" : "释放") + "失败 " + failed.length + " 个会话：" + failed.map(function (f) { return f.id; }).join(", "));
          }
          refreshViews();
          return api("list", {});
        }).then(applyList)
          .catch(function (err) { setError(describe(err)); })
          .finally(function () {
            setBatchBusy(null);
            setBatchConfirm(null);
            setSelected([]);
            setConfirmId(null);
          });
      }

      function releaseAll() { runBatch(items.map(function (item) { return item.id; }), "unarchive"); }
      function clearAll() { runBatch(items.map(function (item) { return item.id; }), "delete"); }
      function releaseSelected() { runBatch(selected, "unarchive"); }
      function deleteSelected() { runBatch(selected, "delete"); }

      // ---- detail ----
      function toggleDetail(id) {
        if (expandedId === id) {
          setExpandedId(null);
          setDetail(null);
          return;
        }
        setExpandedId(id);
        setDetail({ id: id, loading: true, data: null, error: null });
        api("detail", { sessionId: id }).then(function (data) {
          setDetail({ id: id, loading: false, data: data, error: null });
        }).catch(function (err) {
          setDetail({ id: id, loading: false, data: null, error: describe(err) });
        });
      }

      function detailCell() {
        if (!detail) return null;
        if (detail.loading) {
          return react.createElement("div", { className: "dsw-arch-detail" }, "加载会话内容中…");
        }
        if (detail.error) {
          return react.createElement("div", { className: "dsw-arch-detail" }, String(detail.error));
        }
        var d = detail.data;
        if (!d || !Array.isArray(d.messages)) {
          return react.createElement("div", { className: "dsw-arch-detail" }, "没有可显示的内容");
        }
        var headParts = [];
        if (d.createdAt) headParts.push("创建于 " + fmtTime(d.createdAt));
        if (d.cwd) headParts.push(d.cwd);
        var headEl = react.createElement("div", { className: "dsw-arch-detail-head" },
          react.createElement("span", { className: "dsw-arch-page-title" }, "会话内容"),
          react.createElement("span", { className: "dsw-arch-meta" }, " · " + headParts.join(" · "))
        );
        var noteEl = react.createElement("div", { className: "dsw-arch-detail-note" },
          "共 " + String(d.totalEvents) + " 条事件，提取 " + String(d.messageCount) + " 条消息" + (d.truncated ? "（仅显示前 100 条）" : "")
        );
        var msgs = d.messages.map(function (m) {
          var roleLabel = m.role === "user" ? "用户" : m.role === "assistant" ? "助手" : "工具";
          return react.createElement("div", { className: "dsw-arch-msg dsw-arch-msg-" + m.role },
            react.createElement("span", { className: "dsw-arch-msg-role" }, roleLabel),
            react.createElement("span", { className: "dsw-arch-msg-time" }, fmtTime(m.time)),
            react.createElement("div", null, m.text)
          );
        });
        return react.createElement("div", { className: "dsw-arch-detail" }, headEl, noteEl,
          react.createElement("div", { className: "dsw-arch-detail-body" }, msgs)
        );
      }

      // ---- formatting ----
      function fmtSize(bytes) {
        var n = Number(bytes) || 0;
        if (n <= 0) return "0 B";
        var units = ["B", "KB", "MB", "GB", "TB"];
        var v = n;
        var i = 0;
        while (v >= 1024 && i < units.length - 1) {
          v = v / 1024;
          i = i + 1;
        }
        return (i === 0 ? String(Math.round(v)) : v.toFixed(1)) + " " + units[i];
      }

      function fmtTime(ms) {
        if (!ms) return "—";
        try {
          return new Date(ms).toLocaleString();
        } catch (e) {
          return String(ms);
        }
      }

      var anyBusy = busy !== null || batchBusy !== null;

      var header = react.createElement("div", { className: "dsw-arch-toolbar" },
        react.createElement("span", { className: "dsw-arch-page-title" }, "归档会话"),
        react.createElement("span", { className: "dsw-arch-meta" },
          String(items.length) + " 个会话 · 共 " + fmtSize(total) + (loading ? " · 加载中…" : "") + (batchBusy ? " · 批量操作中…" : "")),
        react.createElement("button", { className: "dsw-arch-btn", disabled: anyBusy, onClick: function () { load(); } }, "刷新"),
        react.createElement("button", { className: "dsw-arch-btn", disabled: anyBusy || items.length === 0, onClick: function () { releaseAll(); } }, "一键释放"),
        react.createElement("button", { className: "dsw-arch-btn dsw-arch-btn-danger", disabled: anyBusy || items.length === 0, onClick: function () { setBatchConfirm("clear"); } }, "一键清空"),
        react.createElement("button", { className: "dsw-arch-btn", disabled: anyBusy, onClick: function () { loadOrphans(); } }, showOrphans ? "隐藏孤儿" : "孤儿清理")
      );

      var confirmBar = null;
      if (batchConfirm === "clear") {
        confirmBar = react.createElement("div", { className: "dsw-arch-selectbar" },
          react.createElement("span", { className: "dsw-arch-meta", style: { color: "var(--dsw-alias-state-warn-primary)" } }, "确认清空全部 " + String(items.length) + " 个归档会话？此操作会从硬盘删除（含各自的子会话）且不可恢复。"),
          react.createElement("button", { className: "dsw-arch-btn dsw-arch-btn-danger", disabled: anyBusy, onClick: function () { clearAll(); } }, "确认清空"),
          react.createElement("button", { className: "dsw-arch-btn", disabled: anyBusy, onClick: function () { setBatchConfirm(null); } }, "取消")
        );
      } else if (batchConfirm === "delete") {
        confirmBar = react.createElement("div", { className: "dsw-arch-selectbar" },
          react.createElement("span", { className: "dsw-arch-meta", style: { color: "var(--dsw-alias-state-warn-primary)" } }, "确认删除选中的 " + String(selected.length) + " 个会话（含各自的子会话）？此操作不可恢复。"),
          react.createElement("button", { className: "dsw-arch-btn dsw-arch-btn-danger", disabled: anyBusy, onClick: function () { deleteSelected(); } }, "确认删除"),
          react.createElement("button", { className: "dsw-arch-btn", disabled: anyBusy, onClick: function () { setBatchConfirm(null); } }, "取消")
        );
      } else if (selected.length > 0) {
        confirmBar = react.createElement("div", { className: "dsw-arch-selectbar" },
          react.createElement("span", { className: "dsw-arch-meta" }, "已选择 " + String(selected.length) + " 个会话"),
          react.createElement("button", { className: "dsw-arch-btn", disabled: anyBusy, onClick: function () { releaseSelected(); } }, "释放选中"),
          react.createElement("button", { className: "dsw-arch-btn dsw-arch-btn-danger", disabled: anyBusy, onClick: function () { setBatchConfirm("delete"); } }, "删除选中"),
          react.createElement("button", { className: "dsw-arch-btn", disabled: anyBusy, onClick: function () { setSelected([]); } }, "取消选择")
        );
      }

      var body;
      if (loading && items.length === 0) {
        body = react.createElement("div", { className: "dsw-arch-empty" }, "加载中…");
      } else if (items.length === 0) {
        body = react.createElement("div", { className: "dsw-arch-empty" }, "没有已归档的会话");
      } else {
        var allSelected = selected.length === items.length;
        var childCount = {};
        for (var ci = 0; ci < items.length; ci++) {
          var p = items[ci].parentSession;
          if (p) childCount[p] = (childCount[p] || 0) + 1;
        }
        var rows = [];
        for (var i = 0; i < items.length; i++) {
          (function (item) {
            var isBusy = busy === "unarchive:" + item.id || busy === "delete:" + item.id;
            var confirming = confirmId === item.id;
            var metaParts = [];
            if (item.createdAt) metaParts.push("创建于 " + fmtTime(item.createdAt));
            if (item.cwd) metaParts.push(item.cwd);
            var kids = childCount[item.id] || 0;
            if (kids > 0) metaParts.push("含 " + String(kids) + " 个子会话");

            var checkEl = react.createElement("input", {
              type: "checkbox",
              checked: selected.includes(item.id),
              disabled: anyBusy,
              onChange: function () { toggleSelect(item.id); }
            });

            var chevron = expandedId === item.id ? "▾ " : "▸ ";
            var titleEl = react.createElement("div", {
              className: "dsw-arch-title-click",
              title: "点击查看会话内容",
              onClick: function () { toggleDetail(item.id); }
            }, chevron + (item.title || "(无标题)"));
            var idEl = react.createElement("div", { className: "dsw-arch-id" }, item.id);
            var metaEl = react.createElement("div", { className: "dsw-arch-meta" }, metaParts.join(" · "));
            var pathEl = item.path
              ? react.createElement("div", { className: "dsw-arch-path" }, item.path)
              : null;
            var sizeEl = item.missing
              ? react.createElement("span", { className: "dsw-arch-badge" }, "文件缺失")
              : react.createElement("span", { className: "dsw-arch-size" }, fmtSize(item.sizeBytes));

            var unarchiveBtn = react.createElement("button", {
              className: "dsw-arch-btn",
              disabled: anyBusy || item.missing,
              onClick: function () { unarchive(item.id); }
            }, "释放");

            var deleteBtn = react.createElement("button", {
              className: "dsw-arch-btn dsw-arch-btn-danger",
              disabled: anyBusy,
              title: confirming ? "再次点击确认删除（5 秒后自动取消）" : "删除（需再次点击确认）",
              onClick: function () { confirming ? doDelete(item.id) : armDelete(item.id); }
            }, confirming ? "确认" : "删除");

            rows.push(react.createElement("tr", { key: item.id },
              react.createElement("td", null, checkEl),
              react.createElement("td", null, titleEl, idEl, metaEl, pathEl),
              react.createElement("td", null, sizeEl),
              react.createElement("td", { className: "dsw-arch-actions" }, unarchiveBtn, deleteBtn)
            ));

            if (expandedId === item.id) {
              rows.push(react.createElement("tr", { key: item.id + "-detail" },
                react.createElement("td", { colSpan: 4, style: { padding: "4px 10px 10px" } }, detailCell())
              ));
            }
          })(items[i]);
        }

        var headCheck = react.createElement("input", {
          type: "checkbox",
          checked: allSelected,
          disabled: anyBusy,
          onChange: function () { toggleSelectAll(); }
        });

        body = react.createElement("table", { className: "dsw-arch-table" },
          react.createElement("thead", null,
            react.createElement("tr", null,
              react.createElement("th", null, headCheck),
              react.createElement("th", null, "会话"),
              react.createElement("th", null, "磁盘占用"),
              react.createElement("th", null, "操作")
            )
          ),
          react.createElement("tbody", null, rows)
        );
      }

      var errorEl = error
        ? react.createElement("div", { className: "dsw-arch-error" }, String(error))
        : null;

      var orphanPanel = null;
      if (showOrphans) {
        var orphanRows = orphans.map(function (o) {
          return react.createElement("tr", { key: o.id },
            react.createElement("td", null,
              react.createElement("div", { className: "dsw-arch-title-click" }, o.id),
              react.createElement("div", { className: "dsw-arch-id" }, "父会话: " + o.parentSession + (o.cwd ? " · " + o.cwd : ""))
            ),
            react.createElement("td", null, o.missing
              ? react.createElement("span", { className: "dsw-arch-badge" }, "文件缺失")
              : react.createElement("span", { className: "dsw-arch-size" }, fmtSize(o.sizeBytes)))
          );
        });
        var orphanTotal = 0;
        for (var oi = 0; oi < orphans.length; oi++) orphanTotal += orphans[oi].sizeBytes || 0;
        var sweepBtn;
        if (confirmSweep) {
          sweepBtn = react.createElement("button", { className: "dsw-arch-btn dsw-arch-btn-danger", disabled: orphanBusy !== null, onClick: function () { sweepOrphans(); } }, "确认清理 " + String(orphans.length) + " 个孤儿会话"),
            react.createElement("button", { className: "dsw-arch-btn", disabled: orphanBusy !== null, onClick: function () { setConfirmSweep(false); } }, "取消");
        } else {
          sweepBtn = react.createElement("button", { className: "dsw-arch-btn dsw-arch-btn-danger", disabled: orphanBusy !== null || orphans.length === 0, onClick: function () { setConfirmSweep(true); } }, "清理孤儿会话");
        }
        orphanPanel = react.createElement("div", { className: "dsw-arch-selectbar", style: { marginTop: "10px", display: "block" } },
          react.createElement("div", { className: "dsw-arch-meta", style: { marginBottom: "6px" } },
            "孤儿会话 " + String(orphans.length) + " 个 · 共 " + fmtSize(orphanTotal) +
            (orphanBusy === "load" ? " · 加载中…" : "") + (orphanBusy === "sweep" ? " · 清理中…" : "")),
          react.createElement("div", null, sweepBtn),
          orphanRows.length > 0
            ? react.createElement("table", { className: "dsw-arch-table", style: { marginTop: "8px" } },
                react.createElement("thead", null,
                  react.createElement("tr", null,
                    react.createElement("th", null, "孤儿会话（父会话已删除）"),
                    react.createElement("th", null, "磁盘占用"))),
                react.createElement("tbody", null, orphanRows))
            : (orphanBusy === "load" ? null : react.createElement("div", { className: "dsw-arch-empty" }, "没有孤儿会话"))
        );
      }

      return react.createElement("div", { className: "dsw-arch-page" }, errorEl, header, confirmBar, body, orphanPanel);
    }

    // ---------- plugin body ----------
    var inject = ["slots", "workspaces", "sessions", "timer"];

    function apply(ctx) {
      ensureStyle();
      ctx.effect(function () {
        return function () {
          try {
            var el = document.getElementById(STYLE_ID);
            if (el) el.remove();
          } catch (e) {
            // ignore
          }
        };
      }, "ui-archived-sessions: style cleanup");

      ctx.slots.inject("settings.section", function () {
        return ctx.slots.register(
          { name: "settings.section", id: "archived-sessions", order: 30, label: function () { return "归档会话"; } },
          function () { return react.createElement(ArchivedSessionsPage); }
        );
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
