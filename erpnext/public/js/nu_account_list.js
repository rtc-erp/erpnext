// NU-ERP Account list extension (ported from the erp4me-web app, feedback
// item #34). Purely additive: there is no stock account_list.js, so this
// file (wired via the doctype_list_js hook) defines the settings object.
//
// The Chart of Accounts tree is the primary surface for in-transit badges
// (see nu_account_tree.js); this mirrors them into the Account list view:
// every visible row with draft journal activity gets a ⇢ Dr / ⇠ Cr badge.

frappe.listview_settings["Account"] = {
	refresh(listview) {
		nu_account_list_paint_transit(listview);
	},
};

async function nu_account_list_paint_transit(listview) {
	if (frappe.boot.user.can_read.indexOf("GL Entry") == -1) return;

	const company_filter = listview.filter_area
		.get()
		.find((f) => f[1] === "company" && f[2] === "=");
	const company = company_filter
		? company_filter[3]
		: frappe.defaults.get_user_default("Company");
	if (!company) return;

	let data;
	try {
		const r = await frappe.call({
			method: "erpnext.accounts.nu_api.get_draft_journal_balances",
			args: { company },
		});
		data = r.message || [];
	} catch (e) {
		return; // degrade to "no badges", never fake zeros (old-app rule)
	}
	if (!data.length) return;

	const by_account = {};
	for (const entry of data) by_account[entry.value] = entry;

	listview.$result.find(".list-row").each(function () {
		const $row = $(this);
		// v16 rows carry the docname on the row checkbox, not on .list-row
		const name = $row.find(".list-row-checkbox").attr("data-name");
		const entry = name && by_account[name];
		if (!entry || $row.find(".nu-transit-area").length) return;

		const foreign =
			!entry.is_group &&
			entry.account_currency &&
			entry.account_currency !== entry.company_currency;
		const fmt = (value, currency) => format_currency(Math.abs(value), currency);

		const parts = [];
		if (entry.transit_debit) {
			parts.push(
				`<span class="nu-transit-dr">⇢ ${
					foreign
						? fmt(entry.transit_debit_in_account_currency, entry.account_currency) + " / "
						: ""
				}${fmt(entry.transit_debit, entry.company_currency)}</span>`
			);
		}
		if (entry.transit_credit) {
			parts.push(
				`<span class="nu-transit-cr">⇠ ${
					foreign
						? fmt(entry.transit_credit_in_account_currency, entry.account_currency) + " / "
						: ""
				}${fmt(entry.transit_credit, entry.company_currency)}</span>`
			);
		}

		$row.find(".list-subject").first().append(
			`<span class="nu-transit-area" data-toggle="tooltip"
				title="${__(
					"In-transit debit/credit — draft journal entries not yet approved",
					"",
					"Chart of Accounts"
				)}">${parts.join(" ")}</span>`
		);
	});
}
