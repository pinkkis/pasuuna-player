import { Sample } from '../models/sample';
import { Note } from '../models/note';
import { Instrument } from '../models/instrument';
import { BinaryStream } from '../filesystem';
import { EVENT, LOOPTYPE, TRACKERMODE } from '../enum';
import { processEnvelope, checkEnvelope } from '../lib/util';
import { bus as EventBus } from '../eventBus';

// TODO: has Tracker global ref

export class FastTracker {
	constructor() {}

	// see ftp://ftp.modland.com/pub/documents/format_documentation/FastTracker%202%20v2.04%20(.xm).html
	load(file, name) {
		console.log('loading FastTracker');
		Tracker.setTrackerMode(TRACKERMODE.FASTTRACKER);
		Tracker.clearInstruments(1);

		let mod = {};
		let song = {
			patterns: [],
			instruments: []
		};

		file.litteEndian = true;

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
			Tracker.useLinearFrequency = true;
		} else {
			Tracker.useLinearFrequency = false;
		}

		mod.defaultTempo = file.readWord();
		mod.defaultBPM = file.readWord();

		console.log('File was made in ' + mod.trackerName + ' version ' + mod.trackerVersion);

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
					let note = new Note();
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
			const instrument = new Instrument();

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
				console.error('error', e);
			}

			fileStartPos += instrument.headerSize;
			file.goto(fileStartPos);

			if (instrument.numberOfSamples === 0) {
				const sample = new Sample();
				instrument.samples.push(sample);
			} else {
				if (file.isEOF(1)) {
					console.error('seek past EOF', instrument);
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
					console.log('Reading sample from 0x' + file.index + ' with length of ' + sample.length + (sample.bits === 16 ? ' words' : ' bytes') + ' and repeat length of ' + sample.loop.length);
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

			Tracker.setInstrument(i, instrument);
			instrumentContainer.push({ label: i + ' ' + instrument.name, data: i });

		}

		EventBus.trigger(EVENT.instrumentListChange, instrumentContainer);
		song.instruments = Tracker.getInstruments();

		Tracker.setBPM(mod.defaultBPM);
		Tracker.setAmigaSpeed(mod.defaultTempo);

		this.validate(song);

		return song;
	};


	// build internal
	write(next) {
		const song = Tracker.getSong();
		const instruments = Tracker.getInstruments(); // note: intruments start at index 1, not 0
		const trackCount = Tracker.getTrackCount();
		const version = typeof versionNumber === 'undefined' ? 'dev' : versionNumber;

		let highestPattern = 0;
		for (let i = 0; i < 128; i++) {
			const p = song.patternTable[i] || 0;
			highestPattern = Math.max(highestPattern, p);
		}

		// first get filesize
		const fileSize = 60 + 276;

		for (let i = 0; i <= highestPattern; i++) {
			if (song.patterns[i]) {
				fileSize += (9 + (song.patterns[i].length * trackCount * 5));
			}
		}

		// TODO: trim instrument list;
		for (let i = 1; i < instruments.length; i++) {
			const instrument = instruments[i];

			if (instrument && instrument.hasSamples()) {
				instrument.samples.forEach(function (sample) {
					var len = sample.length;
					if (sample.bits === 16) len *= 2;
					fileSize += 243 + 40 + len;
				});
			} else {
				fileSize += 29;
			}
		}

		let arrayBuffer = new ArrayBuffer(fileSize);
		const file = new BinaryStream(arrayBuffer, false);

		file.writeStringSection('Extended Module: ', 17);
		file.writeStringSection(song.title, 20);
		file.writeByte(26);
		file.writeStringSection('BassoonTracker ' + version, 20);
		file.writeByte(4); // minor version xm format
		file.writeByte(1); // major version xm format

		file.writeDWord(276); // header size;
		file.writeWord(song.length);
		file.writeWord(0); //restart position
		file.writeWord(Tracker.getTrackCount());
		file.writeWord(highestPattern + 1); // number of patterns
		file.writeWord(instruments.length - 1); // number of instruments
		file.writeWord(Tracker.useLinearFrequency ? 1 : 0);
		file.writeWord(Tracker.getAmigaSpeed()); // default tempo
		file.writeWord(Tracker.getBPM()); // default BPM


		//TO CHECK: are most players compatible when we only only write the actual song length instead of all 256?
		for (let i = 0; i < 256; i++) {
			file.writeUByte(song.patternTable[i] || 0);
		}


		// write pattern data
		for (let i = 0; i <= highestPattern; i++) {
			let thisPattern = song.patterns[i];
			let patternLength = 0;
			let patternSize = 0;

			if (thisPattern) {
				patternLength = thisPattern.length;
				patternSize = patternLength * trackCount * 5;
			}

			file.writeDWord(9); // header size;
			file.writeUByte(0); // packing type
			file.writeWord(patternLength);
			file.writeWord(patternSize);

			if (thisPattern) {
				// TODO: packing?
				for (let step = 0, max = thisPattern.length; step < max; step++) {
					const row = thisPattern[step];
					for (let channel = 0; channel < trackCount; channel++) {
						const note = row[channel] || {};
						file.writeUByte(note.index || 0);
						file.writeUByte(note.instrument || 0);
						file.writeUByte(note.volumeEffect || 0);
						file.writeUByte(note.effect || 0);
						file.writeUByte(note.param || 0);
					}
				}
			}
		}

		// write instrument data
		for (let i = 1; i < instruments.length; i++) {
			const instrument = instruments[i];

			if (instrument && instrument.hasSamples()) {
				instrument.numberOfSamples = instrument.samples.length;

				file.writeDWord(243); // header size;
				file.writeStringSection(instrument.name, 22);
				file.writeUByte(0); // instrument type
				file.writeWord(instrument.numberOfSamples); // number of samples

				const volumeEnvelopeType =
					(instrument.volumeEnvelope.enabled ? 1 : 0)
					+ (instrument.volumeEnvelope.sustain ? 2 : 0)
					+ (instrument.volumeEnvelope.loop ? 4 : 0);

				const panningEnvelopeType =
					(instrument.panningEnvelope.enabled ? 1 : 0)
					+ (instrument.panningEnvelope.sustain ? 2 : 0)
					+ (instrument.panningEnvelope.loop ? 4 : 0);


				file.writeDWord(40); // sample header size;
				for (let si = 0; si < 96; si++) {
					file.writeUByte(instrument.sampleNumberForNotes[si] || 0); // sample number for notes
				}

				// volume envelope
				for (let si = 0; si < 12; si++) {
					const point = instrument.volumeEnvelope.points[si] || [0, 0];
					file.writeWord(point[0]);
					file.writeWord(point[1]);
				}
				// panning envelope
				for (let si = 0; si < 12; si++) {
					const point = instrument.panningEnvelope.points[si] || [0, 0];
					file.writeWord(point[0]);
					file.writeWord(point[1]);
				}

				file.writeUByte(instrument.volumeEnvelope.count || 0);
				file.writeUByte(instrument.panningEnvelope.count || 0);
				file.writeUByte(instrument.volumeEnvelope.sustainPoint || 0);
				file.writeUByte(instrument.volumeEnvelope.loopStartPoint || 0);
				file.writeUByte(instrument.volumeEnvelope.loopEndPoint || 0);
				file.writeUByte(instrument.panningEnvelope.sustainPoint || 0);
				file.writeUByte(instrument.panningEnvelope.loopStartPoint || 0);
				file.writeUByte(instrument.panningEnvelope.loopEndPoint || 0);
				file.writeUByte(volumeEnvelopeType);
				file.writeUByte(panningEnvelopeType);
				file.writeUByte(instrument.vibrato.type || 0);
				file.writeUByte(instrument.vibrato.sweep || 0);
				file.writeUByte(instrument.vibrato.depth || 0);
				file.writeUByte(instrument.vibrato.rate || 0);
				file.writeWord(instrument.fadeout || 0);
				file.writeWord(0); // reserved

				// write samples

				// first all sample headers
				for (let sampleI = 0; sampleI < instrument.numberOfSamples; sampleI++) {
					const thisSample = instrument.samples[sampleI];
					let sampleType = 0;

					if (thisSample.loop.length > 2 && thisSample.loop.enabled) {
						sampleType = 1;
					}

					let sampleByteLength = thisSample.length;
					let sampleLoopByteStart = thisSample.loop.start;
					let sampleLoopByteLength = thisSample.loop.length;
					if (thisSample.bits === 16) {
						sampleType += 16;
						sampleByteLength *= 2;
						sampleLoopByteStart *= 2;
						sampleLoopByteLength *= 2;
					}

					file.writeDWord(sampleByteLength);
					file.writeDWord(sampleLoopByteStart);
					file.writeDWord(sampleLoopByteLength);
					file.writeUByte(thisSample.volume);
					file.writeByte(thisSample.finetuneX);
					file.writeUByte(sampleType);
					file.writeUByte((thisSample.panning || 0) + 128);
					file.writeUByte(thisSample.relativeNote || 0);
					file.writeUByte(0);
					file.writeStringSection(thisSample.name || '', 22);
				}

				// then all sample data
				for (let sampleI = 0; sampleI < instrument.numberOfSamples; sampleI++) {
					const thisSample = instrument.samples[sampleI];

					let b;
					let delta = 0;
					let prev = 0;

					if (thisSample.bits === 16) {
						for (let si = 0, max = thisSample.length; si < max; si++) {
							// write 16-bit sample data
							b = Math.round(thisSample.data[si] * 32768);
							delta = b - prev;
							prev = b;

							if (delta < -32768) {
								delta += 65536;
							} else if (delta > 32767) {
								delta -= 65536;
							}

							file.writeWord(delta);
						}
					} else {
						for (let si = 0, max = thisSample.length; si < max; si++) {
							// write 8-bit sample data
							b = Math.round(thisSample.data[si] * 127);
							delta = b - prev;
							prev = b;

							if (delta < -128) {
								delta += 256;
							} else if (delta > 127) {
								delta -= 256;
							}

							file.writeByte(delta);
						}
					}
				}
			} else {
				// empty instrument
				file.writeDWord(29); // header size;
				file.writeStringSection(instrument ? instrument.name : '', 22);
				file.writeUByte(0); // instrument type
				file.writeWord(0); // number of samples
			}
		}

		if (next) next(file);
	}

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
