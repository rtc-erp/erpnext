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

// Column-head row for list/report skeletons: checkbox dot + varied label bars,
// matching the real list header that leads every result set.
function head_row_html(cols) {
	let head = `<div class="nu-skel-row nu-skel-row-head"><span class="nu-skel nu-skel-dot"></span>`;
	for (let i = 0; i < cols; i++) {
		head += `<span class="nu-skel nu-skel-bar" style="width:${12 + ((i * 9) % 3) * 4}%"></span>`;
	}
	return head + `</div>`;
}

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
	// Real forms open with a tab strip above the sections — include it so the
	// skeleton's outline matches what arrives.
	const tabs = `<div class="nu-skel-tabs">
		<span class="nu-skel nu-skel-bar" style="width:58px"></span>
		<span class="nu-skel nu-skel-bar" style="width:74px"></span>
		<span class="nu-skel nu-skel-bar" style="width:50px"></span>
		<span class="nu-skel nu-skel-bar" style="width:66px"></span>
	</div>`;
	return (
		`<div class="nu-skel-form-inner">` +
		tabs +
		section(field(38) + field(52) + field(44) + field(60) + field(35) + field(48)) +
		section(field(45) + field(40) + field(55) + field(36) + field(50) + field(42)) +
		`</div>`
	);
}

function report_html(cols) {
	return `<div class="nu-skel-report-inner">${head_row_html(cols || 5)}${rows_html(9)}</div>`;
}

const BUILDERS = {
	rows: (opts = {}) => head_row_html(4) + rows_html(opts.count || 9),
	kanban: kanban_html,
	calendar: calendar_html,
	form: form_html,
	report: (opts = {}) => report_html(opts.cols),
};

// ---------------------------------------------------------------------------
// Skeleton layer mount/dismiss
// ---------------------------------------------------------------------------

// Mount a skeleton layer into $host. Always an overlay: full inset when the
// host has height (stale data underneath); pinned to the top with a fixed
// height when the host is short/empty. NEVER in-flow — an in-flow skeleton
// pushes later-rendered content down and its removal snaps it back up (the
// 400px form/report jump). Returns the layer (empty $() on failure).
function mount_skeleton($host, kind, opts) {
	if (!$host || !$host.length) return $();
	$host.find(".nu-skel-layer").remove();
	const build = BUILDERS[kind] || BUILDERS.rows;
	const $layer = $(`<div class="nu-skel-layer nu-skel-${kind}">${build(opts)}</div>`);
	if ($host.css("position") === "static") $host.css("position", "relative");
	// An inset-sized layer in a sub-120px host would collapse to nothing —
	// clip it to a fixed height pinned at the host's top instead.
	if ($host.height() < 120) $layer.addClass("nu-skel-clip");
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

// Per-instance skeleton handle: arms a delayed show, cancels+dismisses on
// settle. Each arm gets a sequence number so stale arms/settles can't act out
// of order (the late-skeleton fix):
//   - if a skeleton is ALREADY UP when re-armed (a second refresh/form-load
//     for the same load), keep it — dismissing it and re-delaying read as a
//     blink; the next settle drops it. One load = one continuous skeleton.
//   - when the arm timer fires, bail if that arm was already settled: the
//     data beat the show-delay, so mounting now would flash a skeleton over
//     loaded content.
// Returns the arm's sequence number; pass it to settle_skeleton so a stale
// refresh resolving late can't drop a newer load's skeleton.
function arm_skeleton(store, show) {
	clearTimeout(store.__nu_skel_timer);
	clearTimeout(store.__nu_skel_failsafe);
	store.__nu_arm_seq = (store.__nu_arm_seq || 0) + 1;
	const seq = store.__nu_arm_seq;
	if (store.__nu_skel && store.__nu_skel.parent().length) {
		// Skeleton already visible — keep it, just extend the failsafe.
		store.__nu_skel_failsafe = setTimeout(() => settle_skeleton(store), 8000);
		return seq;
	}
	store.__nu_skel = null;
	store.__nu_skel_timer = setTimeout(() => {
		store.__nu_skel_timer = null;
		if (store.__nu_settled_seq === seq) return; // data beat the show-delay
		store.__nu_skel = show() || null;
		if (store.__nu_skel) {
			// Failsafe: never leave a skeleton stuck on screen.
			store.__nu_skel_failsafe = setTimeout(() => settle_skeleton(store), 8000);
		}
	}, SHOW_DELAY);
	return seq;
}

function settle_skeleton(store, seq) {
	if (seq != null && seq !== store.__nu_arm_seq) return; // a newer load owns it
	store.__nu_settled_seq = store.__nu_arm_seq;
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

// Dismiss the first-load skeleton (2b), if one is mounted, and cancel a
// pending deferred mount. Must run on BOTH skeleton exits: on a fast link the
// refresh promise settles before the 140ms arm fires, so the arm callback
// alone is not enough (the first-load skeleton would otherwise stay over the
// rendered rows until its failsafe).
function settle_first_skeleton(view) {
	clearTimeout(view.__nu_first_timer);
	view.__nu_first_timer = null;
	if (!view.__nu_first_skel) return;
	clearTimeout(view.__nu_first_failsafe);
	dismiss_skeleton(view.__nu_first_skel);
	view.__nu_first_skel = null;
}

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
		const seq = arm_skeleton(view, () => {
			// Adopt the first-load skeleton (2b) instead of dismissing it and
			// mounting a second one elsewhere: the old dismiss+remount swapped
			// skeleton geometry mid-load, which read as a blink. One continuous
			// skeleton from navigation to data.
			if (view.__nu_first_skel && view.__nu_first_skel.parent().length) {
				const adopted = view.__nu_first_skel;
				view.__nu_first_skel = null;
				clearTimeout(view.__nu_first_failsafe);
				return adopted;
			}
			const $host =
				view.$result && view.$result.length ? view.$result : view.$frappe_list;
			if (!$host || !$host.is(":visible")) return null;
			// Match the real row count (capped) so the overlay doesn't stretch
			// far past a short list into empty space.
			const count = Math.min(Math.max(view.page_length || 20, 3), 10);
			return mount_skeleton($host, kind, { count });
		});

		Promise.resolve(result)
			.catch(() => {})
			.then(() => {
				settle_skeleton(view, seq);
				settle_first_skeleton(view);
				// Rows re-render on every refresh; the entry cascade is a
				// first-render delight only — replaying it on each refresh /
				// realtime update read as blinking. CSS gates on .nu-rendered.
				if (view.$frappe_list) view.$frappe_list.addClass("nu-rendered");
			});
		return result;
	};
}

// 2b. List-family FIRST load: stock's show_skeleton covers the meta-fetch
//     window with two bare boxes, then hides it — leaving an empty shell
//     until BaseList.refresh arms our skeleton (~2s of near-blank page on a
//     slow link). Replace stock's skeleton with the nu rows skeleton so the
//     page is covered from navigation to data. Repeat visits are untouched:
//     init is cached and the refresh patch overlays stale rows instead.
//     The mount is deferred by SHOW_DELAY like every other skeleton: on a
//     fast link the data beats the delay and settle_first_skeleton cancels
//     the timer — an instant first load must not flash a skeleton over
//     content that is already there.
//     CRITICAL: stock show_skeleton hides .layout-main and hide_skeleton
//     un-hides it — we never hide it, but keep the un-hide in hide_skeleton.
function patch_listview_first_load() {
	const proto = frappe.views.ListView && frappe.views.ListView.prototype;
	if (!proto || !mark_patched(proto)) return;

	proto.show_skeleton = function () {
		if (this.init_promise) return; // repeat visit — stale rows stay visible
		clearTimeout(this.__nu_first_timer);
		this.__nu_first_timer = setTimeout(() => {
			this.__nu_first_timer = null;
			const $area =
				this.parent &&
				this.parent.page &&
				this.parent.page.container.find(".page-content");
			if (!$area || !$area.length || !$area.is(":visible")) return;
			const name = this.view_name || "List";
			const kind = name === "Kanban" ? "kanban" : name === "Calendar" ? "calendar" : "rows";
			const $layer = mount_skeleton($area, kind);
			if (!$layer || !$layer.length) return;
			// The host is empty at this point, so mount_skeleton clipped the
			// layer to a fixed height pinned at the top (nu-skel-clip). Tag it
			// as the first-load skeleton: the refresh patch adopts it as its
			// own (patch_list_skeletons) — coverage stays continuous with no
			// dismiss/remount blink at the handoff.
			$layer.removeClass("nu-skel-clip").addClass("nu-skel-first");
			this.__nu_first_skel = $layer;
			clearTimeout(this.__nu_first_failsafe);
			this.__nu_first_failsafe = setTimeout(() => {
				this.__nu_first_skel && this.__nu_first_skel.remove();
				this.__nu_first_skel = null;
			}, 8000);
		}, SHOW_DELAY);
	};

	proto.hide_skeleton = function () {
		// Deliberately does NOT remove the early skeleton: with meta cached,
		// the meta window is milliseconds and the real wait is init→refresh.
		// The refresh patch adopts it as its own skeleton (or dismisses it on
		// settle). Stock semantics — never drop this (the codex-editor incident).
		this.parent.page.container.find(".layout-main").show();
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

// 4. Query reports: skeleton from the moment the route lands (stock shows a
//    fully blank page for the first ~2-4s of report/settings roundtrips) and
//    a report-shaped skeleton in place of the stock "Loading…" message once
//    the data call starts; crossfade away when data lands.
function patch_query_report_skeletons() {
	const proto = frappe.views.QueryReport && frappe.views.QueryReport.prototype;
	if (!proto || !mark_patched(proto)) return;

	// Early skeleton: cover the blank window between navigation and refresh.
	// Only when a report will actually (re)load — revisiting the same report
	// preserves state and renders instantly, so no skeleton there.
	const orig_show = proto.show;
	proto.show = function () {
		const route = frappe.get_route();
		const will_load =
			route[0] === "query-report" &&
			route[1] &&
			(!this.init_promise || this.report_name !== route[1] || frappe.has_route_options());
		if (will_load) {
			arm_skeleton(this, () => {
				const $area = $(this.parent).find(".page-content");
				if (!$area.length || !$area.is(":visible")) return null;
				return mount_skeleton($area, "report");
			});
		}
		return orig_show.apply(this, arguments);
	};

	proto.show_loading_screen = function () {
		// Failsafe: if the report call fails (4xx/5xx), stock never calls
		// hide_loading_screen (the refresh promise's callback only fires on
		// success) — don't leave an opaque skeleton over the page. Polls:
		// while requests are genuinely in flight (slow reports) it re-arms;
		// once the network settles without a success it dismisses quickly
		// instead of leaving the skeleton up for seconds after the failure.
		const arm_failsafe = () => {
			clearTimeout(this.__nu_loading_failsafe);
			this.__nu_loading_failsafe = setTimeout(() => {
				if (frappe.request && frappe.request.ajax_count > 0) {
					arm_failsafe();
				} else {
					this.hide_loading_screen();
				}
			}, 1500);
		};
		arm_failsafe();
		// The early skeleton (if one is up) IS the loading screen — keep it
		// until hide_loading_screen settles it. The old handover dismissed it
		// and mounted a second skeleton in $loading: two shapes swapping
		// position mid-load, which read as a blink (and the in-flow mount
		// jumped the page). One load = one continuous skeleton.
		if (this.__nu_skel && this.__nu_skel.parent().length) return;
		settle_skeleton(this);
		const cols =
			this.columns && this.columns.length
				? Math.min(Math.max(this.columns.length, 4), 8)
				: 5;
		this.$loading
			.html(`<div class="nu-skel-layer nu-skel-static nu-skel-report">${report_html(cols)}</div>`)
			.show();
	};

	proto.hide_loading_screen = function () {
		clearTimeout(this.__nu_loading_failsafe);
		this.__nu_loading_failsafe = null;
		settle_skeleton(this); // drops an adopted early skeleton, if any
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
	const orig_create = proto.create_page_skeleton;

	// Stock mounts the skeleton unconditionally — even on cached page
	// switches, where create+remove happen in the same task and the entry/exit
	// animations fight into a full-strength ghost flash over already-rendered
	// content. Skip it when the page's data is already local (mirrors stock's
	// own cache check; __nu_showing is stamped by the show_page serialization).
	proto.create_page_skeleton = function () {
		if (this.__nu_showing && this.pages && this.pages[this.__nu_showing.name]) return;
		return orig_create.call(this);
	};

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
				this.__nu_showing = next; // read by the skeleton cache-skip
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
				this.__nu_last_render = Date.now(); // watchdog grace stamp
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
			// Grace window: a block swap can be mid-flight (del/add gap) on a
			// cached, ajax-quiet switch — never rebuild during/just after a
			// render, it would re-mount the skeleton and blink.
			if (ws.__nu_last_render && Date.now() - ws.__nu_last_render < 3000) return;

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
	patch_listview_first_load();
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
