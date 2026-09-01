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
				<button class="nu-icon-btn nu-menu-toggle" data-tip="${__("Menu")}" aria-label="${__("Menu")}">
					${frappe.utils.icon("menu", "sm")}
				</button>
				<div class="nu-tabs" role="navigation">
					${tabs}
					<button class="nu-tab nu-more-tab" data-module="more">
						${frappe.utils.icon("layout-grid", "sm")}
						<span>${__("More")}</span>
						<span class="nu-more-current hidden"></span>
						${frappe.utils.icon("chevron-down", "xs")}
					</button>
				</div>
				<div class="nu-topbar-right">
					${
						frappe.boot.desk_settings.search_bar
							? `<button class="nu-search" data-tip="${__("Search")}" aria-label="${__("Search")}">
								${frappe.utils.icon("search", "sm")}
								<span class="nu-search-label">${__("Search")}</span>
								<span class="nu-kbd">${frappe.utils.is_mac() ? "⌘K" : "Ctrl+K"}</span>
							</button>`
							: ""
					}
					${
						frappe.boot.desk_settings.notifications && frappe.session.user !== "Guest"
							? `<button class="nu-icon-btn sidebar-notification hidden" data-tip="${__("Notifications")}" aria-label="${__("Notifications")}">
								<span class="sidebar-item-icon">${frappe.utils.icon("bell", "sm")}</span>
								<span class="sidebar-notification-count hidden" aria-live="polite"></span>
							</button>`
							: ""
					}
					<button class="nu-icon-btn nu-theme-toggle" data-tip="${__("Theme")}" aria-label="${__("Theme")}">
						${frappe.utils.icon(this.theme_icon(), "sm")}
					</button>
					<div class="nu-theme-menu hidden">
						<button class="nu-theme-option" data-theme-mode="light">
							${frappe.utils.icon("sun", "sm")}
							<span>${__("Light")}</span>
							${frappe.utils.icon("tick", "sm")}
						</button>
						<button class="nu-theme-option" data-theme-mode="dark">
							${frappe.utils.icon("moon", "sm")}
							<span>${__("Dark")}</span>
							${frappe.utils.icon("tick", "sm")}
						</button>
						<button class="nu-theme-option" data-theme-mode="automatic">
							${frappe.utils.icon("monitor", "sm")}
							<span>${__("System")}</span>
							${frappe.utils.icon("tick", "sm")}
						</button>
					</div>
				</div>
				<div class="nu-more-card hidden">
					<div class="nu-more-search">
						<input type="text" class="form-control" placeholder="${__("Search modules and pages")}" />
					</div>
					<div class="nu-more-list"></div>
				</div>
				${
					// Shell the stock frappe.ui.Notifications class wires itself
					// into (setup_notifications); only rendered when the bell is.
					frappe.boot.desk_settings.notifications && frappe.session.user !== "Guest"
						? `<div class="dropdown-notifications hidden">
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
						</div>`
						: ""
				}
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

		this.$root.find(".sidebar-notification").on("click", (e) => {
			// Keep the stock instance's document click-outside handler (which
			// only exempts its own sidebar bell) from seeing our bell clicks —
			// otherwise it would re-hide the panel on the same click that opens
			// it. Everything else (panel content, true outside clicks) still
			// flows through the stock handler exactly like stock.
			e.stopPropagation();
			const $dropdown = this.$root.find(".dropdown-notifications");
			if ($dropdown.hasClass("hidden")) {
				$dropdown.removeClass("hidden nu-menu-out");
				$dropdown.trigger("show.bs.dropdown");
			} else {
				this.hide_menu($dropdown);
			}
		});

		this.$root.find(".nu-more-search input").on("input", (e) => {
			this.render_more_list(e.target.value.trim().toLowerCase());
		});

		this.$root.find(".nu-theme-toggle").on("click", (e) => {
			e.stopPropagation();
			this.toggle_theme_menu();
		});

		this.$root.find(".nu-theme-option").on("click", (e) => {
			this.apply_theme($(e.currentTarget).data("theme-mode"));
			this.close_theme_menu();
		});

		document.addEventListener("click", (e) => {
			if (!this.$root.get(0).contains(e.target)) {
				if (this.more_open) this.close_more();
				this.close_theme_menu();
			}
		});
		document.addEventListener("keydown", (e) => {
			if (e.key === "Escape") {
				this.close_more();
				this.close_theme_menu();
				this.close_notifications();
			}
		});
	}

	setup_notifications() {
		if (frappe.boot.desk_settings.notifications && frappe.session.user !== "Guest") {
			this.notifications = new frappe.ui.Notifications({
				wrapper: this.$root,
				full_height: true,
			});

			// The stock view resolves the badge and the bell indicator through a
			// closest(".body-sidebar") ancestor — the stock sidebar's shell, which
			// our top bar deliberately does not borrow (stock JS inserts DOM into
			// every $(".body-sidebar") match). Point both lookups at our bell
			// instead; all the logic (counts, aria, indicator dot, realtime)
			// stays stock.
			const view = this.notifications.tabs && this.notifications.tabs.notifications;
			if (view) {
				view.bell_indicator = this.$root.find(
					".sidebar-notification .sidebar-item-icon"
				);
				const $badge = this.$root.find(".sidebar-notification-count");
				// Same body as the stock update_count_badge (notifications.js),
				// with $suffix resolved to our badge instead of the sidebar's.
				view.update_count_badge = function (count) {
					this.unread_count = count;
					if (!$badge.length) return;
					if (count > 0) {
						$badge
							.text(count > 99 ? "99+" : count)
							.attr("aria-label", __("{0} unread notifications", [count]))
							.removeClass("hidden");
					} else {
						$badge.removeAttr("aria-label").addClass("hidden");
					}
				};
				// The constructor's own initial badge call ran before the patch
				// above (against the missing stock shell) — replay it.
				view.update_count_badge(view.unread_count || 0);
			}
		}
	}

	toggle_more() {
		this.more_open = !this.more_open;
		const $card = this.$root.find(".nu-more-card");
		if (this.more_open) {
			$card.removeClass("hidden nu-menu-out");
			this.position_more_card();
			this.render_more_list("");
			this.$root.find(".nu-more-search input").val("").trigger("focus");
		} else {
			this.hide_menu($card);
		}
	}

	// Open the card directly under the "More" tab (clamped inside the bar),
	// not at the far right edge of the top bar.
	position_more_card() {
		const topbar = this.$root.get(0);
		const btn = this.$root.find(".nu-more-tab").get(0);
		const card = this.$root.find(".nu-more-card").get(0);
		if (!topbar || !btn || !card) return;
		const card_w = card.offsetWidth || 320;
		const max_left = topbar.clientWidth - card_w - 8;
		const left = Math.max(8, Math.min(btn.offsetLeft, max_left));
		card.style.left = `${left}px`;
	}

	// Hide a .hidden-toggled menu with a short exit transition (the mirror of
	// the nu-menu-in keyframe entry in nu_chrome.scss) instead of an instant
	// display flip.
	hide_menu($el) {
		if ($el.hasClass("hidden") || $el.hasClass("nu-menu-out")) return;
		$el.addClass("nu-menu-out");
		setTimeout(() => {
			// Re-opened meanwhile — the open path clears nu-menu-out.
			if (!$el.hasClass("nu-menu-out")) return;
			$el.addClass("hidden").removeClass("nu-menu-out");
		}, 140);
	}

	close_more() {
		this.more_open = false;
		this.hide_menu(this.$root.find(".nu-more-card"));
	}

	close_notifications() {
		this.hide_menu(this.$root.find(".dropdown-notifications"));
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

	set_active(key, label) {
		this.$root.find(".nu-tab").removeClass("nu-tab-active");
		const $current = this.$root.find(".nu-more-current");
		if (key) {
			this.$root.find(`.nu-tab[data-module="${key}"]`).addClass("nu-tab-active");
		}
		// When the active module lives in the overflow, the "More" tab widens
		// to name it; any other active tab clears the label again.
		if (key === "more" && label) {
			$current.text(__(label)).removeClass("hidden");
		} else {
			$current.addClass("hidden").text("");
		}
	}

	// -- theme switcher ------------------------------------------------------

	theme_icon() {
		const mode = document.documentElement.getAttribute("data-theme-mode") || "light";
		return { light: "sun", dark: "moon", automatic: "monitor" }[mode] || "sun";
	}

	toggle_theme_menu() {
		const $menu = this.$root.find(".nu-theme-menu");
		const will_open = $menu.hasClass("hidden");
		this.close_theme_menu();
		if (will_open) {
			this.sync_theme_menu();
			$menu.removeClass("hidden nu-menu-out");
		}
	}

	close_theme_menu() {
		this.hide_menu(this.$root.find(".nu-theme-menu"));
	}

	sync_theme_menu() {
		const mode = document.documentElement.getAttribute("data-theme-mode") || "light";
		this.$root.find(".nu-theme-option").each(function () {
			$(this).toggleClass("nu-theme-current", $(this).data("theme-mode") === mode);
		});
	}

	apply_theme(mode) {
		if (!["light", "dark", "automatic"].includes(mode)) return;
		// Same flow as frappe's own ThemeSwitcher.toggle_theme.
		document.documentElement.setAttribute("data-theme-mode", mode);
		frappe.ui.set_theme();
		this.$root.find(".nu-theme-toggle").html(frappe.utils.icon(this.theme_icon(), "sm"));
		frappe.xcall("frappe.core.doctype.user.user.switch_theme", {
			theme: toTitle(mode),
		});
	}
}
