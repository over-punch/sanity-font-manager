// Renders a font/instance name with its subfamily and italic words highlighted, for quick comparison across rows.

import React from 'react';
import { tokenizeName, subfamilyHue } from '../utils/highlightNameTokens';

/** Fixed hue for slant words, kept away from the subfamily hues and the red error colours. */
const ITALIC_COLOR = '#c0559f';

/**
 * Highlights the individual words of a name rather than tinting the whole string: the subfamily gets
 * a colour derived from its own text (so each subfamily reads consistently down a column) and any
 * slant word is tinted and italicised. Plain words keep the inherited colour, so the name stays
 * legible and only the parts that differ between rows stand out.
 */
export function HighlightedName({ name, subfamily }) {
	const tokens = tokenizeName(name, subfamily);
	if (!tokens.length) return null;

	// Derive the hue from the words that actually matched, not the candidate list — so a row shows the
	// colour of ITS subfamily even when a whole family's subfamilies were passed in.
	const matched = tokens.filter((t) => t.role === 'subfamily').map((t) => t.text).join(' ');
	const subfamilyColor = `hsl(${subfamilyHue(matched)}, 62%, 52%)`;

	return (
		<>
			{tokens.map((token, i) => {
				if (token.role === 'subfamily') {
					return <span key={i} style={{ color: subfamilyColor, fontWeight: 600 }}>{token.text}</span>;
				}
				if (token.role === 'italic') {
					return <span key={i} style={{ color: ITALIC_COLOR, fontStyle: 'italic' }}>{token.text}</span>;
				}
				return <span key={i}>{token.text}</span>;
			})}
		</>
	);
}
