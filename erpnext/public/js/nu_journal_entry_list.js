// NU-ERP Journal Entry list extensions (ported from the erp4me-web app,
// feedback items #42, #43). Purely additive: this file loads after the stock
// journal_entry_list.js via the doctype_list_js hook and extends the same
// settings object — stock add_fields/get_indicator stay intact.
//
//   #42  Registered documents show their document number — the list's ID
//        column (e.g. ACC-JV-2026-00001) is relabelled "Document No."
//        (the number itself, the form title, and the General Ledger
//        "Voucher No." are already stock).
//   #43  Duplicate action — copy checked journal entries into fresh drafts
//        with new document numbers. Cancelled entries are skipped. The form
//        already has stock's Duplicate (Shift+D); row-level duplication in
//        the accounts grid is covered by stock (expanded row → Duplicate,
//        Shift+Alt+Down) and by NU-ERP's insert-below additions.
//   D1   Transaction date in the list — a real Posting Date column is
//        spliced into listview.columns, so stock rendering and header
//        click-sort work natively. Display mode toggles Gregorian ⇄
//        Jalali (nu.jalali, persisted in localStorage); conversion is
//        presentation-only — stored values stay Gregorian.

const NU_JE_DATE_MODE_KEY = "nu_je_list_date_mode";

Object.assign(frappe.listview_settings["Journal Entry"], {
	onload(listview) {
		nu_je_relabel_id_column(listview);
		nu_je_add_posting_date_column(listview);
		nu_je_setup_date_mode(listview);

		listview.page.add_actions_menu_item(__("Duplicate"), () => {
			nu_je_duplicate_checked(listview);
		});
	},
	refresh(listview) {
		nu_je_relabel_id_column(listview);
		// user-edited List View Settings rebuild columns — re-splice ours
		nu_je_add_posting_date_column(listview);
	},
	formatters: {
		posting_date(value) {
			if (!value) return "";
			// must return HTML — stock feeds formatter output to $(...) when
			// measuring column width, and a bare "1405/06/18" is an invalid
			// selector (Sizzle throws and kills the whole list render)
			const text =
				nu_je_date_mode() === "jalali"
					? nu.jalali.format(value)
					: frappe.datetime.str_to_user(value);
			return `<span>${text}</span>`;
		},
	},
});

function nu_je_date_mode() {
	return localStorage.getItem(NU_JE_DATE_MODE_KEY) === "jalali" ? "jalali" : "gregorian";
}

function nu_je_add_posting_date_column(listview) {
	if (!listview.columns) return;
	if (listview.columns.some((c) => c.df && c.df.fieldname === "posting_date")) return;
	const df = frappe.meta.get_docfield("Journal Entry", "posting_date");
	if (!df) return;
	// before the ID (name) column if stock appended one, else at the end
	const id_index = listview.columns.findIndex((c) => c.df && c.df.fieldname === "name");
	listview.columns.splice(id_index === -1 ? listview.columns.length : id_index, 0, {
		type: "Field",
		df,
	});
	listview.render_header(true);
}

function nu_je_setup_date_mode(listview) {
	const anchor =
		listview.$filter_section && listview.$filter_section.find(".sort-selector").last();
	if (!anchor || !anchor.length) return;
	if (anchor.parent().find(".nu-date-mode").length) return;

	const wrap = $(
		`<div class="nu-date-mode" title="${__("Posting Date display — stored dates stay Gregorian")}">
			<button type="button" data-mode="gregorian">${__("Gregorian")}</button>
			<button type="button" data-mode="jalali">${__("Jalali")}</button>
		</div>`
	);
	const sync = () =>
		wrap
			.find("button")
			.each(function () {
				$(this).toggleClass("active", $(this).attr("data-mode") === nu_je_date_mode());
			});
	wrap.find("button").on("click", function () {
		localStorage.setItem(NU_JE_DATE_MODE_KEY, $(this).attr("data-mode"));
		sync();
		// re-render from the data already in hand — refresh() would hit
		// stock's no_change skip and leave the old format on screen
		listview.render();
	});
	sync();
	anchor.before(wrap);
}

function nu_je_relabel_id_column(listview) {
	listview.$result.find(".list-row-head .list-row-col").each(function () {
		const $col = $(this);
		const $span = $col.find("span").first();
		const $target = $span.length ? $span : $col;
		if ($target.text().trim() === "ID") {
			$target.text(__("Document No."));
		}
	});
}

function nu_je_duplicate_checked(listview) {
	const items = listview.get_checked_items();
	const targets = items.filter((d) => d.docstatus !== 2);
	const skipped = items.length - targets.length;

	if (!targets.length) {
		frappe.msgprint(__("Cancelled journal entries cannot be duplicated."));
		return;
	}

	frappe.dom.freeze(__("Duplicating..."));
	const created = [];
	frappe
		.run_serially(
			targets.map((d) => () =>
				nu_je_duplicate_one(d.name).then((new_name) => {
					if (new_name) created.push(new_name);
				})
			)
		)
		.then(() => {
			frappe.dom.unfreeze();
			if (skipped) {
				frappe.show_alert({
					message: __("Skipped {0} cancelled entr(y/ies).", [skipped]),
					indicator: "orange",
				});
			}
			if (created.length) {
				frappe.show_alert(
					{
						message:
							created.length === 1
								? __("Journal Entry {0} created as a duplicate.", [created[0]])
								: __("{0} journal entries created as duplicates: {1}", [
										created.length,
										created.join(", "),
								  ]),
						indicator: "green",
					},
					10
				);
			}
			listview.refresh();
		});
}

async function nu_je_duplicate_one(name) {
	const r = await frappe.call({
		method: "frappe.client.get",
		args: { doctype: "Journal Entry", name },
	});
	const src = r.message;
	if (!src) return null;

	// Mirrors the old app's remap: header identity + complete account/amount/
	// currency rows, nothing else — no references, cheque/clearance data,
	// reversal links, or system fields, so validation runs clean and the
	// naming series assigns a fresh document number.
	const doc = {
		doctype: "Journal Entry",
		docstatus: 0,
		voucher_type: src.voucher_type,
		naming_series: src.naming_series,
		company: src.company,
		posting_date: src.posting_date,
		user_remark: src.user_remark,
		multi_currency: src.multi_currency,
		accounts: (src.accounts || []).map((a) => ({
			doctype: "Journal Entry Account",
			account: a.account,
			debit: a.debit,
			credit: a.credit,
			debit_in_account_currency: a.debit_in_account_currency,
			credit_in_account_currency: a.credit_in_account_currency,
			account_currency: a.account_currency,
			exchange_rate: a.exchange_rate,
			cost_center: a.cost_center,
			project: a.project,
			party_type: a.party_type,
			party: a.party,
		})),
	};

	const ins = await frappe.call({ method: "frappe.client.insert", args: { doc } });
	return ins.message && ins.message.name;
}
