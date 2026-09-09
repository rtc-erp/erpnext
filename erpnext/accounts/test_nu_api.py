"""Regression tests for erpnext.accounts.nu_api (NU-ERP, additive).

Mirrors the erp4me backend shim test: a draft Journal Entry contributes
in-transit Dr/Cr (rolled up through account groups); once submitted it
leaves the in-transit set (posted balances are stock's
get_account_balances_coa territory). Cancelled is excluded.
"""

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import nowdate

from erpnext.accounts.nu_api import get_draft_journal_balances


class TestDraftJournalBalances(IntegrationTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.company = frappe.defaults.get_defaults().get("company") or frappe.get_all(
			"Company", limit=1, pluck="name"
		)[0]
		cls.accounts = frappe.get_all(
			"Account",
			filters={
				"company": cls.company,
				"is_group": 0,
				"account_type": ["not in", ("Receivable", "Payable")],
			},
			fields=["name", "parent_account"],
			limit=2,
		)
		if len(cls.accounts) < 2:
			raise frappe.ValidationError("need two ledger accounts for the test JV")

	def _make_je(self, amount=40.0, submit=False):
		company_currency = frappe.get_cached_value("Company", self.company, "default_currency")

		def row(account, dr, cr):
			# JE validation recomputes debit/credit from the account-currency
			# amounts (mirroring the desk form), so both must be supplied.
			return {
				"account": account,
				"debit": dr,
				"credit": cr,
				"debit_in_account_currency": dr,
				"credit_in_account_currency": cr,
				"account_currency": company_currency,
				"exchange_rate": 1,
			}

		je = frappe.get_doc(
			{
				"doctype": "Journal Entry",
				"voucher_type": "Journal Entry",
				"company": self.company,
				"posting_date": nowdate(),
				"accounts": [
					row(self.accounts[0].name, amount, 0),
					row(self.accounts[1].name, 0, amount),
				],
			}
		).insert()
		if submit:
			je.submit()
		return je

	def _transit(self, account):
		data = get_draft_journal_balances(self.company)
		row = next((d for d in data if d["value"] == account), None)
		return row or {
			"transit_debit": 0.0,
			"transit_credit": 0.0,
		}

	def test_draft_shows_in_transit(self):
		before = self._transit(self.accounts[0].name)["transit_debit"]
		je = self._make_je(40.0)
		try:
			row = self._transit(self.accounts[0].name)
			self.assertEqual(row["transit_debit"] - before, 40.0)
			# rolled up through the parent group
			parent = self._transit(self.accounts[0].parent_account)
			self.assertGreaterEqual(parent["transit_debit"], row["transit_debit"])
			# balance lives in posted GL (stock), transit is draft-only
			je.submit()
			after = self._transit(self.accounts[0].name)
			self.assertEqual(after["transit_debit"], before)
		finally:
			if je.docstatus == 1:
				je.cancel()
			else:
				je.delete()

	def test_cancelled_excluded(self):
		before = self._transit(self.accounts[0].name)["transit_debit"]
		je = self._make_je(55.0)
		je.delete()  # draft delete removes rows entirely
		self.assertEqual(self._transit(self.accounts[0].name)["transit_debit"], before)

		je = self._make_je(55.0, submit=True)
		je.cancel()
		self.assertEqual(self._transit(self.accounts[0].name)["transit_debit"], before)
