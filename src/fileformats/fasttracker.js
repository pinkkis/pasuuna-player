import { Sample } from '../models/sample';
import { Note } from '../models/note';
import { Instrument } from '../models/instrument';
import { EVENT, LOOPTYPE, TRACKERMODE } from '../enum';
import { processEnvelope, checkEnvelope } from '../lib/util';
import { events } from '../events';

export class FastTracker {
	constructor(tracker) {
		this.tracker = tracker;
	}

	// see ftp://ftp.modland.com/pub/documents/format_documentation/FastTracker%202%20v2.04%20(.xm).html
	load(file) {
		this.tracker.setTrackerMode(TRACKERMODE.FASTTRACKER);
		this.tracker.clearInstruments(1);

		const mod = {};
		const song = {
			patterns: [],
			instruments: []
		};

		file.littleEndian = true;

		file.goto(17);
		song.title = file.readString(20);
		file.jump(1); //$1a

		mod.trackerName = file.readString(20);
		mod.trackerVersion = file.readByte();
		mod.trackerVersion = file.readByte() + '.' + mod.trackerVersion;
		mod.headerSize = file.readDWord(); // is this always 276?
		mod.songlength = file.readWord();
		mod.restartPosition = file.readWord();
		mod.numberOfChannels = file.readWord();
		mod.numberOfPatterns = file.readWord(); // this is sometimes more then the actual number? should we scan for highest pattern? -> YES! -> NO!
		mod.numberOfInstruments = file.readWord();
		mod.flags = file.readWord();
		if (mod.flags % 2 === 1) {
			this.tracker.useLinearFrequency = true;
		} else {
			this.tracker.useLinearFrequency = false;
		}

		mod.defaultTempo = file.readWord();
		mod.defaultBPM = file.readWord();

		const patternTable = [];
		let highestPattern = 0;

		for (let i = 0; i < mod.songlength; ++i) {
			patternTable[i] = file.readUbyte();
			if (highestPattern < patternTable[i]) highestPattern = patternTable[i];
		}

		song.patternTable = patternTable;
		song.length = mod.songlength;
		song.channels = mod.numberOfChannels;
		song.restartPosition = (mod.restartPosition + 1);

		let fileStartPos = 60 + mod.headerSize;
		file.goto(fileStartPos);

		for (let i = 0; i < mod.numberOfPatterns; i++) {
			const patternData = [];
			const thisPattern = {};

			thisPattern.headerSize = file.readDWord();
			thisPattern.packingType = file.readUbyte(); // always 0
			thisPattern.patternLength = file.readWord();
			thisPattern.patternSize = file.readWord();

			fileStartPos += thisPattern.headerSize;
			file.goto(fileStartPos);

			for (let step = 0; step < thisPattern.patternLength; step++) {
				let row = [];
				let channel;
				for (channel = 0; channel < mod.numberOfChannels; channel++) {
					let note = new Note(this.tracker);
					let v = file.readUbyte();

					if (v & 128) {
						if (v & 1) note.setIndex(file.readUbyte());
						if (v & 2) note.instrument = file.readUbyte();
						if (v & 4) note.volumeEffect = file.readUbyte();
						if (v & 8) note.effect = file.readUbyte();
						if (v & 16) note.param = file.readUbyte();
					} else {
						note.setIndex(v);
						note.instrument = file.readUbyte();
						note.volumeEffect = file.readUbyte();
						note.effect = file.readUbyte();
						note.param = file.readUbyte();
					}

					row.push(note);
				}
				patternData.push(row);
			}

			fileStartPos += thisPattern.patternSize;
			file.goto(fileStartPos);

			song.patterns.push(patternData);
		}

		const instrumentContainer = [];

		for (let i = 1; i <= mod.numberOfInstruments; ++i) {
			const instrument = new Instrument(this.tracker);

			try {
				instrument.filePosition = file.index;
				instrument.headerSize = file.readDWord();

				instrument.name = file.readString(22);
				instrument.type = file.readUbyte();
				instrument.numberOfSamples = file.readWord();
				instrument.samples = [];
				instrument.sampleHeaderSize = 0;

				if (instrument.numberOfSamples > 0) {
					instrument.sampleHeaderSize = file.readDWord();

					// some files report incorrect sampleheadersize (18, without the samplename)
					// e.g. dubmood - cybernostra weekends.xm
					// sample header should be at least 40 bytes
					instrument.sampleHeaderSize = Math.max(instrument.sampleHeaderSize, 40);

					// and not too much ... (Files saved with sk@letracker)
					if (instrument.sampleHeaderSize > 200) instrument.sampleHeaderSize = 40;

					//should we assume it's always 40? not according to specs ...
					for (let si = 0; si < 96; si++) {
						instrument.sampleNumberForNotes.push(file.readUbyte());
					}
					for (let si = 0; si < 24; si++) {
						instrument.volumeEnvelope.raw.push(file.readWord());
					}
					for (let si = 0; si < 24; si++) {
						instrument.panningEnvelope.raw.push(file.readWord());
					}

					instrument.volumeEnvelope.count = file.readUbyte();
					instrument.panningEnvelope.count = file.readUbyte();
					instrument.volumeEnvelope.sustainPoint = file.readUbyte();
					instrument.volumeEnvelope.loopStartPoint = file.readUbyte();
					instrument.volumeEnvelope.loopEndPoint = file.readUbyte();
					instrument.panningEnvelope.sustainPoint = file.readUbyte();
					instrument.panningEnvelope.loopStartPoint = file.readUbyte();
					instrument.panningEnvelope.loopEndPoint = file.readUbyte();
					instrument.volumeEnvelope.type = file.readUbyte();
					instrument.panningEnvelope.type = file.readUbyte();
					instrument.vibrato.type = file.readUbyte();
					instrument.vibrato.sweep = file.readUbyte();
					instrument.vibrato.depth = Math.min(file.readUbyte(), 15); // some trackers have a different scale here? (e.g. Ambrozia)
					instrument.vibrato.rate = file.readUbyte();
					instrument.fadeout = file.readWord();
					instrument.reserved = file.readWord();
					instrument.volumeEnvelope = processEnvelope(instrument.volumeEnvelope);
					instrument.panningEnvelope = processEnvelope(instrument.panningEnvelope);

				}
			} catch (e) {
				console.error('Pasuuna trakcer error', e);
			}

			fileStartPos += instrument.headerSize;
			file.goto(fileStartPos);

			if (instrument.numberOfSamples === 0) {
				const sample = new Sample();
				instrument.samples.push(sample);
			} else {
				if (file.isEOF(1)) {
					console.error('Pasuuna seek past EOF', instrument);
					break;
				}

				for (let sampleI = 0; sampleI < instrument.numberOfSamples; sampleI++) {
					const sample = new Sample();

					sample.length = file.readDWord();
					sample.loop.start = file.readDWord();
					sample.loop.length = file.readDWord();
					sample.volume = file.readUbyte();
					sample.finetuneX = file.readByte();
					sample.type = file.readUbyte();
					sample.panning = file.readUbyte() - 128;
					sample.relativeNote = file.readByte();
					sample.reserved = file.readByte();
					sample.name = file.readString(22);
					sample.bits = 8;

					instrument.samples.push(sample);
					fileStartPos += instrument.sampleHeaderSize;

					file.goto(fileStartPos);
				}

				for (let sampleI = 0; sampleI < instrument.numberOfSamples; sampleI++) {
					const sample = instrument.samples[sampleI];
					if (!sample.length) continue;

					fileStartPos += sample.length;

					if (sample.type & 16) {
						sample.bits = 16;
						sample.type ^= 16;
						sample.length >>= 1;
						sample.loop.start >>= 1;
						sample.loop.length >>= 1;
					}
					sample.loop.type = sample.type || 0;
					sample.loop.enabled = !!sample.loop.type;

					// sample data
					// console.log('Reading sample from 0x' + file.index + ' with length of ' + sample.length + (sample.bits === 16 ? ' words' : ' bytes') + ' and repeat length of ' + sample.loop.length);
					const sampleEnd = sample.length;

					let old = 0;
					if (sample.bits === 16) {
						for (let j = 0; j < sampleEnd; j++) {
							const b = file.readShort() + old;
							if (b < -32768) b += 65536;
							else if (b > 32767) b -= 65536;
							old = b;
							sample.data.push(b / 32768);
						}
					} else {
						for (let j = 0; j < sampleEnd; j++) {
							const b = file.readByte() + old;
							if (b < -128) {
								b += 256;
							} else if (b > 127) {
								b -= 256;
							}

							old = b;
							sample.data.push(b / 127); // TODO: or /128 ? seems to introduce artifacts - see test-loop-fadeout.xm
						}
					}

					// unroll ping pong loops
					if (sample.loop.type === LOOPTYPE.PINGPONG) {
						// TODO: keep original sample?
						const loopPart = sample.data.slice(sample.loop.start, sample.loop.start + sample.loop.length);

						sample.data = sample.data.slice(0, sample.loop.start + sample.loop.length);
						sample.data = sample.data.concat(loopPart.reverse());
						sample.loop.length = sample.loop.length * 2;
						sample.length = sample.loop.start + sample.loop.length;
					}

					file.goto(fileStartPos);
				}
			}

			instrument.setSampleIndex(0);

			this.tracker.setInstrument(i, instrument);
			instrumentContainer.push({ label: i + ' ' + instrument.name, data: i });

		}

		events.emit(EVENT.instrumentListChange, instrumentContainer);
		song.instruments = this.tracker.getInstruments();

		this.tracker.setBPM(mod.defaultBPM);
		this.tracker.setAmigaSpeed(mod.defaultTempo);

		this.validate(song);

		return song;
	};

	validate(song) {
		song.instruments.forEach((instrument) => {
			// check envelope
			instrument.volumeEnvelope = checkEnvelope(instrument.volumeEnvelope, 'volume');
			instrument.panningEnvelope = checkEnvelope(instrument.panningEnvelope, 'panning');

			// check sampleIndexes;
			const maxSampleIndex = instrument.samples.length - 1;
			for (let i = 0, max = instrument.sampleNumberForNotes.length; i < max; i++) {
				instrument.sampleNumberForNotes[i] = Math.min(instrument.sampleNumberForNotes[i], maxSampleIndex);
			}
		})
	};

}
