// NU-ERP Journal Entry desk extensions (ported from the erp4me-web app,
// feedback items #14, #15, #29). Purely additive: layers on top of the stock
// journal_entry.js via the doctype_js hook — no stock file is modified.
//
//   #14  User Remark belongs to the document — unhide the header-level
//        `user_remark` field (stock ships it hidden; the child grid has no
//        per-row remark column, matching the old app).
//   #15  Insert a row underneath the selected row — rows are selectable
//        (highlighted), and Add Row / Ctrl/Cmd+Enter / the per-row "+" button
//        insert directly below the active row.
//   #29  Document number visible after saving — show a success message with
//        the assigned document number after every draft save.
//   D2   Jalali date at entry time — Posting Date shows its Shamsi
//        equivalent, and clicking it opens a converter input: type the
//        Shamsi date (YYYY/MM/DD) and it is converted and stored as the
//        Gregorian posting date. Storage stays Gregorian; conversion is
//        presentation-only (nu.jalali).

frappe.ui.form.on("Journal Entry", {
	setup(frm) {
		// #14 — flip the docfield before the layout renders so the field
		// shows without waiting for a refresh.
		const df = frappe.meta.get_docfield("Journal Entry", "user_remark", frm.docname);
		if (df) df.hidden = 0;
	},
	refresh(frm) {
		// #14 (kept for good measure on every render)
		frm.set_df_property("user_remark", "hidden", 0);
		// #15
		nu_je_setup_insert_below(frm);
		// D2 — Jalali companion under Posting Date
		nu_je_render_jalali(frm);
	},
	posting_date(frm) {
		nu_je_render_jalali(frm);
	},
	after_save(frm) {
		// #29 — announce the document number on draft saves; submitted
		// documents already get stock's submit flow.
		if (frm.doc.docstatus === 0) {
			frappe.show_alert(
				{
					message: __(
						"Draft Journal Entry {0} saved — submit it from this page or the Journal Entry list.",
						[frm.doc.name]
					),
					indicator: "green",
				},
				7
			);
		}
	},
});

// #15 — row selection + insert-below for the accounts grid.
// Scoped to this grid instance only; no frappe prototype is touched.
function nu_je_setup_insert_below(frm) {
	const grid = frm.fields_dict.accounts && frm.fields_dict.accounts.grid;
	if (!grid || grid.__nu_insert_below) return;
	grid.__nu_insert_below = true;

	const set_active = (name) => {
		grid.__nu_active_row = name;
		grid.wrapper.find(".grid-row.nu-active-row").removeClass("nu-active-row");
		if (name) {
			grid.wrapper.find(`.grid-row[data-name="${name}"]`).addClass("nu-active-row");
		}
	};

	const get_active_doc = () => {
		const row = grid.__nu_active_row && grid.grid_rows_by_docname?.[grid.__nu_active_row];
		return row && row.doc;
	};

	// Track the row the user last clicked or focused into.
	grid.wrapper.on("mousedown.nuje focusin.nuje click.nuje", ".rows .grid-row", function () {
		set_active($(this).attr("data-name"));
	});

	// Re-apply the highlight after any grid re-render.
	const original_refresh = grid.refresh.bind(grid);
	grid.refresh = function (...args) {
		const out = original_refresh(...args);
		if (grid.__nu_active_row) set_active(grid.__nu_active_row);
		return out;
	};

	const insert_below_active = () => {
		const doc = get_active_doc();
		if (doc) {
			// identical to stock "Insert Below" in the expanded row form
			grid.add_new_row(doc.idx + 1, null, true);
		} else {
			// no selection: stock append-at-end behaviour
			grid.add_new_row(null, null, true, null, true);
			grid.set_focus_on_row();
		}
	};

	// Add Row inserts underneath the active row when one is selected.
	grid.wrapper
		.find(".grid-add-row")
		.off("click")
		.on("click", () => {
			if (grid.is_editable()) insert_below_active();
			return false;
		});

	// Ctrl/Cmd+Enter inserts underneath the active row.
	grid.wrapper.on("keydown.nuje", (e) => {
		if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
			if (!grid.is_editable()) return;
			e.preventDefault();
			insert_below_active();
		}
	});

	// Per-row "+" button. Bound for future renders and applied immediately
	// to rows that already rendered before this handler was attached.
	const add_row_button = (grid_row) => {
		if (grid_row.grid !== grid || !grid_row.doc) return;
		if (grid_row.wrapper.find(".nu-insert-below").length) return;
		if (!grid.is_editable()) return;

		const btn = $(
			`<div class="btn-open-row nu-insert-below" data-toggle="tooltip"
				data-placement="right" title="${__("Insert row below")}">
				<a>${frappe.utils.icon("add", "xs")}</a>
			</div>`
		);
		btn.on("click", (ev) => {
			ev.stopPropagation();
			set_active(grid_row.doc.name);
			grid.add_new_row(grid_row.doc.idx + 1, null, true);
			return false;
		});
		btn.tooltip({ delay: { show: 600, hide: 100 } });

		const edit_btn = grid_row.row.find(".btn-open-row").not(".nu-insert-below").last();
		if (edit_btn.length) {
			edit_btn.before(btn);
		} else {
			grid_row.row.append($('<div class="col"></div>').append(btn));
		}
	};
	$(frm.wrapper).on("grid-row-render.nuje", (e, grid_row) => add_row_button(grid_row));
	(grid.grid_rows || []).forEach(add_row_button);
}


// D2 — Jalali companion under Posting Date. A muted line shows the Shamsi
// equivalent of the stored (Gregorian) date; clicking it swaps in a text
// input where the user types the Shamsi date (YYYY/MM/DD, separators /-.
// accepted) and it is converted and written back as Gregorian. Invalid
// input is rejected in place — the stored value never changes.
function nu_je_render_jalali(frm) {
	const field = frm.fields_dict.posting_date;
	if (!field || !field.$wrapper) return;
	const input_area = field.$wrapper.find(".control-input");
	if (!input_area.length) return;

	let line = input_area.find(".nu-jalali-line");
	if (!line.length) {
		line = $('<div class="nu-jalali-line"></div>').appendTo(input_area);
	}
	if (line.data("editing")) return;

	line.empty();
	const j = nu.jalali.gregorian_to_jalali(frm.doc.posting_date);
	if (!j) return;

	const display = $(
		`<button type="button" class="nu-jalali-text"
			title="${__("Jalali (Shamsi) date — click to enter a Shamsi date and convert it")}">
			<span class="nu-jalali-label">${__("Jalali")}</span> ${j.text}
			<span class="nu-jalali-edit">${frappe.utils.icon("edit", "xs")}</span>
		</button>`
	);
	display.tooltip({ delay: { show: 600, hide: 100 } });
	display.on("click", () => nu_je_edit_jalali(frm, line, j.text));
	line.append(display);
}

function nu_je_edit_jalali(frm, line, current) {
	line.data("editing", true);
	line.empty();

	const input = $(
		`<input type="text" class="nu-jalali-input input-with-feedback form-control"
			placeholder="1405/06/18" dir="ltr">`
	).val(current);
	const hint = $(`<div class="nu-jalali-hint text-muted small">${__("Shamsi date, YYYY/MM/DD")}</div>`);
	line.append(input, hint);
	input.trigger("focus");
	input.trigger("select");

	const finish = (commit) => {
		if (!commit) {
			line.data("editing", false);
			nu_je_render_jalali(frm);
			return;
		}
		const iso = nu.jalali.jalali_to_gregorian(input.val());
		if (iso) {
			line.data("editing", false);
			frm.set_value("posting_date", iso);
		} else {
			input.addClass("nu-jalali-invalid");
			hint
				.removeClass("text-muted")
				.addClass("nu-jalali-error")
				.text(__("Invalid Shamsi date — expected YYYY/MM/DD"));
			input.trigger("focus");
		}
	};

	input.on("keydown", (e) => {
		if (e.key === "Enter") {
			e.preventDefault();
			finish(true);
		} else if (e.key === "Escape") {
			e.preventDefault();
			finish(false);
		}
	});
	input.on("blur", () => {
		// unchanged text → just revert; changed text → try to commit once
		finish(input.val().trim() !== current);
	});
}
