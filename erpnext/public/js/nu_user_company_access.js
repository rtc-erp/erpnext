// NU-ERP User form extension: "Company Access" tab (user request:
// per-company access definable per user — everyone sees one company,
// only selected users see another). Purely additive: a doctype_js hook
// entry, no stock file touched, zero backend change — it manages
// standard Frappe User Permission records (allow = Company,
// apply_to_all_doctypes = 1), the same mechanism the old erp4me app
// used (DEC-ERP-005), so list views, reports via permission query, and
// the desk all enforce it through the stock engine.
//
// Stock semantics the tab makes explicit:
//   - A user with NO Company user-permissions is UNRESTRICTED (sees
//     every company). "Only selected users see company B" therefore
//     means: restrict everyone else (e.g. to company A), not "uncheck
//     B" — the tab explains this inline.
//   - The first checked company becomes the default (is_default).
//
// The tab is injected into the form tab strip (replicating stock's Tab
// markup) after "Roles & Permissions", for saved users only.

frappe.ui.form.on("User", {
	refresh(frm) {
		nu_user_company_access(frm);
	},
});

const NU_CA_TAB_ID = "user-nu_company_access";

function nu_user_company_access(frm) {
	if (!frm.doc.name || frm.is_new()) return;

	// frm.page is a plain object in v16 (not a DOM node) — locate the tab
	// strip in the visible page container instead.
	const page = [...document.querySelectorAll(".page-container")].find(
		(p) => p.offsetParent !== null
	);
	if (!page) return;
	const tab_container = $(page).find(".form-tabs");
	const tabs_content = $(page).find(".form-tab-content");
	if (!tab_container.length || !tabs_content.length) return;
	if (tab_container.find(`#${NU_CA_TAB_ID}-tab`).length) {
		nu_ca_load_state(frm);
		return;
	}

	// tab link (stock Tab markup)
	const anchor = tab_container
		.find('.nav-link[data-fieldname="roles_permissions_tab"]')
		.closest(".nav-item");
	const link = $(
		`<li class="nav-item">
			<button class="nav-link" id="${NU_CA_TAB_ID}-tab" data-toggle="tab"
				data-fieldname="nu_company_access" type="button" role="tab"
				aria-controls="${NU_CA_TAB_ID}">${__("Company Access")}</button>
		</li>`
	);
	if (anchor.length) link.insertAfter(anchor);
	else link.appendTo(tab_container);

	// pane
	const pane = $(
		`<div class="tab-pane fade" id="${NU_CA_TAB_ID}" role="tabpanel"
			aria-labelledby="${NU_CA_TAB_ID}-tab"></div>`
	).appendTo(tabs_content);

	// activation: ours behaves like a stock tab; stock tabs deactivate ours.
	// (bind directly on the stock links — the layout's delegated handler on
	// the container calls stopImmediatePropagation, so a delegated listener
	// there would never fire)
	link.find(".nav-link").on("click", (e) => {
		e.preventDefault();
		tab_container.find(".nav-link").removeClass("active");
		tabs_content.children(".tab-pane").removeClass("show active");
		link.find(".nav-link").addClass("active");
		pane.addClass("show active");
	});
	tab_container
		.find(".nav-link")
		.not(link.find(".nav-link")[0])
		.on("click.nu_ca_off", () => {
			link.find(".nav-link").removeClass("active");
			pane.removeClass("show active");
		});

	nu_ca_render_shell(frm, pane);
	nu_ca_load_state(frm);
}

function nu_ca_render_shell(frm, pane) {
	const is_admin = frm.doc.name === "Administrator";
	const can_edit =
		!is_admin &&
		frappe.boot.user.can_create.includes("User Permission") &&
		frappe.boot.user.can_delete.includes("User Permission");

	pane.html(`
		<div class="form-section nu-ca-section">
			<div class="nu-ca-head">
				<h6>${__("Company Access")}</h6>
				<p class="text-muted small nu-ca-help"></p>
			</div>
			<div class="nu-ca-companies"></div>
			<div class="nu-ca-actions">
				<button class="btn btn-primary btn-sm nu-ca-save">${__("Save Access")}</button>
				<span class="nu-ca-status text-muted small"></span>
			</div>
		</div>
	`);

	const help = pane.find(".nu-ca-help");
	if (is_admin) {
		help.text(__("Administrator always has full access to every company."));
		pane.find(".nu-ca-save").hide();
	} else {
		help.html(
			__(
				"Checked companies are the only ones this user can see. " +
					"If every box is unchecked, the user is unrestricted and sees ALL companies. " +
					"The first checked company becomes their default."
			)
		);
	}
	if (!can_edit && !is_admin) {
		pane.find(".nu-ca-save").hide();
		help.append(" " + __("Only a System Manager can change this."));
	}
	pane.data("can_edit", can_edit);

	pane.find(".nu-ca-save").on("click", () => nu_ca_save(frm, pane));
}

async function nu_ca_load_state(frm) {
	const pane = $(`#${NU_CA_TAB_ID}`);
	if (!pane.length) return;
	const can_edit = pane.data("can_edit");

	const [companies, perms] = await Promise.all([
		frappe
			.call({
				method: "frappe.client.get_list",
				args: {
					doctype: "Company",
					fields: ["name"],
					order_by: "name asc",
					limit_page_length: 100,
				},
			})
			.then((r) => r.message || []),
		frappe
			.call({
				method: "frappe.client.get_list",
				args: {
					doctype: "User Permission",
					filters: { user: frm.doc.name, allow: "Company" },
					fields: ["name", "for_value", "is_default"],
					limit_page_length: 100,
				},
			})
			.then((r) => r.message || []),
	]);

	pane.data("perms", perms);
	const permitted = new Set(perms.map((p) => p.for_value));
	const host = pane.find(".nu-ca-companies").empty();

	if (!companies.length) {
		host.html(`<div class="text-muted">${__("No companies found.")}</div>`);
		return;
	}
	for (const c of companies) {
		const row = $(
			`<label class="nu-ca-company">
				<input type="checkbox">
				<span class="nu-ca-name"></span>
				<span class="nu-ca-default text-muted small">${__("default")}</span>
			</label>`
		);
		row
			.find("input")
			.attr("data-company", c.name)
			.prop("checked", permitted.has(c.name))
			.prop("disabled", !can_edit);
		row.find(".nu-ca-name").text(c.name);
		row.find("input").on("change", () => nu_ca_sync_default_marker(pane));
		host.append(row);
	}
	nu_ca_sync_default_marker(pane);
}

// mark which checked company would be the default (first one)
function nu_ca_sync_default_marker(pane) {
	const boxes = pane.find(".nu-ca-company input");
	pane.find(".nu-ca-default").hide();
	const first = boxes.filter(":checked").first().closest("label");
	if (first.length) first.find(".nu-ca-default").show();
	if (!boxes.filter(":checked").length) {
		pane.find(".nu-ca-status").text(__("Unrestricted — sees all companies."));
	} else {
		pane.find(".nu-ca-status").text("");
	}
}

async function nu_ca_save(frm, pane) {
	const wanted = pane
		.find(".nu-ca-company input:checked")
		.map((i, el) => $(el).attr("data-company"))
		.get();
	const perms = pane.data("perms") || [];
	const current = new Map(perms.map((p) => [p.for_value, p]));
	const status = pane.find(".nu-ca-status");

	pane.find(".nu-ca-save").prop("disabled", true);
	status.text(__("Saving..."));
	try {
		const tasks = [];
		// deletions
		for (const [company, perm] of current) {
			if (!wanted.includes(company)) {
				tasks.push(() =>
					frappe.call({
						method: "frappe.client.delete",
						args: { doctype: "User Permission", name: perm.name },
					})
				);
			}
		}
		// additions
		for (const company of wanted) {
			if (!current.has(company)) {
				tasks.push(() =>
					frappe.call({
						method: "frappe.client.insert",
						args: {
							doc: {
								doctype: "User Permission",
								user: frm.doc.name,
								allow: "Company",
								for_value: company,
								apply_to_all_doctypes: 1,
								is_default: wanted[0] === company ? 1 : 0,
							},
						},
					})
				);
			}
		}
		await frappe.run_serially(tasks);
		// is_default reconciliation (first checked = default)
		const refreshed = await frappe
			.call({
				method: "frappe.client.get_list",
				args: {
					doctype: "User Permission",
					filters: { user: frm.doc.name, allow: "Company" },
					fields: ["name", "for_value", "is_default"],
					limit_page_length: 100,
				},
			})
			.then((r) => r.message || []);
		const fixes = refreshed
			.filter((p) => cint(p.is_default) !== (p.for_value === wanted[0] ? 1 : 0))
			.map((p) => () =>
				frappe.call({
					method: "frappe.client.set_value",
					args: {
						doctype: "User Permission",
						name: p.name,
						fieldname: "is_default",
						value: p.for_value === wanted[0] ? 1 : 0,
					},
				})
			);
		await frappe.run_serially(fixes);

		frappe.show_alert({
			message: wanted.length
				? __("Company access saved: {0} can see {1}.", [
						frm.doc.name,
						wanted.join(", "),
				  ])
				: __("Company access saved: {0} is unrestricted (sees all companies).", [
						frm.doc.name,
				  ]),
			indicator: "green",
		});
		await nu_ca_load_state(frm);
	} catch (e) {
		status.text(__("Save failed — see message."));
	} finally {
		pane.find(".nu-ca-save").prop("disabled", false);
	}
}
