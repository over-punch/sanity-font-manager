// Splits a font/instance name into words and marks the subfamily and italic tokens, so rows are easy to compare.

/** Words that mark a slanted style. `oblique` and the abbreviated `it` are included. */
const ITALIC_WORDS = new Set(['italic', 'italics', 'oblique', 'it']);

/**
 * Deterministic hue per subfamily, so "Big" is always the same colour within a run and two
 * subfamilies are unlikely to collide. Hashing keeps it stable across renders without any state.
 * @param {string} value - subfamily name
 * @returns {number} hue in degrees, 0–359
 */
export function subfamilyHue(value) {
	let hash = 0;
	const text = String(value || '');
	for (let i = 0; i < text.length; i++) {
		hash = (hash * 31 + text.charCodeAt(i)) % 360;
	}
	// Skew away from the reds reserved for errors, and from the italic hue below.
	return (hash + 190) % 360;
}

/**
 * Breaks a name into tokens tagged by role, preserving the original spacing so the name still reads
 * exactly as entered.
 *
 * A subfamily may be several words ("Text Advanced"), so it is matched as a phrase first; any
 * remaining word that names a slant is tagged italic. Everything else is plain.
 *
 * @param {string} name - the display name, e.g. "Daith Big Bold Italic"
 * @param {string|string[]} [subfamily] - the entry's subfamily, or a list of the family's known
 *   subfamilies to match against (useful when a row has no subfamily of its own yet)
 * @returns {{text: string, role: 'plain'|'subfamily'|'italic'}[]} tokens in order, including whitespace
 */
export function tokenizeName(name, subfamily) {
	const text = String(name || '');
	if (!text) return [];

	// Locate the subfamily phrase (case-insensitive, whole words) so multi-word subfamilies stay intact.
	// Longest candidate first, so "Text Advanced" wins over a bare "Text".
	const candidates = (Array.isArray(subfamily) ? subfamily : [subfamily])
		.map((s) => String(s || '').trim())
		.filter(Boolean)
		.sort((a, b) => b.length - a.length);

	let subRange = null;
	for (const sub of candidates) {
		const escaped = sub.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		// `\b` only anchors against a word character, so a subfamily starting or ending in punctuation
		// (e.g. "(Pro)") would never match if the boundaries were applied unconditionally.
		const lead = /^\w/.test(sub) ? '\\b' : '';
		const trail = /\w$/.test(sub) ? '\\b' : '';
		const match = text.match(new RegExp(`${lead}${escaped}${trail}`, 'i'));
		if (match && match.index != null) {
			subRange = [match.index, match.index + match[0].length];
			break;
		}
	}

	const tokens = [];
	// Split on whitespace but keep the separators, so the rendered name is character-identical.
	const parts = text.split(/(\s+)/);
	let cursor = 0;

	for (const part of parts) {
		const start = cursor;
		cursor += part.length;
		if (!part) continue;

		if (/^\s+$/.test(part)) {
			tokens.push({ text: part, role: 'plain' });
			continue;
		}

		const withinSubfamily = subRange && start >= subRange[0] && start < subRange[1];
		if (withinSubfamily) {
			tokens.push({ text: part, role: 'subfamily' });
			continue;
		}

		const bare = part.replace(/[^a-zA-Z]/g, '').toLowerCase();
		tokens.push({ text: part, role: ITALIC_WORDS.has(bare) ? 'italic' : 'plain' });
	}

	return tokens;
}
