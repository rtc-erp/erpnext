// NU-ERP motion system — page transitions, route progress, skeleton loading.
//
// Everything here is additive chrome: stock classes keep running, we only wrap
// their lifecycle methods to overlay motion. The frappe fork stays untouched;
// all patches live on prototypes at erpnext-bundle time and are idempotent.
//
// Layers:
//   1. Page transitions — pure CSS enter animation on every page swap
//      (nu_ui.scss, section 19). Deliberately no JS in the swap path.
//   2. Route bar — thin accent progress line for the async window between
//      "route changed" and "new page painted with its data".
//   3. Skeletons — shimmer placeholders while data is in flight:
//      list-family views (List/Report/Kanban/Calendar/Gantt/…), forms,
//      query reports, workspaces. Entry is a quick fade; exit is a crossfade
//      so the skeleton reads as morphing into the real content.
//
// Reduced-motion users get everything near-instant via the global
// prefers-reduced-motion rule in nu_ui.scss.

const SHOW_DELAY = 140; // ms a fetch must take before a skeleton appears
const OUT_MS = 240; // skeleton crossfade-out duration (keep > CSS transition)

function reduced_motion() {
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Guard flag for idempotent patching. Must be an OWN property: QueryReport
// and other classes extend BaseList, so an inherited flag would fool a plain
// `proto.__nu_motion` check into skipping the patch.
function mark_patched(proto) {
	if (Object.prototype.hasOwnProperty.call(proto, "__nu_motion")) return false;
	proto.__nu_motion = true;
	return true;
}

// ---------------------------------------------------------------------------
// Skeleton DOM builders
// ---------------------------------------------------------------------------

function rows_html(count) {
	let rows = "";
	for (let i = 0; i < count; i++) {
		// Varied bar widths so the placeholder reads as real table structure.
		const w1 = 22 + ((i * 13) % 4) * 7;
		const w2 = 14 + ((i * 7) % 3) * 6;
		const w3 = 9 + ((i * 5) % 3) * 5;
		rows += `<div class="nu-skel-row">
			<span class="nu-skel nu-skel-dot"></span>
			<span class="nu-skel nu-skel-bar" style="width:${w1}%"></span>
			<span class="nu-skel nu-skel-bar" style="width:${w2}%"></span>
			<span class="nu-skel nu-skel-bar hidden-xs" style="width:${w3}%"></span>
			<span class="nu-skel nu-skel-pill"></span>
		</div>`;
	}
	return rows;
}

function kanban_html() {
	let cols = "";
	for (let c = 0; c < 3; c++) {
		let cards = "";
		for (let k = 0; k < 3 - (c % 2); k++) {
			cards += `<div class="nu-skel-card">
				<span class="nu-skel nu-skel-bar" style="width:${55 + ((c + k) * 11) % 30}%"></span>
				<span class="nu-skel nu-skel-bar" style="width:${30 + ((c + k) * 17) % 25}%"></span>
			</div>`;
		}
		cols += `<div class="nu-skel-col">
			<span class="nu-skel nu-skel-pill"></span>${cards}
		</div>`;
	}
	return `<div class="nu-skel-kanban-inner">${cols}</div>`;
}

function calendar_html() {
	let cells = "";
	for (let i = 0; i < 35; i++) {
		cells += `<div class="nu-skel-cell">${i % 3 === 0 ? '<span class="nu-skel nu-skel-bar" style="width:60%"></span>' : ""}</div>`;
	}
	return `<div class="nu-skel-calendar-inner">${cells}</div>`;
}

function form_html() {
	const field = (w) => `<div class="nu-skel-field">
		<span class="nu-skel nu-skel-bar" style="width:${w}%"></span>
		<span class="nu-skel nu-skel-input"></span>
	</div>`;
	const section = (fields) => `<div class="nu-skel-section">${fields}</div>`;
	return (
		`<div class="nu-skel-form-inner">` +
		section(field(38) + field(52) + field(44) + field(60) + field(35) + field(48)) +
		section(field(45) + field(40) + field(55)) +
		`</div>`
	);
}

function report_html() {
	let head = `<div class="nu-skel-row nu-skel-row-head">`;
	for (let i = 0; i < 5; i++) {
		head += `<span class="nu-skel nu-skel-bar" style="width:${12 + ((i * 9) % 3) * 4}%"></span>`;
	}
	head += `</div>`;
	return `<div class="nu-skel-report-inner">${head}${rows_html(9)}</div>`;
}

const BUILDERS = {
	rows: () => rows_html(9),
	kanban: kanban_html,
	calendar: calendar_html,
	form: form_html,
	report: report_html,
};

// ---------------------------------------------------------------------------
// Skeleton layer mount/dismiss
// ---------------------------------------------------------------------------

// Mount a skeleton layer into $host. Overlays existing content when the host
// already has height (stale data underneath); sits in-flow when the host is
// empty so it gives the area height. Returns the layer (empty $() on failure).
function mount_skeleton($host, kind) {
	if (!$host || !$host.length) return $();
	$host.find(".nu-skel-layer").remove();
	const build = BUILDERS[kind] || BUILDERS.rows;
	const $layer = $(`<div class="nu-skel-layer nu-skel-${kind}">${build()}</div>`);
	if ($host.height() < 120) {
		$layer.addClass("nu-skel-static");
	} else if ($host.css("position") === "static") {
		$host.css("position", "relative");
	}
	$host.prepend($layer);
	return $layer;
}

// Crossfade the skeleton out, then remove it. Safe on already-removed layers.
function dismiss_skeleton($layer) {
	if (!$layer || !$layer.length || !$layer.parent().length) return;
	if ($layer.data("nu-out")) return;
	$layer.data("nu-out", true);
	$layer.addClass("nu-skel-out");
	setTimeout(() => $layer.remove(), OUT_MS);
}

// Per-instance skeleton handle: arms a delayed show, cancels+dismisses on settle.
function arm_skeleton(store, show) {
	clearTimeout(store.__nu_skel_timer);
	clearTimeout(store.__nu_skel_failsafe);
	dismiss_skeleton(store.__nu_skel);
	store.__nu_skel = null;
	store.__nu_skel_timer = setTimeout(() => {
		store.__nu_skel_timer = null;
		store.__nu_skel = show() || null;
		if (store.__nu_skel) {
			// Failsafe: never leave a skeleton stuck on screen.
			store.__nu_skel_failsafe = setTimeout(() => settle_skeleton(store), 8000);
		}
	}, SHOW_DELAY);
}

function settle_skeleton(store) {
	clearTimeout(store.__nu_skel_timer);
	clearTimeout(store.__nu_skel_failsafe);
	store.__nu_skel_timer = null;
	store.__nu_skel_failsafe = null;
	dismiss_skeleton(store.__nu_skel);
	store.__nu_skel = null;
}

// ---------------------------------------------------------------------------
// Route progress bar
// ---------------------------------------------------------------------------

class NURouteBar {
	constructor() {
		this.$bar = null;
		this._show_timer = null;
		this._done_timer = null;
	}

	ensure() {
		if (!this.$bar) {
			this.$bar = $('<div class="nu-route-bar"><div class="nu-route-bar-inner"></div></div>');
			$("body").append(this.$bar);
		}
		return this.$bar;
	}

	start() {
		if (reduced_motion()) return;
		clearTimeout(this._show_timer);
		clearTimeout(this._done_timer);
		// Don't flash the bar for instant (cached) route changes.
		this._show_timer = setTimeout(() => {
			this._show_timer = null;
			this.ensure().removeClass("nu-done").addClass("nu-active");
		}, 160);
	}

	done() {
		clearTimeout(this._show_timer);
		this._show_timer = null;
		if (!this.$bar || !this.$bar.hasClass("nu-active")) return;
		clearTimeout(this._done_timer);
		this.$bar.addClass("nu-done");
		this._done_timer = setTimeout(() => {
			this.$bar && this.$bar.removeClass("nu-active nu-done");
		}, 350);
	}
}

// ---------------------------------------------------------------------------
// Patches
// ---------------------------------------------------------------------------

// NOTE: page transitions are CSS-only (nu_ui.scss §19 — the enter animation
// restarts whenever a page flips display none→block). An earlier version also
// wrapped Container.change_to to delay the swap for an exit fade, but that
// 90ms deferral broke stock's invariant "after change_to returns, the page is
// visible" — views that render synchronously after the call (workspaces with
// cached data, forms) rendered into a still-hidden container and could blank
// the page. Never defer the swap again; keep motion out of the timing path.

// 2. List-family views (List, Report, Kanban, Calendar, Gantt, Dashboard,
//    Image, Map): skeleton while the data call is in flight — on first load
//    and on every refresh (filters, sort, paging, realtime).
function patch_list_skeletons() {
	const proto = frappe.views.BaseList && frappe.views.BaseList.prototype;
	if (!proto || !mark_patched(proto)) return;
	const orig_refresh = proto.refresh;

	proto.refresh = function () {
		const view = this;
		let result;
		try {
			result = orig_refresh.apply(view, arguments);
		} catch (e) {
			throw e;
		}

		const name = view.view_name || "List";
		const kind = name === "Kanban" ? "kanban" : name === "Calendar" ? "calendar" : "rows";
		arm_skeleton(view, () => {
			const $host =
				view.$result && view.$result.length ? view.$result : view.$frappe_list;
			if (!$host || !$host.is(":visible")) return null;
			return mount_skeleton($host, kind);
		});

		Promise.resolve(result)
			.catch(() => {})
			.then(() => settle_skeleton(view));
		return result;
	};
}

// 3. Forms: skeleton over the layout area while the doc renders. Covers first
//    loads (form-load fires when the doc arrives) and switching docs inside an
//    already-open form.
function patch_form_skeletons() {
	const proto = frappe.ui.form.Form && frappe.ui.form.Form.prototype;
	if (!proto || !mark_patched(proto)) return;

	const arm = (frm) => {
		arm_skeleton(frm, () => {
			if (!frm.$wrapper || !frm.$wrapper.is(":visible")) return null;
			const $host = frm.$wrapper.find(".layout-main-section").first();
			return mount_skeleton($host.length ? $host : frm.$wrapper, "form");
		});
	};

	// Doc arrived, rendering begins.
	$(document).on("form-load", (e, frm) => frm && arm(frm));

	// Switching to another doc inside an open form.
	const orig_refresh = proto.refresh;
	proto.refresh = function (docname) {
		if (docname && docname !== this.docname) arm(this);
		return orig_refresh.apply(this, arguments);
	};

	// Rendering finished — crossfade the skeleton into the real form.
	const orig_render_form = proto.render_form;
	proto.render_form = function () {
		const out = orig_render_form.apply(this, arguments);
		setTimeout(() => settle_skeleton(this), 60);
		return out;
	};
}

// 4. Query reports: replace the "Loading…" message with a report-shaped
//    skeleton; crossfade it away when data lands.
function patch_query_report_skeletons() {
	const proto = frappe.views.QueryReport && frappe.views.QueryReport.prototype;
	if (!proto || !mark_patched(proto)) return;

	proto.show_loading_screen = function () {
		this.$loading
			.html(`<div class="nu-skel-layer nu-skel-static nu-skel-report">${report_html()}</div>`)
			.show();
		// Failsafe: if the report call fails (4xx/5xx), stock never calls
		// hide_loading_screen (the refresh promise's callback only fires on
		// success) — don't leave an opaque skeleton over the page. Re-arms
		// while requests are genuinely still in flight (slow reports).
		const arm_failsafe = () => {
			clearTimeout(this.__nu_loading_failsafe);
			this.__nu_loading_failsafe = setTimeout(() => {
				if (frappe.request && frappe.request.ajax_count > 0) {
					arm_failsafe();
				} else {
					this.hide_loading_screen();
				}
			}, 8000);
		};
		arm_failsafe();
	};

	proto.hide_loading_screen = function () {
		clearTimeout(this.__nu_loading_failsafe);
		this.__nu_loading_failsafe = null;
		const $loading = this.$loading;
		if (!$loading || !$loading.is(":visible")) return;
		const $layer = $loading.find(".nu-skel-layer");
		if ($layer.length) {
			dismiss_skeleton($layer);
			setTimeout(() => $loading.hide(), OUT_MS);
		} else {
			$loading.hide();
		}
	};
}

// 5. Workspaces: stock skeleton stays, but it now shimmers (CSS) and fades
//    out instead of vanishing. CRITICAL: create_page_skeleton() hides
//    .codex-editor via addClass("hidden") and stock remove_page_skeleton()
//    un-hides it — any override must keep that un-hide, or every workspace
//    past the first renders invisibly (the blank-page incident).
function patch_workspace_skeletons() {
	const proto = frappe.views.Workspace && frappe.views.Workspace.prototype;
	if (!proto || !mark_patched(proto)) return;
	const orig_remove = proto.remove_page_skeleton;

	proto.remove_page_skeleton = function () {
		const $skel = this.body && this.body.find(".workspace-skeleton");
		if (!$skel || !$skel.length) return orig_remove.call(this);
		this.body.find(".codex-editor").removeClass("hidden"); // stock un-hide — never drop this
		$skel.addClass("nu-skel-out");
		setTimeout(() => $skel.remove(), OUT_MS);
	};
}

// 6. Workspace navigation race (root cause of intermittent blank workspaces
//    on live): stock show_page is re-entrant and editor.render is
//    fire-and-forget behind editor.isReady, both sharing mutable state
//    (this.content / this.page_data / this._page). Overlapping runs produce
//    partial, wrong, or empty renders — and because this._page is set before
//    rendering, the early-return in show() then keeps the broken page until
//    refresh. Two guards:
//    a) serialize show_page (latest request wins; failures clear _page so a
//       retry can recover instead of sticking);
//    b) serialize editor.render (a render never starts during another, and a
//       superseded render is skipped).
function patch_workspace_race() {
	const proto = frappe.views.Workspace && frappe.views.Workspace.prototype;
	if (!proto || !mark_patched(proto)) return;

	const orig_show_page = proto.show_page;
	proto.show_page = function (page) {
		this.__nu_pending_page = page;
		if (this.__nu_show_busy) return this.__nu_show_promise || Promise.resolve();
		this.__nu_show_busy = true;
		this.__nu_show_promise = (async () => {
			while (this.__nu_pending_page) {
				const next = this.__nu_pending_page;
				this.__nu_pending_page = null;
				try {
					await orig_show_page.call(this, next);
				} catch (e) {
					console.warn("nu_motion: workspace show_page failed, recovering", e);
					this._page = null; // don't trap the early-return guard
					try {
						this.remove_page_skeleton();
					} catch (_) {}
				}
			}
			this.__nu_show_busy = false;
		})();
		return this.__nu_show_promise;
	};

	const orig_init = proto.initialize_editorjs;
	proto.initialize_editorjs = function (blocks) {
		const out = orig_init.apply(this, arguments);
		if (this.editor && !this.editor.__nu_serialized) {
			this.editor.__nu_serialized = true;
			const orig_render = this.editor.render.bind(this.editor);
			let chain = Promise.resolve();
			let latest = null;
			this.editor.render = (data) => {
				latest = data;
				const p = chain.then(() => {
					if (latest !== data) return; // superseded by a newer render
					return orig_render(data);
				});
				chain = p.catch(() => {});
				return p;
			};
		}
		return out;
	};
}

// 7. Self-heal watchdog: after any page change settles, if the visible
//    workspace page ended up empty — either no rendered blocks, or the
//    editor's DOM node itself is gone (stock can never recover from that:
//    EditorJS keeps rendering into a detached node) — rebuild it, recreating
//    the editor instance when needed. Safety net for blank-workspace failure
//    modes: the page repairs itself instead of needing a manual refresh.
function arm_workspace_watchdog() {
	let attempts = 0;
	$(document).on("page-change", () => {
		attempts = 0;
		const check = () => {
			const ws = frappe.workspace;
			const route = frappe.get_route_str();
			if (!ws || !ws.body || !/^(Workspaces|private\/)/.test(route)) return;
			const $page = $('.page-container[data-page-route="Workspaces"]');
			if (!$page.length || $page.css("display") === "none") return;

			const $editorjs = ws.body.find("#editorjs");
			const blocks = $editorjs.find(".ce-block").length;
			const codex = $editorjs.find(".codex-editor").length;
			const codex_hidden = $editorjs.find(".codex-editor.hidden").length > 0;
			const skeletons = ws.body.find(".workspace-skeleton").length;
			const loading = frappe.request && frappe.request.ajax_count > 0;
			if (skeletons > 0 || loading || attempts >= 2 || !ws._page) return;

			// A hidden editor is a stuck blank page even with blocks in the
			// DOM — strip the class (cheap) rather than rebuilding.
			if (codex_hidden) {
				console.warn("nu_motion: hidden workspace editor detected, unhiding", route);
				$editorjs.find(".codex-editor").removeClass("hidden");
			}

			const rebuild = (fresh_editor) => {
				attempts++;
				console.warn(
					`nu_motion: ${fresh_editor ? "workspace editor DOM missing, recreating" : "empty workspace detected, rebuilding"}`,
					route
				);
				if (fresh_editor) {
					try {
						ws.editor && ws.editor.destroy && ws.editor.destroy();
					} catch (_) {}
					ws.editor = null;
					$editorjs.remove(); // force show_page to recreate it
				}
				const page = ws._page;
				ws._page = null; // bypass the early-return guard
				Promise.resolve(ws.show_page(page)).then(() => setTimeout(check, 1500));
			};

			if (!$editorjs.length || !codex) return rebuild(true);
			if (blocks === 0) return rebuild(false);
		};
		setTimeout(check, 2500);
	});
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

function init_motion() {
	patch_list_skeletons();
	patch_form_skeletons();
	patch_query_report_skeletons();
	patch_workspace_skeletons();
	patch_workspace_race();
	arm_workspace_watchdog();

	const bar = new NURouteBar();

	// frappe.router is created during desk boot, after bundles evaluate.
	let attempts = 0;
	const hook_router = setInterval(() => {
		if (frappe.router && frappe.router.on) {
			clearInterval(hook_router);
			frappe.router.on("change", () => bar.start());
		} else if (++attempts >= 100) {
			clearInterval(hook_router);
		}
	}, 100);
	$(document).on("page-change", () => {
		// Give the new view a beat to fire its data calls, then stop the bar
		// once the network settles (immediately when nothing is in flight).
		setTimeout(() => {
			if (frappe.after_ajax) {
				frappe.after_ajax(() => bar.done());
			} else {
				bar.done();
			}
		}, 250);

		// Failsafe: no skeleton survives a page switch.
		clearTimeout($(document).data("nu-skel-sweep"));
		$(document).data(
			"nu-skel-sweep",
			setTimeout(() => {
				$(".page-container").not(":visible").find(".nu-skel-layer").remove();
			}, 400)
		);
	});
}

export { init_motion };
