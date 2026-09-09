"""NU-ERP additive accounts API.

Endpoints layered on top of stock ERPNext for the desk UI. Every function
here is new — no stock module is modified — so upstream merges stay clean.

Ported from the erp4me-web backend shim (erpnext.erp4me.frontend_api).
"""

import frappe
from frappe.utils import flt

from erpnext.accounts.utils import get_currency_precision


@frappe.whitelist()
def get_draft_journal_balances(company: str) -> list[dict]:
	"""In-transit (draft, docstatus = 0) Journal Entry Dr/Cr per account.

	Mirrors the old app's get_account_balances shim, feedback item #34:
	draft/unapproved journal entries must be visible in the Chart of
	Accounts separately from the posted balance so users can verify a
	document was recorded correctly before it hits the books.

	Posted balances come from `tabGL Entry` (stock), which only holds
	submitted vouchers; in-transit amounts therefore read the draft
	vouchers' `tabJournal Entry Account` rows directly. docstatus = 0
	covers both Draft and Pending Approval workflow states (approval
	workflow keeps docstatus 0 until Approve submits); cancelled is
	excluded. Amounts roll up through account groups exactly like
	erpnext.accounts.utils.get_account_balances_coa (lft order, reversed
	accumulation into parent_account).
	"""
	if not frappe.has_permission("GL Entry", "read"):
		return []

	precision = get_currency_precision()
	company_currency = frappe.get_cached_value("Company", company, "default_currency")

	account_list = frappe.get_list(
		"Account",
		fields=["name", "parent_account", "account_currency", "is_group"],
		filters={"company": company},
		order_by="lft",
	)

	transit = {
		account.get("name"): {
			"transit_debit": 0.0,
			"transit_credit": 0.0,
			"transit_debit_in_account_currency": 0.0,
			"transit_credit_in_account_currency": 0.0,
		}
		for account in account_list
	}

	rows = frappe.db.sql(
		"""
		SELECT
			jea.account AS account,
			SUM(ROUND(jea.debit, %(precision)s)) AS transit_debit,
			SUM(ROUND(jea.credit, %(precision)s)) AS transit_credit,
			SUM(ROUND(jea.debit_in_account_currency, %(precision)s)) AS transit_debit_in_account_currency,
			SUM(ROUND(jea.credit_in_account_currency, %(precision)s)) AS transit_credit_in_account_currency
		FROM `tabJournal Entry Account` jea
		INNER JOIN `tabJournal Entry` je ON je.name = jea.parent
		WHERE je.company = %(company)s AND je.docstatus = 0
		GROUP BY jea.account
		""",
		{"company": company, "precision": precision},
		as_dict=True,
	)

	for row in rows:
		if row.account in transit:
			transit[row.account] = {
				"transit_debit": flt(row.transit_debit),
				"transit_credit": flt(row.transit_credit),
				"transit_debit_in_account_currency": flt(row.transit_debit_in_account_currency),
				"transit_credit_in_account_currency": flt(row.transit_credit_in_account_currency),
			}

	# roll up through account groups (same algorithm as stock's
	# get_account_balances_coa: children follow parents in lft order,
	# so reversed accumulation lands every descendant in its ancestors)
	for account in reversed(account_list):
		parent = account.get("parent_account")
		if parent and parent in transit:
			for key in transit[parent]:
				transit[parent][key] += transit[account.get("name")][key]

	return [
		{
			"value": account.get("name"),
			"is_group": account.get("is_group"),
			"company_currency": company_currency,
			"account_currency": account.get("account_currency"),
			**transit[account.get("name")],
		}
		for account in account_list
		if transit[account.get("name")]["transit_debit"]
		or transit[account.get("name")]["transit_credit"]
	]
