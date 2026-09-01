// NU-ERP custom desk chrome — left menu.
// Renders the active module's sidebar items as collapsible groups (collapsed
// by default), with Settings and Sign out pinned at the bottom. Users can
// pin individual rows; pinned rows surface in a "Pinned" section at the top
// and persist per user via frappe's own user-settings store (no schema or
// erpnext artifacts touched).

import { group_items, item_path } from "./data";

const GROUP_STATE_KEY = "nu-chrome-groups";
const PINS_DOCTYPE = "Workspace";
const PINS_KEY = "nu_chrome_pins";

export class NUSidebar {
	constructor(chrome) {
		this.chrome = chrome;
		this.pins = {};
		this.render_shell();
		this.load_pins();
	}

	load_pins() {
		if (frappe.session.user === "Guest") return;
		frappe.model.user_settings.get(PINS_DOCTYPE).then((settings) => {
			this.pins = (settings && settings[PINS_KEY]) || {};
			// Re-render the current sidebar once pins are known.
			if (this._last) this.show(...this._last);
		}, () => {
			// Pins are an enhancement — keep the sidebar working without them.
		});
	}

	save_pins() {
		frappe.model.user_settings.save(PINS_DOCTYPE, PINS_KEY, this.pins);
	}

	render_shell() {
		this.$root = $(`
			<div class="nu-sidebar">
				<div class="nu-sidebar-head">
					<span class="nu-sidebar-head-icon"></span>
					<span class="nu-sidebar-head-label"></span>
				</div>
				<div class="nu-sidebar-body"></div>
				<div class="nu-sidebar-foot">
					<button class="nu-sidebar-row nu-settings">
						${frappe.utils.icon("setting-gear", "sm")}
						<span>${__("Settings")}</span>
					</button>
					<button class="nu-sidebar-row nu-signout">
						${frappe.utils.icon("logout", "sm")}
						<span>${__("Sign out")}</span>
					</button>
				</div>
			</div>
		`);
		this.$root.prependTo("body");
		this.$overlay = $('<div class="nu-sidebar-overlay"></div>').appendTo("body");
		this.$overlay.on("click", () => this.close_drawer());

		this.$root.find(".nu-settings").on("click", () => {
			this.close_drawer();
			this.chrome.activate_module("settings");
		});
		this.$root.find(".nu-signout").on("click", () => frappe.app.logout());
	}

	close_drawer() {
		document.body.classList.remove("nu-sidebar-open");
	}

	get_group_state() {
		try {
			return JSON.parse(localStorage.getItem(GROUP_STATE_KEY) || "{}");
		} catch (e) {
			return {};
		}
	}

	save_group_state(state) {
		localStorage.setItem(GROUP_STATE_KEY, JSON.stringify(state));
	}

	// groups: [{ label, items }] from data.group_items or data.reports_groups
	show(title, icon, groups, state_key) {
		this._last = [title, icon, groups, state_key];
		this.state_key = state_key || title.toLowerCase();
		this.$root.find(".nu-sidebar-head-icon").html(icon ? frappe.utils.icon(icon, "md") : "");
		this.$root.find(".nu-sidebar-head-label").text(__(title));

		const $body = this.$root.find(".nu-sidebar-body").empty();
		const stored = this.get_group_state()[this.state_key] || {};
		const current_path = this.current_path();

		// Every link in this sidebar, flattened, so pinned rows can be
		// surfaced at the top (above the first collapsible group).
		const all_links = [];
		for (const group of groups) {
			for (const item of group.items) {
				const path = item_path(item);
				if (path) all_links.push({ item, path });
			}
		}
		const pinned_paths = new Set(this.pins[this.state_key] || []);
		const pinned_links = all_links.filter((link) => pinned_paths.has(link.path));
		if (pinned_links.length) {
			const $pinned = $(`
				<div class="nu-pinned-section">
					<div class="nu-pinned-label">${__("Pinned")}</div>
				</div>
			`);
			for (const link of pinned_links) {
				$pinned.append(this.make_link(link, current_path));
			}
			$body.append($pinned);
		}

		for (const group of groups) {
			const links = group.items
				.map((item) => ({ item, path: item_path(item) }))
				.filter((link) => link.path);
			if (!links.length) continue;

			if (!group.label) {
				for (const link of links) $body.append(this.make_link(link, current_path));
				continue;
			}

			// Groups are collapsed by default; once the user opens one it
			// stays open (stored true = opened).
			const collapsed = stored[group.label] !== true;
			const $group = $(`
				<div class="nu-group ${collapsed ? "nu-collapsed" : ""}">
					<button class="nu-group-head">
						${frappe.utils.icon("chevron-right", "sm")}
						<span>${frappe.utils.escape_html(__(group.label))}</span>
					</button>
					<div class="nu-group-items"><div class="nu-group-items-inner"></div></div>
				</div>
			`);
			const $items = $group.find(".nu-group-items-inner");
			for (const link of links) $items.append(this.make_link(link, current_path));

			$group.find(".nu-group-head").on("click", () => {
				const now_collapsed = !$group.hasClass("nu-collapsed");
				$group.toggleClass("nu-collapsed", now_collapsed);
				const state = this.get_group_state();
				if (!state[this.state_key]) state[this.state_key] = {};
				state[this.state_key][group.label] = !now_collapsed;
				this.save_group_state(state);
			});

			$body.append($group);
		}

		if (!$body.children().length) {
			$body.append(`<div class="nu-sidebar-empty">${__("No items")}</div>`);
		}

		// Suppress the collapse animation for the state rendered here (stored +
		// auto-expanded active group); only user toggles should animate.
		$body.addClass("nu-groups-static");
		requestAnimationFrame(() =>
			requestAnimationFrame(() => $body.removeClass("nu-groups-static"))
		);

		this.expand_active_group();
	}

	show_empty() {
		this.$root.find(".nu-sidebar-head-icon").empty();
		this.$root.find(".nu-sidebar-head-label").text("");
		this.$root
			.find(".nu-sidebar-body")
			.html(`<div class="nu-sidebar-empty">${__("Select a module from the top bar")}</div>`);
	}

	make_link(link, current_path) {
		const active =
			current_path &&
			(current_path === link.path || current_path.startsWith(link.path.replace(/\/$/, "") + "/"));
		const pinned = (this.pins[this.state_key] || []).includes(link.path);
		const $link = $(`
			<a class="nu-sidebar-row ${active ? "nu-active" : ""} ${pinned ? "nu-pinned" : ""}">
				${frappe.utils.icon(link.item.icon || "list", "sm")}
				<span>${frappe.utils.escape_html(__(link.item.label))}</span>
				<button class="nu-pin-btn" data-tip="${pinned ? __("Unpin") : __("Pin")}" data-tip-pos="left" aria-label="${pinned ? __("Unpin") : __("Pin")}" tabindex="-1">
					${frappe.utils.icon(pinned ? "pin-off" : "pin", "xs")}
				</button>
			</a>
		`);
		$link.attr("href", link.path);
		$link.on("click", () => this.close_drawer());
		$link.find(".nu-pin-btn").on("click", (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.toggle_pin(link.path);
		});
		return $link;
	}

	toggle_pin(path) {
		const current = this.pins[this.state_key] || [];
		const next = current.includes(path)
			? current.filter((p) => p !== path)
			: [...current, path];
		if (next.length) {
			this.pins[this.state_key] = next;
		} else {
			delete this.pins[this.state_key];
		}
		this.save_pins();
		// Re-render so the row moves between the group and the Pinned section.
		if (this._last) this.show(...this._last);
	}

	current_path() {
		return decodeURIComponent(window.location.pathname).replace(/\/$/, "");
	}

	// On navigation, refresh the active row and make sure its group is open.
	sync_active() {
		const current_path = this.current_path();
		let $active = null;
		this.$root.find(".nu-sidebar-body a.nu-sidebar-row").each(function () {
			const href = decodeURIComponent($(this).attr("href") || "")
				.split("?")[0]
				.split("#")[0]
				.replace(/\/$/, "");
			const is_active =
				href && (current_path === href || current_path.startsWith(href + "/"));
			$(this).toggleClass("nu-active", is_active);
			if (is_active) $active = $(this);
		});
		if ($active) {
			$active.closest(".nu-group").removeClass("nu-collapsed");
			if (!frappe.dom.is_element_in_viewport($active)) {
				$active.get(0).scrollIntoView({ block: "nearest" });
			}
		}
	}

	expand_active_group() {
		this.$root.find(".nu-active").closest(".nu-group").removeClass("nu-collapsed");
	}

	toggle(hide) {
		this.$root.toggle(!hide);
	}
}
