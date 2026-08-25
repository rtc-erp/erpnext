// NU-ERP custom desk chrome — data layer.
// Everything here derives from frappe.boot (already permission-filtered
// server-side); no extra network calls, no backend changes.

// Top-bar modules, in display order. `sidebar_keys` are candidate keys into
// frappe.boot.workspace_sidebar_item (lowercase sidebar titles); the first
// one present at runtime wins. "reports" is a virtual module aggregating all
// report links across visible sidebars.
export const PINNED_MODULES = [
	{
		key: "accounting",
		label: "Accounting",
		icon: "accounting",
		sidebar_keys: ["invoicing", "accounts", "accounting", "accounts setup"],
	},
	{ key: "selling", label: "Selling", icon: "sell", sidebar_keys: ["selling"] },
	{ key: "buying", label: "Buying", icon: "buying", sidebar_keys: ["buying"] },
	{ key: "stock", label: "Stock", icon: "stock", sidebar_keys: ["stock"] },
	{ key: "crm", label: "CRM", icon: "crm", sidebar_keys: ["crm"] },
	{ key: "reports", label: "Reports", icon: "chart", virtual: "reports" },
	{
		key: "settings",
		label: "Settings",
		icon: "setting",
		sidebar_keys: ["erpnext settings", "settings", "setup", "system"],
	},
];

export function get_sidebars() {
	return frappe.boot?.workspace_sidebar_item || {};
}

function has_links(sidebar) {
	return (sidebar?.items || []).some((item) => item.type !== "Section Break");
}

// Resolve a pinned module to an actual sidebar key present in boot data.
export function resolve_pinned(pinned) {
	if (pinned.virtual) return pinned;
	for (const key of pinned.sidebar_keys || []) {
		const data = get_sidebars()[key];
		if (data && has_links(data)) {
			return { ...pinned, sidebar_key: key, data };
		}
	}
	return null;
}

export function resolved_pinned() {
	return PINNED_MODULES.map(resolve_pinned).filter(Boolean);
}

// Sidebar keys claimed by the pinned top-bar modules.
export function pinned_sidebar_keys() {
	const keys = new Set();
	for (const pinned of resolved_pinned()) {
		if (pinned.sidebar_key) keys.add(pinned.sidebar_key);
	}
	return keys;
}

// Everything not pinned — feeds the "More" card.
export function more_sidebars() {
	const pinned = pinned_sidebar_keys();
	return Object.entries(get_sidebars())
		.filter(([key, data]) => !pinned.has(key) && has_links(data))
		.map(([key, data]) => ({ key, label: data.label || key, icon: data.header_icon || "folder-normal", data }))
		.sort((a, b) => a.label.localeCompare(b.label));
}

// Group a sidebar's flat item list the same way frappe.ui.Sidebar does
// (sidebar.js find_nested_items): Section Break starts a group, subsequent
// items flagged `child` belong to it.
export function group_items(items) {
	const groups = [];
	let current = null;
	for (const item of items || []) {
		if (item.type === "Section Break") {
			current = { label: item.label, collapsible: item.collapsible !== 0, items: [] };
			groups.push(current);
		} else if (current && item.child) {
			current.items.push(item);
		} else {
			groups.push({ label: null, items: [item] });
		}
	}
	return groups.filter((g) => g.label || g.items.length);
}

// Replicates frappe.ui.sidebar_item.TypeLink.get_path() so our links land on
// the exact same routes the stock sidebar would produce.
export function item_path(item) {
	if (!item || item.type !== "Link") return null;
	const link_type = item.link_type;

	if (link_type === "Report") {
		if (!item.report) return null;
		return frappe.utils.generate_route({
			type: "Report",
			name: item.link_to,
			is_query_report:
				item.report.report_type === "Query Report" ||
				item.report.report_type === "Script Report",
			report_ref_doctype: item.report.ref_doctype,
		});
	}

	if (link_type === "Workspace") {
		const slug = frappe.router.slug(item.link_to);
		const workspace = frappe.workspaces?.[slug];
		let path = workspace && workspace.public ? `/desk/${slug}` : `/desk/private/${slug}`;
		return item.route || path;
	}

	if (link_type === "URL") {
		return item.url;
	}

	const args = { type: link_type, name: item.link_to, tab: item.tab };
	if (item.filters) {
		try {
			let filters_json = JSON.parse(
				frappe.utils.get_filter_as_json(JSON.parse(item.filters))
			);
			for (const [key, value] of Object.entries(filters_json)) {
				if (Array.isArray(value)) filters_json[key] = value[1];
			}
			if (link_type === "DocType") {
				args.doc_view = "List";
				args.route_options = filters_json;
			}
		} catch (e) {
			// ignore malformed filters, same as a plain link
		}
	} else if (item.route_options) {
		try {
			const route_options = JSON.parse(item.route_options);
			if (link_type === "DocType") {
				args.doc_view = "List";
				args.route_options = route_options;
			} else {
				args.route_options = route_options;
			}
		} catch (e) {
			// ignore malformed route options
		}
	}
	return frappe.utils.generate_route(args);
}

// Flatten a sidebar's items into navigable links: [{ label, icon, path, item }]
export function sidebar_links(sidebar) {
	const links = [];
	for (const item of sidebar?.items || []) {
		if (item.type !== "Link") continue;
		const path = item_path(item);
		if (path) links.push({ label: item.label, icon: item.icon, path, item });
	}
	return links;
}

// The virtual "Reports" sidebar: one collapsed group per module sidebar that
// contains report links.
export function reports_groups() {
	const groups = [];
	for (const [key, sidebar] of Object.entries(get_sidebars())) {
		const reports = (sidebar.items || []).filter(
			(item) => item.type === "Link" && item.link_type === "Report" && item.report
		);
		if (reports.length) {
			groups.push({ label: sidebar.label || key, items: reports });
		}
	}
	return groups.sort((a, b) => a.label.localeCompare(b.label));
}
