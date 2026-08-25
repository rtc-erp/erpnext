// NU-ERP custom desk chrome — left menu.
// Renders the active module's sidebar items as collapsible groups (collapsed
// by default), with Settings and Sign out pinned at the bottom.

import { group_items, item_path } from "./data";

const GROUP_STATE_KEY = "nu-chrome-groups";

export class NUSidebar {
	constructor(chrome) {
		this.chrome = chrome;
		this.render_shell();
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
		this.state_key = state_key || title.toLowerCase();
		this.$root.find(".nu-sidebar-head-icon").html(icon ? frappe.utils.icon(icon, "md") : "");
		this.$root.find(".nu-sidebar-head-label").text(__(title));

		const $body = this.$root.find(".nu-sidebar-body").empty();
		const stored = this.get_group_state()[this.state_key] || {};
		const current_path = this.current_path();

		for (const group of groups) {
			const links = group.items
				.map((item) => ({ item, path: item_path(item) }))
				.filter((link) => link.path);
			if (!links.length) continue;

			if (!group.label) {
				for (const link of links) $body.append(this.make_link(link, current_path));
				continue;
			}

			// Groups are collapsed by default unless the user opened them before.
			const collapsed = stored[group.label] !== false;
			const $group = $(`
				<div class="nu-group ${collapsed ? "nu-collapsed" : ""}">
					<button class="nu-group-head">
						${frappe.utils.icon("chevron-right", "sm")}
						<span>${frappe.utils.escape_html(__(group.label))}</span>
					</button>
					<div class="nu-group-items"></div>
				</div>
			`);
			const $items = $group.find(".nu-group-items");
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
		const $link = $(`
			<a class="nu-sidebar-row ${active ? "nu-active" : ""}">
				${frappe.utils.icon(link.item.icon || "list", "sm")}
				<span>${frappe.utils.escape_html(__(link.item.label))}</span>
			</a>
		`);
		$link.attr("href", link.path);
		$link.attr("title", __(link.item.label));
		$link.on("click", () => this.close_drawer());
		return $link;
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
