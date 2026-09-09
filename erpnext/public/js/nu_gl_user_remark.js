// NU-ERP General Ledger extension (user request: "View Ledger from Chart of
// Accounts should have a User Remark column"). Purely additive: wraps
// QueryReport.render_datatable, scoped to the General Ledger report only —
// no stock file touched, no data change.
//
// The GL report's own "Remarks" column (filter-gated) shows GL Entry
// remarks, which never include the Journal Entry *header* user_remark —
// the field NU-ERP unhid in #14. So the remark is looked up from the
// source Journal Entry docs: one batched get_list per report run,
// cached per voucher set, then the report re-renders with the column.
// Other voucher types and total/group rows stay blank. On fetch error
// the column simply never appears — never fake data.
//
// Limitation (documented): server-side export (Excel/PDF/print) does not
// include the column; it is an on-screen enrichment.

frappe.provide("nu");

(function () {
	const REPORT = "General Ledger";
	const FIELD = "user_remark";

	if (!frappe.views || !frappe.views.QueryReport) return;

	const original_render = frappe.views.QueryReport.prototype.render_datatable;
	frappe.views.QueryReport.prototype.render_datatable = function (...args) {
		if (this.report_name === REPORT) nu_gl_inject_column(this);
		const out = original_render.apply(this, args);
		if (this.report_name === REPORT) nu_gl_ensure_remarks(this);
		return out;
	};

	// synchronous part: once remarks are cached, fold column + values into
	// the stock render inputs (columns are rebuilt server-side each refresh,
	// so injection re-runs idempotently on every render)
	function nu_gl_inject_column(report) {
		const map = report.__nu_remark_map;
		if (!map) return;

		if (!report.columns.some((c) => c.fieldname === FIELD)) {
			const after = report.columns.findIndex((c) => c.fieldname === "voucher_no");
			report.columns.splice(after === -1 ? report.columns.length : after + 1, 0, {
				// the datatable column model keys on id/name — label alone is
				// dropped silently (stock columns get these via prepare_columns)
				label: __("User Remark"),
				name: __("User Remark"),
				id: FIELD,
				fieldname: FIELD,
				fieldtype: "Data",
				width: 220,
			});
		}
		for (const row of report.data || []) {
			if (row.voucher_type === "Journal Entry" && row.voucher_no) {
				row[FIELD] = map[row.voucher_no] || "";
			}
		}
	}

	// async part: fetch remarks for the current voucher set (once per set),
	// then re-render so the column appears
	function nu_gl_ensure_remarks(report) {
		const names = [
			...new Set(
				(report.data || [])
					.filter((r) => r.voucher_type === "Journal Entry" && r.voucher_no)
					.map((r) => r.voucher_no)
			),
		];
		const key = names.slice().sort().join("|");
		if (report.__nu_remark_loading) return;
		if (report.__nu_remark_key === key && report.__nu_remark_map) return;

		if (!names.length) {
			report.__nu_remark_key = key;
			report.__nu_remark_map = {};
			report.render_datatable();
			return;
		}

		report.__nu_remark_loading = true;
		frappe.call({
			method: "frappe.client.get_list",
			args: {
				doctype: "Journal Entry",
				filters: [["Journal Entry", "name", "in", names]],
				fields: ["name", "user_remark"],
				limit_page_length: 1000,
			},
			callback(r) {
				report.__nu_remark_loading = false;
				report.__nu_remark_key = key;
				report.__nu_remark_map = {};
				for (const d of r.message || []) {
					report.__nu_remark_map[d.name] = d.user_remark || "";
				}
				const route = frappe.get_route();
				if (route[0] === "query-report" && route[1] === REPORT && report.datatable) {
					report.render_datatable();
				}
			},
			error() {
				report.__nu_remark_loading = false;
			},
		});
	}
})();
