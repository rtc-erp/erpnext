// NU-ERP custom desk chrome — orchestrator.
// Owns the top bar + left sidebar and keeps them in sync with the stock
// (hidden) sidebar's own route resolution, so our chrome always shows the
// same workspace sidebar the stock UI would have shown.

import {
	get_sidebars,
	resolved_pinned,
	more_sidebars,
	sidebar_links,
	reports_groups,
	group_items,
} from "./data";
import { NUTopbar } from "./topbar";
import { NUSidebar } from "./sidebar";
import { init_motion } from "./motion";

const LAST_ROUTE_KEY = "nu-chrome-last-routes";

// Page transitions, route progress, and skeleton loading. Independent of the
// chrome boot below — it only patches frappe prototypes, so run it eagerly.
init_motion();

// Hide the stock sidebar before first paint; the class also scopes all our
// layout overrides in nu_chrome.scss.
document.body.classList.add("nu-chrome");

class NUChrome {
	constructor() {
		this.active = null; // { kind: "pinned"|"more"|"virtual"|"raw", key, title, data }
		this.sidebar = new NUSidebar(this);
		this.topbar = new NUTopbar(this);

		frappe.router.on("change", () => {
			// The stock sidebar's own "change" handler was registered during
			// startup (before ours), so frappe.app.sidebar.sidebar_title is
			// already resolved for the new route when we get here.
			this.sync_from_stock();
			// Stock occasionally settles its resolution a beat after the change
			// event (late route_options application, workspace redirects). Every
			// show_* path early-returns when nothing changed, so short delayed
			// re-syncs self-correct a stale read without re-render flapping.
			for (const delay of [150, 600]) {
				setTimeout(() => this.sync_from_stock(), delay);
			}
		});

		// Initial state for the route we booted on. The first workspace render
		// may resolve the sidebar slightly after us, so retry briefly.
		this.sync_from_stock();
		let attempts = 0;
		const initial_sync = setInterval(() => {
			if ((frappe.app.sidebar && frappe.app.sidebar.sidebar_title) || ++attempts >= 50) {
				clearInterval(initial_sync);
				this.sync_from_stock();
			}
		}, 100);
	}

	// -- state -------------------------------------------------------------

	get last_routes() {
		try {
			return JSON.parse(localStorage.getItem(LAST_ROUTE_KEY) || "{}");
		} catch (e) {
			return {};
		}
	}

	remember_route(key, path) {
		if (!key || !path || path === "/desk" || path === "/desk/") return;
		const routes = this.last_routes;
		routes[key] = path;
		localStorage.setItem(LAST_ROUTE_KEY, JSON.stringify(routes));
	}

	// -- sync from the stock sidebar ----------------------------------------

	sync_from_stock() {
		const stock = frappe.app && frappe.app.sidebar;
		const title = stock && stock.sidebar_title;
		if (!title) return;
		const key = title.toLowerCase();

		const pinned = resolved_pinned().find((m) => m.sidebar_key === key);
		if (pinned) {
			// Skip the re-render when the route stayed inside the same sidebar —
			// only the active row changes (handled by sync_active below).
			if (!(this.active && this.active.kind === "pinned" && this.active.key === pinned.key)) {
				this.show_pinned(pinned);
			}
		} else {
			const extra = more_sidebars().find((m) => m.key === key);
			if (extra) {
				// The "More" tab only names a module while the user is inside one
				// they opened through the More card. A stock resolution that lands
				// on an overflow module any other way (awesomebar, deep link, or
				// stock resolving a page to the module its doctype belongs to —
				// e.g. System Settings -> Core) still renders that module's
				// sidebar, but the tab stays plain "More".
				const named = !!(
					this.active &&
					this.active.kind === "more" &&
					this.active.key === extra.key &&
					this.active.named
				);
				this.show_extra(extra, { named });
			} else {
				const data = get_sidebars()[key];
				if (data && !(this.active && this.active.kind === "raw" && this.active.key === key)) {
					this.show_raw(title, data);
				}
			}
		}

		if (
			this.active &&
			(this.active.kind === "pinned" ||
				(this.active.kind === "more" && this.active.named))
		) {
			this.remember_route(this.active.storage_key, this.current_path());
		}
		this.sidebar.sync_active();
	}

	current_path() {
		return decodeURIComponent(window.location.pathname).replace(/\/$/, "");
	}

	// -- rendering ----------------------------------------------------------

	show_pinned(pinned) {
		this.active = {
			kind: "pinned",
			key: pinned.key,
			storage_key: pinned.key,
			title: pinned.label,
			data: pinned.data,
		};
		this.topbar.set_active(pinned.key);
		this.sidebar.show(
			this.active.title,
			pinned.data.header_icon || pinned.icon,
			group_items(pinned.data.items),
			pinned.key
		);
	}

	show_extra(mod, opts) {
		const named = !opts || opts.named !== false;
		const same_module =
			this.active && this.active.kind === "more" && this.active.key === mod.key;
		if (same_module && this.active.named === named) return;

		this.active = {
			kind: "more",
			key: mod.key,
			storage_key: `more:${mod.key}`,
			title: mod.data.label || mod.label,
			data: mod.data,
			named,
		};
		this.topbar.set_active("more", named ? this.active.title : null);
		// A named<->unnamed flip for the same module only relabels the tab —
		// the sidebar content is identical, so re-rendering it would just flap.
		if (!same_module) {
			this.sidebar.show(
				this.active.title,
				mod.data.header_icon,
				group_items(mod.data.items),
				mod.key
			);
		}
	}

	// Sidebars that are neither pinned nor in the More list (e.g. My
	// Workspaces). Rendered as-is with no top tab highlighted.
	show_raw(title, data) {
		this.active = { kind: "raw", key: title.toLowerCase(), title: data.label || title, data };
		this.topbar.set_active(null);
		this.sidebar.show(
			this.active.title,
			data.header_icon,
			group_items(data.items),
			this.active.key
		);
	}

	// -- user actions -------------------------------------------------------

	// Top-bar tab click.
	activate_module(key) {
		const pinned = resolved_pinned().find((m) => m.key === key);
		if (!pinned) return;

		if (pinned.virtual === "reports") {
			// Virtual module: no sidebar of its own, so no stock resolution to
			// mirror — just show every report link grouped by module sidebar.
			// No auto-navigation; the route (and with it the context) changes
			// once the user picks a report.
			this.active = { kind: "virtual", key: "reports", title: __("Reports") };
			this.topbar.set_active("reports");
			this.sidebar.show(__("Reports"), "chart", reports_groups(), "reports");
			return;
		}

		this.show_pinned(pinned);
		this.navigate_home(pinned);
	}

	// More-card module click.
	activate_sidebar_key(key, label) {
		const data = get_sidebars()[key];
		if (!data) return;
		const mod = { key, label: data.label || label, data };
		this.show_extra(mod);
		this.navigate_home({ sidebar_key: key, storage_key: `more:${key}`, data });
	}

	// Navigate to the remembered route for this module, else its first link.
	navigate_home(mod) {
		const storage_key = mod.storage_key || mod.key;
		const remembered = this.last_routes[storage_key];
		const first = sidebar_links(mod.data)[0];
		const target = remembered || (first && first.path);
		if (target && target !== this.current_path()) {
			frappe.set_route(target);
		}
	}
}

function boot_chrome(attempts) {
	if (frappe.app && frappe.app.sidebar && frappe.router && frappe.boot) {
		frappe.nu_chrome = new NUChrome();
	} else if ((attempts || 0) < 100) {
		setTimeout(() => boot_chrome((attempts || 0) + 1), 100);
	} else {
		console.warn("nu_chrome: desk did not start in time; custom chrome disabled.");
	}
}

$(document).ready(() => boot_chrome());
