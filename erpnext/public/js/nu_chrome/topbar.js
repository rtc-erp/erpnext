// NU-ERP custom desk chrome — top bar.
// Horizontal module menu (pinned modules + "More") with the stock awesomebar
// search and notifications re-provided so nothing is lost with the stock
// sidebar hidden.

import { resolved_pinned, more_sidebars, sidebar_links } from "./data";

export class NUTopbar {
	constructor(chrome) {
		this.chrome = chrome;
		this.more_open = false;
		this.render();
		this.bind();
		this.setup_notifications();
	}

	render() {
		const tabs = resolved_pinned()
			.map(
				(m) => `
				<button class="nu-tab" data-module="${m.key}">
					${frappe.utils.icon(m.icon, "sm")}
					<span>${__(m.label)}</span>
				</button>`
			)
			.join("");

		this.$root = $(`
			<div class="nu-topbar">
				<button class="nu-icon-btn nu-menu-toggle" title="${__("Menu")}">
					${frappe.utils.icon("menu", "sm")}
				</button>
				<div class="nu-tabs" role="navigation">
					${tabs}
					<button class="nu-tab nu-more-tab" data-module="more">
						${frappe.utils.icon("layout-grid", "sm")}
						<span>${__("More")}</span>
						${frappe.utils.icon("chevron-down", "xs")}
					</button>
				</div>
				<div class="nu-topbar-right">
					${
						frappe.boot.desk_settings.search_bar
							? `<button class="nu-search" title="${__("Search")}">
								${frappe.utils.icon("search", "sm")}
								<span class="nu-search-label">${__("Search")}</span>
								<span class="nu-kbd">${frappe.utils.is_mac() ? "⌘K" : "Ctrl+K"}</span>
							</button>`
							: ""
					}
					${
						frappe.boot.desk_settings.notifications && frappe.session.user !== "Guest"
							? `<button class="nu-icon-btn sidebar-notification hidden" title="${__("Notifications")}">
								${frappe.utils.icon("bell", "sm")}
								<span class="sidebar-notification-count hidden" aria-live="polite"></span>
							</button>`
							: ""
					}
				</div>
				<div class="nu-more-card hidden">
					<div class="nu-more-search">
						<input type="text" class="form-control" placeholder="${__("Search modules and pages")}" />
					</div>
					<div class="nu-more-list"></div>
				</div>
				<div class="dropdown-notifications hidden">
					<div class="notifications-list" role="menu">
						<div class="notification-list-header">
							<div class="header-items"></div>
							<div class="header-actions"></div>
						</div>
						<div class="notification-list-body">
							<div class="panel-notifications"></div>
							<div class="panel-events"></div>
							<div class="panel-changelog-feed"></div>
						</div>
					</div>
				</div>
			</div>
		`);

		// Sit right below the stock header/navbar when it renders, at the top
		// of the scrolling main section otherwise. Sticky, so it stays put.
		const $header = $(".main-section").children("header, .navbar").last();
		if ($header.length) {
			$header.after(this.$root);
		} else {
			$(".main-section").prepend(this.$root);
		}
	}

	bind() {
		this.$root.find(".nu-tab").on("click", (e) => {
			const key = $(e.currentTarget).data("module");
			if (key === "more") {
				this.toggle_more();
			} else {
				this.close_more();
				this.chrome.activate_module(key);
			}
		});

		this.$root.find(".nu-menu-toggle").on("click", () => {
			document.body.classList.toggle("nu-sidebar-open");
		});

		// The stock sidebar keeps a live awesomebar bound to its (hidden)
		// search button — reuse it so search behaves exactly as stock.
		this.$root.find(".nu-search").on("click", () => {
			$("#navbar-modal-search").trigger("click");
		});

		this.$root.find(".sidebar-notification").on("click", () => {
			const $dropdown = this.$root.find(".dropdown-notifications");
			$dropdown.toggleClass("hidden");
			if (!$dropdown.hasClass("hidden")) {
				$dropdown.trigger("show.bs.dropdown");
			}
		});

		this.$root.find(".nu-more-search input").on("input", (e) => {
			this.render_more_list(e.target.value.trim().toLowerCase());
		});

		document.addEventListener("click", (e) => {
			if (this.more_open && !this.$root.get(0).contains(e.target)) {
				this.close_more();
			}
		});
		document.addEventListener("keydown", (e) => {
			if (e.key === "Escape") this.close_more();
		});
	}

	setup_notifications() {
		if (frappe.boot.desk_settings.notifications && frappe.session.user !== "Guest") {
			this.notifications = new frappe.ui.Notifications({
				wrapper: this.$root,
				full_height: true,
			});
		}
	}

	toggle_more() {
		this.more_open = !this.more_open;
		this.$root.find(".nu-more-card").toggleClass("hidden", !this.more_open);
		if (this.more_open) {
			this.render_more_list("");
			this.$root.find(".nu-more-search input").val("").trigger("focus");
		}
	}

	close_more() {
		this.more_open = false;
		this.$root.find(".nu-more-card").addClass("hidden");
	}

	render_more_list(query) {
		const modules = more_sidebars();
		const $list = this.$root.find(".nu-more-list").empty();

		for (const mod of modules) {
			const module_matches = !query || mod.label.toLowerCase().includes(query);
			const links = sidebar_links(mod.data).filter(
				(link) => query && link.label.toLowerCase().includes(query)
			);
			if (!module_matches && !links.length) continue;

			const $mod = $(`
				<button class="nu-more-module">
					${frappe.utils.icon(mod.icon, "sm")}
					<span>${frappe.utils.escape_html(__(mod.label))}</span>
				</button>
			`);
			$mod.on("click", () => {
				this.close_more();
				this.chrome.activate_sidebar_key(mod.key, mod.label);
			});
			$list.append($mod);

			for (const link of links) {
				const $link = $(`
					<a class="nu-more-link">
						<span class="nu-more-link-crumb">${frappe.utils.escape_html(__(mod.label))}</span>
						<span>${frappe.utils.escape_html(__(link.label))}</span>
					</a>
				`);
				$link.attr("href", link.path);
				$link.on("click", () => this.close_more());
				$list.append($link);
			}
		}

		if (!$list.children().length) {
			$list.append(`<div class="nu-more-empty">${__("No matches")}</div>`);
		}
	}

	set_active(key) {
		this.$root.find(".nu-tab").removeClass("nu-tab-active");
		if (key) {
			this.$root.find(`.nu-tab[data-module="${key}"]`).addClass("nu-tab-active");
		}
	}
}
