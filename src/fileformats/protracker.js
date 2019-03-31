import { Note } from '../models/note';
import { Instrument } from '../models/instrument';
import { BinaryStream } from '../filesystem';
import { EVENT, LOOPTYPE, TRACKERMODE, SETTINGS } from '../enum';
import { bus } from '../eventBus';

// TODO: tracker global ref

export class ProTracker {
	constructor() {}

	load(file) {
		Tracker.setTrackerMode(TRACKERMODE.PROTRACKER);
		Tracker.useLinearFrequency = false;
		Tracker.clearInstruments(31);

		const patternLength = 64;
		const instrumentCount = 31;
		const channelCount = 4;
		const song = {
			patterns: [],
			restartPosition: 1,
		};

		song.typeId = file.readString(4, 1080);
		song.title = file.readString(20, 0);

		if (song.typeId === '2CHN') { channelCount = 2; }
		if (song.typeId === '6CHN') { channelCount = 6; }
		if (song.typeId === '8CHN') { channelCount = 8; }
		if (song.typeId === '10CH') { channelCount = 10; }
		if (song.typeId === '12CH') { channelCount = 12; }
		if (song.typeId === '14CH') { channelCount = 14; }
		if (song.typeId === '16CH') { channelCount = 16; }
		if (song.typeId === '18CH') { channelCount = 18; }
		if (song.typeId === '20CH') { channelCount = 20; }
		if (song.typeId === '22CH') { channelCount = 22; }
		if (song.typeId === '24CH') { channelCount = 24; }
		if (song.typeId === '26CH') { channelCount = 26; }
		if (song.typeId === '28CH') { channelCount = 28; }
		if (song.typeId === '30CH') { channelCount = 30; }
		if (song.typeId === '32CH') { channelCount = 32; }

		song.channels = channelCount;

		let sampleDataOffset = 0;
		for (let i = 1; i <= instrumentCount; ++i) {
			const instrumentName = file.readString(22);
			const sampleLength = file.readWord(); // in words
			const instrument = new Instrument();

			instrument.name = instrumentName;
			instrument.sample.length = instrument.sample.realLen = sampleLength << 1;

			const finetune = file.readUbyte();
			if (finetune > 7) {
				finetune -= 16;
			}

			instrument.setFineTune(finetune);
			instrument.sample.volume = file.readUbyte();
			instrument.sample.loop.start = file.readWord() << 1;
			instrument.sample.loop.length = file.readWord() << 1;
			instrument.sample.loop.enabled = instrument.sample.loop.length > 2;
			instrument.sample.loop.type = LOOPTYPE.FORWARD;
			instrument.pointer = sampleDataOffset;
			sampleDataOffset += instrument.sample.length;
			instrument.setSampleIndex(0);

			Tracker.setInstrument(i, instrument);
		}

		song.instruments = Tracker.getInstruments();

		file.goto(950);
		song.length = file.readUbyte();
		file.jump(1); // 127 byte

		const patternTable = [];
		let highestPattern = 0;
		for (let i = 0; i < 128; ++i) {
			patternTable[i] = file.readUbyte();
			if (patternTable[i] > highestPattern) highestPattern = patternTable[i];
		}

		song.patternTable = patternTable;
		file.goto(1084);

		// pattern data

		for (let i = 0; i <= highestPattern; ++i) {
			const patternData = [];

			for (let step = 0; step < patternLength; step++) {
				const row = [];
				for (let channel = 0; channel < channelCount; channel++) {
					const note = new Note();
					const trackStepInfo = file.readUint();

					note.setPeriod((trackStepInfo >> 16) & 0x0fff);
					note.effect = (trackStepInfo >> 8) & 0x0f;
					note.instrument = (trackStepInfo >> 24) & 0xf0 | (trackStepInfo >> 12) & 0x0f;
					note.param = trackStepInfo & 0xff;

					row.push(note);
				}

				// fill with empty data for other channels
				// TODO: not needed anymore ?
				// for (let channel = channelCount; channel < Tracker.getTrackCount(); channel++) {
				// 	row.push(new Note())
				// }

				patternData.push(row);
			}

			song.patterns.push(patternData);
		}

		const instrumentContainer = [];

		for (let i = 1; i <= instrumentCount; i++) {
			const instrument = Tracker.getInstrument(i);
			if (instrument) {
				console.log('Reading sample from 0x' + file.index + ' with length of ' + instrument.sample.length + ' bytes and repeat length of ' + instrument.sample.loop.length);
				const sampleEnd = instrument.sample.length;

				if (instrument.sample.loop.length > 2 && SETTINGS.unrollShortLoops && instrument.sample.loop.length < 1000) {
					// cut off trailing bytes for short looping samples
					sampleEnd = Math.min(sampleEnd, instrument.sample.loop.start + instrument.sample.loop.length);
					instrument.sample.length = sampleEnd;
				}

				for (let j = 0; j < sampleEnd; j++) {
					const b = file.readByte();
					// ignore first 2 bytes
					if (j < 2) {
						b = 0;
					}

					instrument.sample.data.push(b / 127)
				}

				if ((SETTINGS.unrollShortLoops || SETTINGS.unrollLoops) && instrument.sample.loop.length > 2) {
					let loopCount = Math.ceil(40000 / instrument.sample.loop.length) + 1;
					if (!SETTINGS.unrollLoops) loopCount = 0;

					let resetLoopNumbers = false;
					let loopLength = 0;
					if (SETTINGS.unrollShortLoops && instrument.sample.loop.length < 1600) {
						loopCount = Math.floor(1000 / instrument.sample.loop.length);
						resetLoopNumbers = true;
					}

					for (let l = 0; l < loopCount; l++) {
						let start = instrument.sample.loop.start;
						let end = start + instrument.sample.loop.length;
						for (let j = start; j < end; j++) {
							instrument.sample.data.push(instrument.sample.data[j]);
						}

						loopLength += instrument.sample.loop.length;
					}

					if (resetLoopNumbers && loopLength) {
						instrument.sample.loop.length += loopLength;
						instrument.sample.length += loopLength;
					}
				}

				instrumentContainer.push({ label: i + ' ' + instrument.name, data: i });
			}
		}

		bus.trigger(EVENT.instrumentListChange, instrumentContainer);

		return song;
	}
}
