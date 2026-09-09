// NU-ERP Chart of Accounts extension (ported from the erp4me-web app,
// feedback item #34). Purely additive: loads after the stock
// account_tree.js via the doctype_tree_js hook and wraps its
// on_node_render — no stock file is modified.
//
// Draft (docstatus = 0) journal entries contribute "in-transit" Dr/Cr
// amounts, shown separately from the posted balance so users can verify a
// document was recorded correctly before it is approved. Amounts are
// aggregated through account groups server-side
// (erpnext.accounts.nu_api.get_draft_journal_balances), matching how the
// stock balances roll up. Only rendered for users who can read GL Entry —
// the same gate stock applies to balances.

(function () {
	const settings = frappe.treeview_settings["Account"];
	if (!settings || settings.__nu_transit_patched) return;
	settings.__nu_transit_patched = true;

	const original_on_node_render = settings.on_node_render;

	settings.on_node_render = function (node, deep) {
		original_on_node_render && original_on_node_render.call(this, node, deep);
		nu_coa_render_transit(node);
	};

	function nu_coa_render_transit() {
		if (frappe.boot.user.can_read.indexOf("GL Entry") == -1) return;
		if (typeof cur_tree === "undefined" || !cur_tree.args || !cur_tree.args.company) return;

		if (!cur_tree.__nu_transit) {
			cur_tree.__nu_transit = "loading";
			frappe.call({
				method: "erpnext.accounts.nu_api.get_draft_journal_balances",
				args: { company: cur_tree.args.company },
				callback: function (r) {
					cur_tree.__nu_transit = r.message || [];
					nu_coa_paint_transit();
				},
				error: function () {
					// degrade to "no badges", never fake zeros (old-app rule)
					cur_tree.__nu_transit = [];
				},
			});
		} else if (cur_tree.__nu_transit !== "loading") {
			nu_coa_paint_transit();
		}
	}

	function nu_coa_paint_transit() {
		if (!Array.isArray(cur_tree.__nu_transit)) return;
		for (const account of cur_tree.__nu_transit) {
			const node = cur_tree.nodes && cur_tree.nodes[account.value];
			if (!node || node.is_root) continue;

			node.parent && node.parent.find(".nu-transit-area").remove();

			const foreign =
				!account.is_group &&
				account.account_currency &&
				account.account_currency !== account.company_currency;
			const fmt = (value, currency) => format_currency(Math.abs(value), currency);

			const parts = [];
			if (account.transit_debit) {
				parts.push(
					`<span class="nu-transit-dr">⇢ ${
						foreign
							? fmt(account.transit_debit_in_account_currency, account.account_currency) +
							  " / "
							: ""
					}${fmt(account.transit_debit, account.company_currency)}</span>`
				);
			}
			if (account.transit_credit) {
				parts.push(
					`<span class="nu-transit-cr">⇠ ${
						foreign
							? fmt(account.transit_credit_in_account_currency, account.account_currency) +
							  " / "
							: ""
					}${fmt(account.transit_credit, account.company_currency)}</span>`
				);
			}
			if (!parts.length) continue;

			const badge = $(
				`<span class="nu-transit-area pull-right" data-toggle="tooltip"
					title="${__(
						"In-transit debit/credit — draft journal entries not yet approved",
						"",
						"Chart of Accounts"
					)}">${parts.join(" ")}</span>`
			);

			// keep the posted balance first when it is rendered
			const balance_area = node.parent && node.parent.find(".balance-area");
			if (balance_area && balance_area.length) {
				badge.insertAfter(balance_area.last());
			} else {
				badge.insertBefore(node.$ul);
			}
		}
	}
})();
