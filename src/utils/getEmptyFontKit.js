// Parses font files and returns name/subfamily metadata groupings without writing to Sanity

import { parseFont } from './parseFont';
import { getNameString, getVariationAxes } from './fontHelpers';
import slugify from 'slugify';

/** Reads font files and returns name/subfamily metadata without writing to Sanity */
export async function getEmptyFontKit({ title, files, weightKeywordList, italicKeywordList }) {

	let fontNames = {};
	let subfamilies = {};

	for (var i = 0; i < files.length; i++) {

		const file = files[i];
		const fontBuffer = await readFontFile(file);
		const font = await parseFont(fontBuffer, file.name);

		let weightName = getNameString(font, 17) || getNameString(font, 2) || '';

		const axes = getVariationAxes(font);
		let variableFont = axes !== null;
		const familyName = getNameString(font, 1);
		const fullName = getNameString(font, 4);
		let subfamilyName = familyName.toLowerCase().trim().replace(title.toLowerCase().trim(), '').trim();
		let fontTitle = fullName.toLowerCase().trim();

		weightKeywordList.forEach(keyword => {
			const kw = keyword.toLowerCase().trim();

			if (fontTitle.includes(kw)) {
				fontTitle = fontTitle.replace(kw, '');
			}
			if (subfamilyName.includes(kw)) {
				subfamilyName = subfamilyName.replace(kw, '');
			}
		});

		italicKeywordList.forEach(keyword => {
			const kw = keyword.toLowerCase().trim();

			if (subfamilyName.includes(kw)) {
				subfamilyName = subfamilyName.replace(kw, '');
			}
			if (fontTitle.includes(kw)) {
				fontTitle = fontTitle.replace(kw, '');
			}
		});

		fontTitle = fontTitle.trim().split(' ').map(word => word[0].toUpperCase() + word.slice(1)).join(' ');

		subfamilyName = subfamilyName.trim();
		subfamilyName = (subfamilyName == '') ? 'Regular' : subfamilyName.split(' ').map(word => word[0].toUpperCase() + word.slice(1)).join(' ');


		let id = slugify(fontTitle.toLowerCase().trim());
		if (variableFont && !id.endsWith('-vf')) {
			id = id + '-vf';
			fontTitle = fontTitle + ' VF';
		}

		// add subfamily to list
		if (!subfamilies[id]) {
			subfamilies[id] = [subfamilyName];
		} else if (subfamilies[id].indexOf(subfamilyName) == -1) {
			subfamilies[id] = [...subfamilies[id], subfamilyName];
		}

		if (!fontNames[id]) {
			fontNames[id] = [{
				file: file.name,
				fullName: fullName,
				familyName: familyName,
				subFamily: subfamilyName,
			}];
		} else if (fontNames[id].indexOf(file.name) == -1) {
			fontNames[id].push({
				file: file.name,
				fullName: fullName,
				familyName: familyName,
				subFamily: subfamilyName,
			})
		}
	}

	console.log('Font names:', fontNames);
}

/** Reads a font file and returns its content as an ArrayBuffer */
const readFontFile = (file) => {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();

		reader.onload = (event) => {
			resolve(event.target.result);
		};

		reader.onerror = (error) => { reject(error); };
		reader.readAsArrayBuffer(file);
	});
};
