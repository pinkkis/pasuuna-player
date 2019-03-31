import { Instrument } from '../models/instrument';
import { EVENT, LOOPTYPE, TRACKERMODE } from '../enum';
import { bus } from '../eventBus';

// TODO: Tracker global ref

export class SoundTracker {
	constructor() {}

	load(file, name) {
		Tracker.setTrackerMode(TRACKERMODE.PROTRACKER);
		Tracker.useLinearFrequency = false;
		Tracker.clearInstruments(15);

		const patternLength = 64;
		const instrumentCount = 15;
		const song = {
			patterns: [],
			restartPosition: 1,
		};

		song.typeId = "ST";
		song.channels = 4;
		song.title = file.readString(20, 0);

		let sampleDataOffset = 0;
		for (let i = 1; i <= instrumentCount; ++i) {
			const sampleName = file.readString(22);
			const sampleLength = file.readWord(); // in words

			const instrument = new Instrument();
			instrument.name = sampleName;
			instrument.sample.length = instrument.realLen = sampleLength << 1;
			instrument.sample.volume = file.readWord();
			instrument.setFineTune(0);
			instrument.sample.loop.start = file.readWord(); // in bytes!
			instrument.sample.loop.length = file.readWord() << 1;
			instrument.sample.loop.enabled = instrument.sample.loop.length > 2;
			instrument.sample.loop.type = LOOPTYPE.FORWARD;
			instrument.pointer = sampleDataOffset;
			sampleDataOffset += instrument.sample.length;
			instrument.setSampleIndex(0);
			Tracker.setInstrument(i, instrument);
		}

		song.instruments = Tracker.getInstruments();

		file.goto(470);

		song.length = file.readUbyte();
		song.speed = file.readUbyte();

		const patternTable = [];
		let highestPattern = 0;
		for (let i = 0; i < 128; ++i) {
			patternTable[i] = file.readUbyte();
			if (patternTable[i] > highestPattern) highestPattern = patternTable[i];
		}
		song.patternTable = patternTable;
		file.goto(600);

		// pattern data

		for (let i = 0; i <= highestPattern; ++i) {
			const patternData = [];

			for (let step = 0; step < patternLength; step++) {
				const row = [];
				for (let channel = 0; channel < 4; channel++) {
					const trackStepInfo = file.readUint();
					const trackStep = {
						period : (trackStepInfo >> 16) & 0x0fff,
						effect : (trackStepInfo >> 8) & 0x0f,
						instrument : (trackStepInfo >> 24) & 0xf0 | (trackStepInfo >> 12) & 0x0f,
						param : trackStepInfo & 0xff,
					};

					row.push(trackStep);
				}

				// fill with empty data for other channels
				for (let channel = 4; channel < Tracker.getTrackCount(); channel++) {
					row.push({ note: 0, effect: 0, instrument: 0, param: 0 });
				}

				patternData.push(row);
			}
			song.patterns.push(patternData);
		}

		const instrumentContainer = [];

		for (let i = 1; i <= instrumentCount; i++) {
			const instrument = Tracker.getInstrument(i);
			if (instrument) {
				console.log("Reading sample from 0x" + file.index + " with length of " + instrument.sample.length + " bytes and repeat length of " + instrument.sample.loop.length);
				const sampleEnd = instrument.sample.length;

				for (let j = 0; j < sampleEnd; j++) {
					const b = file.readByte();
					// ignore first 2 bytes
					if (j < 2) b = 0;
					instrument.sample.data.push(b / 127)
				}

				instrumentContainer.push({ label: i + " " + instrument.name, data: i });
			}
		}

		bus.trigger(EVENT.instrumentListChange, instrumentContainer);

		return song;
	};
}
