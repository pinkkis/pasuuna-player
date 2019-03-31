import { SoundTracker } from './soundtracker';
import { ProTracker } from './protracker';
import { FastTracker } from './fasttracker';
import { isST } from '../lib/util';

class FileType {
	static get unknown() { return { name: 'UNKNOWN' }; }
	static get unsupported() { return { name: 'UNSUPPORTED' }; }
	static get mod_ProTracker() { return { name: 'PROTRACKER', isMod: true, loader: function () { return new ProTracker() } }; }
	static get mod_SoundTracker() { return { name: 'SOUNDTRACKER', isMod: true, loader: function () { return new SoundTracker() } }; }
	static get mod_FastTracker() { return { name: 'FASTTRACKER', isMod: true, loader: function () { return new FastTracker() } }; }
	static get sample() { return { name: 'SAMPLE', isSample: true }; }
	static get zip() { return { name: 'ZIP' } };
}

export class FileDetector {
	constructor() { }

	detect(file, name) {
		const length = file.length;
		let id = '';
		let ext = '';

		id = file.readString(17, 0);
		if (id == 'Extended Module: ') {
			return FileType.mod_FastTracker;
		}

		if (length > 1100) {
			id = file.readString(4, 1080); // M.K.
		}

		console.log('Format ID: ' + id);

		if (id == 'M.K.') return FileType.mod_ProTracker;
		if (id == 'M!K!') return FileType.mod_ProTracker; // more then 64 patterns
		if (id == 'M&K!') return FileType.mod_ProTracker; // what's different? example https://modarchive.org/index.php?request=view_by_moduleid&query=76607
		if (id == 'FLT4') return FileType.mod_ProTracker;
		if (id == '2CHN') return FileType.mod_ProTracker;
		if (id == '6CHN') return FileType.mod_ProTracker;
		if (id == '8CHN') return FileType.mod_ProTracker;
		if (id == '10CH') return FileType.mod_ProTracker;
		if (id == '12CH') return FileType.mod_ProTracker;
		if (id == '14CH') return FileType.mod_ProTracker;
		if (id == '16CH') return FileType.mod_ProTracker;
		if (id == '18CH') return FileType.mod_ProTracker;
		if (id == '20CH') return FileType.mod_ProTracker;
		if (id == '22CH') return FileType.mod_ProTracker;
		if (id == '24CH') return FileType.mod_ProTracker;
		if (id == '26CH') return FileType.mod_ProTracker;
		if (id == '28CH') return FileType.mod_ProTracker;
		if (id == '30CH') return FileType.mod_ProTracker;
		if (id == '32CH') return FileType.mod_ProTracker;

		if (name && name.length > 4) ext = name.substr(name.length - 4);
		ext = ext.toLowerCase();

		if (ext == '.wav') return FileType.sample;
		if (ext == '.mp3') return FileType.sample;
		if (ext == '.iff') return FileType.sample;
		if (ext == '.zip') return FileType.zip;

		var zipId = file.readString(2, 0);
		if (zipId == 'PK') return FileType.zip;

		// might be an 15 instrument mod?
		// filename should at least contain a '.' this avoids checking all ST-XX samples

		// example: https://modarchive.org/index.php?request=view_by_moduleid&query=35902 or 36954
		// more info: ftp://ftp.modland.com/pub/documents/format_documentation/Ultimate%20Soundtracker%20(.mod).txt

		if (name && name.indexOf('.') >= 0 && length > 1624) {
			const isSoundTracker = isST(file);
			if (isSoundTracker) {
				return FileType.mod_SoundTracker;
			}
		}

		// fallback to sample
		return FileType.sample;
	};
}
