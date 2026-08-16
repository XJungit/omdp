window.__ModuleLoader__.load({
	id: "dsh-gitbash-win",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		//#region shared helpers
		/** Parse the wire args JSON into an object, or null when it is not an object. */
		function parseArgs(argsRaw) {
			try {
				const parsed = JSON.parse(argsRaw);
				return typeof parsed === "object" && parsed !== null ? parsed : null;
			} catch {
				return null;
			}
		}
		/** Flatten a settled result's content blocks to display text. */
		function resultText(block) {
			const text = (block.content || []).map((item) => item.type === "text" ? item.text : JSON.stringify(item, null, 2)).join("\n");
			if (text !== "") return text;
			return block.error === void 0 ? null : `${block.error.name}: ${block.error.code}`;
		}
		/** Call state from a frozen running-or-settled node. */
		function stateOf(block) {
			if (!("kind" in block)) return "running";
			if (block.error?.code === "interrupted") return "stopped";
			return block.isError ? "error" : "ok";
		}
		const STATE_COLORS = {
			running: "#4b7bec",
			ok: "#2f9e44",
			error: "#e03131",
			stopped: "#e8a50a"
		};
		const STATE_LABELS = {
			running: "运行中",
			ok: "完成",
			error: "失败",
			stopped: "已中断"
		};
		const monoStyle = {
			fontFamily: "var(--ds-font-family-code, ui-monospace, SFMono-Regular, Consolas, monospace)",
			fontSize: "13px",
			lineHeight: "22px",
			whiteSpace: "pre-wrap",
			wordBreak: "break-all",
			margin: 0
		};
		const cardStyle = {
			border: "1px solid var(--dsw-alias-border-l1, #e2e8f0)",
			borderRadius: "8px",
			overflow: "hidden",
			background: "var(--dsw-alias-bg-base, #ffffff)",
			fontSize: "14px",
			color: "var(--dsw-alias-label-primary, #1a1a2e)"
		};
		const rowStyle = {
			display: "flex",
			alignItems: "center",
			gap: "8px",
			padding: "6px 12px",
			minHeight: "24px"
		};
		const blockStyle = {
			background: "var(--dsw-alias-markdown-code-block, #f6f8fa)",
			borderRadius: "6px",
			padding: "8px 10px"
		};
		const blockLabelStyle = {
			fontSize: "11px",
			color: "var(--dsw-alias-label-caption, #999)",
			marginBottom: "4px"
		};
		/** State dot + title + status label + chevron header for a card. */
		function CardHeader({ state, title, expandable, open, onToggle }) {
			return react.createElement("div", {
				onClick: expandable ? onToggle : undefined,
				style: Object.assign({}, rowStyle, expandable ? { cursor: "pointer" } : {})
			},
				react.createElement("span", {
					"aria-hidden": true,
					style: { width: "8px", height: "8px", borderRadius: "50%", background: STATE_COLORS[state] ?? "#aaa", flex: "none" }
				}),
				react.createElement("span", { style: { fontWeight: 600, flex: "none" } }, title),
				react.createElement("span", { style: { fontSize: "12px", color: "var(--dsw-alias-label-tertiary, #888)" } }, STATE_LABELS[state] ?? state),
				react.createElement("span", { style: { flex: 1 } }),
				expandable && react.createElement("span", {
					"aria-hidden": true,
					style: { fontSize: "12px", color: "var(--dsw-alias-label-tertiary, #aaa)", transform: open ? "rotate(180deg)" : "none", transition: "transform .2s" }
				}, "▾")
			);
		}
		//#endregion
		//#region gitbash card
		function GitBashRow(props) {
			const { block } = props;
			const settled = "kind" in block;
			const argsRaw = (settled ? block.call?.argsRaw : block.argsRaw) ?? "";
			const args = parseArgs(argsRaw);
			const command = args === null ? null : (typeof args.command === "string" && args.command !== "" ? args.command : null);
			const description = args === null ? null : (typeof args.description === "string" && args.description !== "" ? args.description : null);
			const state = stateOf(block);
			const output = settled ? resultText(block) : null;
			const [expanded, setExpanded] = react.useState(false);
			const expandable = command !== null || output !== null;
			const open = expanded && expandable;
			const summary = description ?? command ?? "Git Bash";
			return react.createElement("div", { style: cardStyle },
				react.createElement(CardHeader, { state, title: "Git Bash", expandable, open, onToggle: () => setExpanded((v) => !v) }),
				react.createElement("div", {
					style: {
						display: "flex",
						alignItems: "center",
						gap: "8px",
						padding: "0 12px 8px",
						fontSize: "13px",
						color: "var(--dsw-alias-label-secondary, #555)",
						minWidth: 0
					}
				},
					react.createElement("span", { style: { flexShrink: 0, color: "var(--dsw-alias-label-caption, #999)" } }, "命令"),
					react.createElement("code", {
						style: {
							fontFamily: "var(--ds-font-family-code, ui-monospace, SFMono-Regular, Consolas, monospace)",
							fontSize: "13px",
							whiteSpace: "nowrap",
							overflow: "hidden",
							textOverflow: "ellipsis",
							minWidth: 0,
							color: "var(--dsw-alias-label-secondary, #555)"
						}
					}, summary)
				),
				open && react.createElement("div", { style: { padding: "0 12px 12px", display: "flex", flexDirection: "column", gap: "8px" } },
					command !== null && react.createElement("div", { style: blockStyle },
						react.createElement("div", { style: blockLabelStyle }, "命令"),
						react.createElement("pre", { style: monoStyle, children: command })
					),
					output !== null && react.createElement("div", { style: blockStyle },
						react.createElement("div", { style: blockLabelStyle }, "输出"),
						react.createElement("pre", {
							style: Object.assign({}, monoStyle, {
								maxHeight: "224px",
								overflow: "auto",
								color: state === "error" ? "var(--dsw-alias-state-error-primary, #c0392b)" : "var(--dsw-alias-label-primary, #333)"
							}),
							children: output
						})
					)
				)
			);
		}
		//#endregion
		//#region plugin
		const inject = ["slots"];
		function apply(ctx) {
			const slots = ctx.get("slots");
			if (slots === undefined) return;
			slots.inject("tool.call.toolview", function* () {
				yield slots.register({ name: "tool.call.toolview", key: "gitbash" }, GitBashRow);
			});
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
