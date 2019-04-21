export function getUrlParameter(param) {
	if (window.location.getParameter) {
		return window.location.getParameter(param);
	} else if (location.search) {
		const parts = location.search.substring(1).split('&');
		for (let i = 0; i < parts.length; i++) {
			const nv = parts[i].split('=');
			if (!nv[0]) continue;
			if (nv[0] == param) {
				return nv[1] || true;
			}
		}
	}
}

export function processEnvelope(envelope) {
	envelope.points = [];

	for (let si = 0; si < 12; si++) {
		envelope.points.push(envelope.raw.slice(si * 2, si * 2 + 2));
	}

	if (envelope.type & 1) { // on
		envelope.enabled = true;
	}

	if (envelope.type & 2) {
		// sustain
		envelope.sustain = true;
	}

	if (envelope.type & 4) {
		// loop
		envelope.loop = true;
	}

	return envelope;
}

export function checkEnvelope(envelope, type) {
	let isValid = true;
	if (envelope.points && envelope.points[0]) {
		if (envelope.points[0][0] === 0) {
			let c = 0;
			for (let i = 1; i < envelope.count; i++) {
				const point = envelope.points[i];
				if (point && point[0] > c) {
					c = point[0];
				} else {
					isValid = false;
				}
			}
		} else {
			isValid = false;
		}
	} else {
		isValid = false;
	}

	if (isValid) {
		return envelope;
	} else {
		console.warn('Invalid envelope, resetting to default');
		return type === 'volume'
			? { raw: [], enabled: false, points: [[0, 48], [10, 64], [20, 40], [30, 18], [40, 28], [50, 18]], count: 6 }
			: { raw: [], enabled: false, points: [[0, 32], [20, 40], [40, 24], [60, 32], [80, 32]], count: 5 };
	}
}

export function isAcii(byte) {
	return byte < 128;
}

export function isST(file) {
	console.log('Checking for old 15 instrument soundtracker format');

	file.goto(0);

	for (let i = 0; i < 20; i++) {
		if (!isAcii(file.readByte())) {
			return false;
		}
	}

	console.log('First 20 chars are ascii, checking Samples');

	// check samples
	let totalSampleLength = 0;
	let probability = 0;
	for (let s = 0; s < 15; s++) {
		for (let i = 0; i < 22; i++) {
			if (!isAcii(file.readByte())) {
				return false;
			}
		}

		file.jump(-22);
		const name = file.readString(22);

		if (name.toLowerCase().substr(0, 3) == 'st-') {
			probability += 10;
		}

		if (probability > 20) {
			return true;
		}

		totalSampleLength += file.readWord();
		file.jump(6);
	}

	if (totalSampleLength * 2 + 1624 > length) {
		return false;
	}

	return true;
}

export function loadFile(url, next) {
	const req = new XMLHttpRequest();
	req.open('GET', url, true);
	req.responseType = 'arraybuffer';
	req.onload = (event) => {
		const arrayBuffer = req.response;
		if (arrayBuffer) {
			if (next) next(arrayBuffer);
		} else {
			console.error('unable to load', url);
			if (next) {
				next(false);
			}
		}
	};
	req.send(null);
}
