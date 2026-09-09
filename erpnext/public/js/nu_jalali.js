// NU-ERP Jalali (Shamsi) date utilities — desk-global, loaded with the
// erpnext bundle so every surface (form JS, list JS, tree JS) can use it.
//
// The conversion core is vendored from jalaali-js v2 (MIT License,
// Copyright (c) 2020 Behrang Norouzinia — Borkowski's algorithm, exact
// for Jalaali years -61…3177). Presentation helpers mirror the erp4me-web
// utils/jalali.js: all stored/API values stay Gregorian; Jalali is
// presentation-only, and Jalali input converts back to Gregorian.
//
// API:
//   nu_jalali.gregorian_to_jalali("2026-09-09")  → { year, month, day, text: "1405/06/18" } | null
//   nu_jalali.jalali_to_gregorian("1405/06/18")  → "2026-09-09" | null
//   nu_jalali.format("2026-09-09")               → "1405/06/18"
//   nu_jalali.is_valid(1405, 13, 1)              → false

frappe.provide("nu");

(function () {
	const BREAKS = [
		-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262,
		2324, 2394, 2456, 3178,
	];
	const MIN_JY = BREAKS[0];
	const MAX_JY = BREAKS[BREAKS.length - 1] - 1;

	const div = (a, b) => ~~(a / b);
	const mod = (a, b) => a - ~~(a / b) * b;

	function jalCalCore(jy) {
		if (!Number.isFinite(jy) || jy < MIN_JY || jy > MAX_JY) {
			throw new RangeError(`Invalid Jalaali year ${jy}`);
		}
		const gy = jy + 621;
		let leapJ = -14;
		let jp = BREAKS[0];
		let jm = 0;
		let jump = 0;
		for (let i = 1; i < BREAKS.length; i += 1) {
			jm = BREAKS[i];
			jump = jm - jp;
			if (jy < jm) break;
			leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
			jp = jm;
		}
		const n = jy - jp;
		leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
		if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
		const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
		return { gy, march: 20 + leapJ - leapG, jump, n };
	}

	function leapFromCycle(jump, n) {
		let adjusted = n;
		if (jump - n < 6) adjusted = n - jump + div(jump + 4, 33) * 33;
		let leap = mod(mod(adjusted + 1, 33) - 1, 4);
		if (leap === -1) leap = 4;
		return leap;
	}

	function jalCal(jy) {
		const { gy, march, jump, n } = jalCalCore(jy);
		return { leap: leapFromCycle(jump, n), gy, march };
	}

	function isLeapJalaaliYear(jy) {
		if (!Number.isFinite(jy) || jy < MIN_JY || jy > MAX_JY) return false;
		let jp = BREAKS[0];
		let jm = 0;
		let jump = 0;
		for (let i = 1; i < BREAKS.length; i += 1) {
			jm = BREAKS[i];
			jump = jm - jp;
			if (jy < jm) break;
			jp = jm;
		}
		return leapFromCycle(jump, jy - jp) === 0;
	}

	function jalaaliMonthLength(jy, jm) {
		if (jm <= 6) return 31;
		if (jm <= 11) return 30;
		return isLeapJalaaliYear(jy) ? 30 : 29;
	}

	function isValidJalaaliDate(jy, jm, jd) {
		return (
			jy >= MIN_JY &&
			jy <= MAX_JY &&
			jm >= 1 &&
			jm <= 12 &&
			jd >= 1 &&
			jd <= jalaaliMonthLength(jy, jm)
		);
	}

	function g2d(gy, gm, gd) {
		let d =
			div((gy + div(gm - 8, 6) + 100100) * 1461, 4) +
			div(153 * mod(gm + 9, 12) + 2, 5) +
			gd -
			34840408;
		d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
		return d;
	}

	function d2g(jdn) {
		let j = 4 * jdn + 139361631;
		j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
		const i = div(mod(j, 1461), 4) * 5 + 308;
		const gd = div(mod(i, 153), 5) + 1;
		const gm = mod(div(i, 153), 12) + 1;
		const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
		return { gy, gm, gd };
	}

	function j2d(jy, jm, jd) {
		const r = jalCalCore(jy);
		return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
	}

	function d2j(jdn) {
		const gy = d2g(jdn).gy;
		let jy = gy - 621;
		const r = jalCal(jy);
		const jdn1f = g2d(gy, 3, r.march);
		let k = jdn - jdn1f;
		if (k >= 0) {
			if (k <= 185) return { jy, jm: 1 + div(k, 31), jd: mod(k, 31) + 1 };
			k -= 186;
		} else {
			jy -= 1;
			k += 179;
			if (r.leap === 1) k += 1;
		}
		return { jy, jm: 7 + div(k, 30), jd: mod(k, 30) + 1 };
	}

	// ---- presentation helpers (ported from erp4me-web utils/jalali.js) ----

	const JALALI_INPUT_RE = /^(\d{1,4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/;
	const pad = (n) => String(n).padStart(2, "0");

	function gregorian_to_jalali(iso) {
		if (!iso) return null;
		const [gy, gm, gd] = String(iso).slice(0, 10).split("-").map((n) => parseInt(n, 10));
		if (!gy || !gm || !gd) return null;
		try {
			const { jy, jm, jd } = d2j(g2d(gy, gm, gd));
			return { year: jy, month: jm, day: jd, text: `${jy}/${pad(jm)}/${pad(jd)}` };
		} catch (e) {
			return null;
		}
	}

	function jalali_to_gregorian(text) {
		const match = String(text || "").trim().match(JALALI_INPUT_RE);
		if (!match) return null;
		const jy = parseInt(match[1], 10);
		const jm = parseInt(match[2], 10);
		const jd = parseInt(match[3], 10);
		if (!isValidJalaaliDate(jy, jm, jd)) return null;
		try {
			const { gy, gm, gd } = d2g(j2d(jy, jm, jd));
			return `${gy}-${pad(gm)}-${pad(gd)}`;
		} catch (e) {
			return null;
		}
	}

	nu.jalali = {
		gregorian_to_jalali,
		jalali_to_gregorian,
		is_valid: isValidJalaaliDate,
		format: (iso, fallback = "—") => {
			const j = gregorian_to_jalali(iso);
			return j ? j.text : fallback;
		},
	};
})();
