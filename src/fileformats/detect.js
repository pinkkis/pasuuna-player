import { SoundTracker } from './soundtracker';
import { ProTracker } from './protracker';
import { FastTracker } from './fasttracker';
import { isST } from '../lib/util';

class FileType {
	constructor(name, isMod, loader) {
		this.name = name;
		this.isMod = isMod;
		this.loader = loader;
	}
}

export class FileDetector {
	constructor(tracker) {
		this.tracker = tracker;
		this.filetypes = {
			unknown: new FileType('UNKNOWN', null, null),
			unsupported: new FileType('UNSUPPORTED', null, null),
			mod_ProTracker: new FileType('PROTRACKER', true, () => new ProTracker(tracker) ),
			mod_SoundTracker: new FileType('SOUNDTRACKER', true, () => new SoundTracker(tracker) ),
			mod_FastTracker: new FileType('FASTTRACKER', true, () => new FastTracker(tracker) ),
		}
	}

	detect(file, name) {
		const length = file.length;
		let id = '';
		let ext = '';

		id = file.readString(17, 0);
		if (id == 'Extended Module: ') {
			return this.filetypes.mod_FastTracker;
		}

		if (length > 1100) {
			id = file.readString(4, 1080); // M.K.
		}

		console.log('Format ID: ' + id);

		const fmts = ['M.K.', 'M!K!', 'M&K!', 'FLT4', '2CHN', '6CHN', '8CHN', '10CH', '12CH', '14CH', '16CH', '18CH', '20CH', '22CH', '24CH', '26CH', '28CH', '30CH', '32CH'];

		if (fmts.includes(id)) {
			return this.filetypes.mod_ProTracker;
		}

		// might be an 15 instrument mod?
		// filename should at least contain a '.' this avoids checking all ST-XX samples

		// example: https://modarchive.org/index.php?request=view_by_moduleid&query=35902 or 36954
		// more info: ftp://ftp.modland.com/pub/documents/format_documentation/Ultimate%20Soundtracker%20(.mod).txt

		if (name && name.indexOf('.') >= 0 && length > 1624) {
			const isSoundTracker = isST(file);
			if (isSoundTracker) {
				return this.filetypes.mod_SoundTracker;
			}
		}

		// fallback to sample
		return this.filetypes.unsupported;
	};
}
