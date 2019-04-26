import WAAClock from 'waaclock';
import { Note } from './models/note';
import { Instrument } from './models/instrument';
import { FileDetector } from './fileformats/detect';
import { loadFile } from './lib/util';
import { BinaryStream } from './binaryStream';
import { events } from './events';
import { Audio } from './audio';

import {EVENT,
	PLAYTYPE,
	NOTEPERIOD,
	FTNOTEPERIOD,
	NOTEOFF,
	TRACKERMODE,
	SETTINGS
} from './enum';

export class Tracker {
	constructor(audioContext = null) {
		this.events = events;
		this.audio = new Audio(this, audioContext);
		this.externalAudioContext = audioContext !== null;
		this.detector = new FileDetector(this);
		this.useLinearFrequency = true;

		this.periodNoteTable = {};
		this.periodFinetuneTable = {};
		this.nameNoteTable = {};
		this.noteNames = [];
		this.FTNotes = [];
		this.FTPeriods = [];

		this.isPlaying = false;
		this.song = null;
		this.instruments = [];

		this.currentInstrumentIndex = 1;
		this.prevInstrumentIndex = null;

		this.currentPattern = 0;
		this.prevPattern = null;
		this.currentPatternPos = 0;
		this.prevPatternPos = null;

		this.currentPlayType = PLAYTYPE.song;
		this.currentPatternData = null;

		this.currentSongPosition = 0;
		this.prevSongPosition = 0;

		this.vibratoFunction = null;
		this.tremoloFunction = null;

		this.bpm = 125; // bmp
		this.ticksPerStep = 6;
		this.tickTime = 2.5 / this.bpm;
		this.mainTimer = null;
		this.clock = null;

		this.patternLength = 64;
		this.trackerMode = TRACKERMODE.PROTRACKER;
		this.trackerStates = [];
		this.patternLoopStart = [];
		this.patternLoopCount = [];

		this.trackCount = 4;

		this.clearEffectsCache();
		this.clearTrackNotes();
	}

	init() {
		this.audio.init();

		for (let i = -8; i < 8; i++) {
			this.periodFinetuneTable[i] = {};
		}

		for (const key in NOTEPERIOD) {
			if (NOTEPERIOD.hasOwnProperty(key)) {
				let note = NOTEPERIOD[key];
				this.periodNoteTable[note.period] = note;
				this.nameNoteTable[note.name] = note;
				this.noteNames.push(note.name);

				// build fineTune table
				if (note.tune) {
					for (let i = -8; i < 8; i++) {
						const table = this.periodFinetuneTable[i];
						const index = i + 8;
						table[note.tune[index]] = note.period;
					}
				}
			}
		}

		let ftCounter = 0;
		for (const key in FTNOTEPERIOD) {
			if (FTNOTEPERIOD.hasOwnProperty(key)) {
				const ftNote = FTNOTEPERIOD[key];
				if (!ftNote.period) ftNote.period = 1;
				this.FTNotes.push(ftNote);
				this.FTPeriods[ftNote.period] = ftCounter;
				if (ftNote.modPeriod) this.FTPeriods[ftNote.modPeriod] = ftCounter;
				ftCounter++;
			}
		}
	}

	resetDefaultSettings() {
		this.setAmigaSpeed(6);
		this.setBPM(125);

		this.vibratoFunction = this.audio.waveFormFunction.sine;
		this.tremoloFunction = this.audio.waveFormFunction.sine;

		this.clearTrackNotes();
		this.clearEffectsCache();

		this.useLinearFrequency = false;
		this.setTrackerMode(TRACKERMODE.PROTRACKER);

		this.audio.setMasterVolume(1);
		this.audio.setAmigaLowPassFilter(false, 0);
	}

	clearInstruments(count) {
		if (!this.song) {
			return;
		}

		const instrumentContainer = [];
		const max = count || this.song.instruments.length - 1;

		this.instruments = [];

		for (let i = 1; i <= max; i++) {
			this.setInstrument(i, new Instrument(this));
			instrumentContainer.push({ label: i + ' ', data: i });
		}
		this.song.instruments = this.instruments;

		events.emit(EVENT.instrumentListChange, instrumentContainer);
		events.emit(EVENT.instrumentChange, this.currentInstrumentIndex);
	}

	clearTrackNotes() {
		this.trackNotes = [];

		for (let i = 0; i < this.trackCount; i++) {
			this.trackNotes.push({});
		}
	}

	clearEffectsCache() {
		this.trackEffectCache = [];

		for (let i = 0; i < this.trackCount; i++) {
			this.trackEffectCache.push({});
		}
	}

	setCurrentPattern(index) {
		this.currentPattern = index;
		this.currentPatternData = this.song.patterns[this.currentPattern];

		if (!this.currentPatternData) {
			// insert empty pattern;
			this.currentPatternData = this.getEmptyPattern();
			this.song.patterns[this.currentPattern] = this.currentPatternData;
		}
		this.patternLength = this.currentPatternData.length;

		if (this.prevPattern != this.currentPattern) {
			events.emit(EVENT.patternChange, this.currentPattern);
		}

		this.prevPattern = this.currentPattern;
	}

	getCurrentPattern() {
		return this.currentPattern;
	}

	getCurrentPatternData() {
		return this.currentPatternData;
	}

	updatePatternTable(index, value) {
		this.song.patternTable[index] = value;
		events.emit(EVENT.patternTableChange, value);
		if (index == this.currentSongPosition) {
			this.prevPattern = undefined;
			this.setCurrentPattern(value);
		}
	}

	setCurrentPatternPos(index) {
		this.currentPatternPos = index;
		if (this.prevPatternPos != this.currentPatternPos) {
			events.emit(EVENT.patternPosChange, { current: this.currentPatternPos, prev: this.prevPatternPos });
		}

		this.prevPatternPos = this.currentPatternPos;
	}

	setPlayType(playType) {
		this.currentPlayType = playType;
		events.emit(EVENT.playTypeChange, this.currentPlayType);
	}

	getPlayType() {
		return this.currentPlayType;
	}

	playSong() {
		this.stop();
		this.audio.checkState();
		this.setPlayType(PLAYTYPE.song);
		this.isPlaying = true;
		this.playPatternIndex(this.currentPattern);
		events.emit(EVENT.playingChange, this.isPlaying);
	}

	stop(resetVolume = true) {
		if (this.clock) {
			this.clock.stop();
		}

		this.audio.disable();
		if (resetVolume) {
			this.audio.setMasterVolume(1);
		}

		this.clearEffectsCache();

		for (let i = 0; i < this.trackCount; i++) {
			if (this.trackNotes[i].source) {
				try {
					this.trackNotes[i].source.stop();
				} catch (e) {
					// swallow error
				}
			}
		}

		this.isPlaying = false;
		events.emit(EVENT.playingChange, this.isPlaying);
	}

	pause() {
		// this is only called when speed is set to 0
		if (this.clock) this.clock.stop();
		this.isPlaying = false;
		events.emit(EVENT.playingChange, this.isPlaying);
	}

	getProperties() {
		return {
			ticksPerStep: this.ticksPerStep,
			tickTime: this.tickTime
		}
	}

	playPatternIndex(patternIndex) {
		this.patternIndex = this.patternIndex || 0;

		this.clock = this.clock || new WAAClock(this.audio.context);
		this.clock.start();
		this.audio.enable();

		this.patternLoopStart = [];
		this.patternLoopCount = [];

		this.currentPatternData = this.song.patterns[patternIndex];

		let thisPatternLength = this.currentPatternData.length;
		let stepResult = {};

		// look-ahead playback - far less demanding, works OK on mobile devices
		let p = 0;
		let time = this.audio.context.currentTime + 0.1; // add small delay to allow some time to render the first notes before playing

		// start with a small delay then make it longer
		// this is because Chrome on Android doesn't start playing until the first batch of scheduling is done?
		let delay = SETTINGS.playbackDelayStart;
		const playingDelay = SETTINGS.playbackDelay;

		let playPatternData = this.currentPatternData;
		let playSongPosition = this.currentSongPosition;
		this.trackerStates = [];

		this.events.emit(EVENT.patternChange, {patternIndex: patternIndex, pattern: this.currentPatternData});
		this.mainTimer = this.clock.setTimeout(function (event) {

			if (p > 1) {
				delay = playingDelay;
				this.mainTimer.repeat(delay);
			}

			const maxTime = event.deadline + delay;
			this.audio.clearScheduledNotesCache();

			while (time < maxTime) {
				if (stepResult.pause) {
					// speed is set to 0
					if (!stepResult.pauseHandled) {
						const delta = time - this.audio.context.currentTime;
						if (delta > 0) {
							setTimeout(function () {
								this.pause();
								// in Fasttracker this repeats the current step with the previous speed - including effects.
								// (which seems totally weird)
								this.setAmigaSpeed(6);
							}, Math.round(delta * 1000) + 100);
						}
						stepResult.pauseHandled = true;
					}
					return;
				}

				this.setStateAtTime(time, { patternPos: p, songPos: playSongPosition });

				if (stepResult.patternDelay) {
					// the E14 effect is used: delay Pattern but keep processing effects
					stepResult.patternDelay--;

					for (let i = 0; i < this.trackCount; i++) {
						this.applyEffects(i, time)
					}

					time += this.ticksPerStep * this.tickTime;
				} else {
					stepResult = this.playPatternStep(p, time, playPatternData, playSongPosition);
					time += this.ticksPerStep * this.tickTime;
					p++;

					if (p >= thisPatternLength || stepResult.patternBreak) {
						if (!(stepResult.positionBreak && stepResult.targetSongPosition == playSongPosition)) {
							//We're not in a pattern loop
							this.patternLoopStart = [];
							this.patternLoopCount = [];
						}
						p = 0;

						if (this.getPlayType() == PLAYTYPE.song) {
							let nextPosition = stepResult.positionBreak ? stepResult.targetSongPosition : ++playSongPosition;
							if (nextPosition >= this.song.length) {
								nextPosition = this.song.restartPosition ? this.song.restartPosition - 1 : 0;
								this.events.emit(EVENT.songRestart, nextPosition);
							}
							if (nextPosition >= this.song.length) {
								this.events.emit(EVENT.songRestart, nextPosition);
								nextPosition = 0;
							}

							playSongPosition = nextPosition;
							patternIndex = this.song.patternTable[playSongPosition];
							playPatternData = this.song.patterns[patternIndex];

							this.events.emit(EVENT.patternChange, {patternIndex: patternIndex, pattern: playPatternData});
							// some invalid(?) XM files have non-existent patterns in their song list - eg. cybernautic_squierl.xm
							if (!playPatternData) {
								playPatternData = this.getEmptyPattern();
								this.song.patterns[patternIndex] = playPatternData;
							}

							thisPatternLength = playPatternData.length;
							if (stepResult.patternBreak) {
								p = stepResult.targetPatternPosition || 0;
								if (p > playPatternData.length) {
									p = 0; // occurs in the wild - example 'Lake Of Sadness' - last pattern
								}
							}
						} else {
							if (stepResult.patternBreak) {
								p = stepResult.targetPatternPosition || 0;
								if (p > thisPatternLength) {
									p = 0;
								}
							}
						}
					}
				}

			}

			// check if a playing note has looping parameters that needs further scheduling

			for (let i = 0; i < this.trackCount; i++) {
				const trackNote = this.trackNotes[i];
				if (trackNote && trackNote.time && trackNote.scheduled) {
					const instrument = this.getInstrument(trackNote.instrumentIndex);

					if (trackNote.scheduled.volume) {
						if ((time + delay) >= trackNote.scheduled.volume) {
							const scheduledtime = instrument.scheduleEnvelopeLoop(trackNote.volumeEnvelope, trackNote.scheduled.volume, 2);
							trackNote.scheduled.volume += scheduledtime;
						}
					}

					if (trackNote.scheduled.panning) {
						if ((time + delay) >= trackNote.scheduled.panning) {
							const scheduledtime = instrument.scheduleEnvelopeLoop(trackNote.panningEnvelope, trackNote.scheduled.panning, 2);
							trackNote.scheduled.panning += scheduledtime;
						}
					}
				}
			}

		}.bind(this), 0.01).repeat(delay).tolerance({ early: 0.1 });
	}

	playPatternStep(step, time, patternData, songPostition) {
		patternData = patternData || currentPatternData;
		// note: patternData can be different than currentPatternData when playback is active with long look ahead times

		const patternStep = patternData[step];
		const tracks = this.trackCount;
		const result = {};

		// hmmm ... Whut?
		// The Speed setting influences other effects too,
		// on Amiga players the effects are processed each tick, so the speed setting on a later channel can influence the effects on a previous channel ...
		// This is implemented by setting the speed before all other effects
		// example: see the ED2 command pattern 0, track 3, step 32 in AceMan - Dirty Tricks.mod
		// not sure this is 100% correct, but in any case it's more correct then setting it at the track it self.
		// Thinking ... ... yes ... should be fine as no speed related effects are processed on tick 0?

		for (let i = 0; i < tracks; i++) {
			const note = patternStep[i];
			if (note && note.effect && note.effect === 15) {
				if (note.param <= 32) {
					//if (note.param == 0) note.param = 1;
					this.setAmigaSpeed(note.param);
					if (note.param === 0) result.pause = true;
				} else {
					this.setBPM(note.param)
				}
			}
		}
		// --- end Whut? ---

		for (let i = 0; i < tracks; i++) {
			const note = patternStep[i];
			if (note) {
				const songPos = {
					position: songPostition,
					step: step
				};

				const playtime = time;

				const r = this.playNote(note, i, playtime, songPos);
				if (r.patternBreak) {
					result.patternBreak = true;
					result.targetPatternPosition = r.targetPatternPosition || 0;
				}
				if (r.positionBreak) {
					result.positionBreak = true;
					result.targetPatternPosition = r.targetPatternPosition || 0;
					result.targetSongPosition = r.targetSongPosition || 0;
				}
				if (r.patternDelay) result.patternDelay = r.patternDelay;
			}
		}

		for (let i = 0; i < tracks; i++) {
			this.applyEffects(i, time)
		}

		return result;
	}

	playNote(note, track, time, songPos) {
		let defaultVolume = 100;
		const trackEffects = {};

		let instrumentIndex = note.instrument;
		let notePeriod = note.period;
		let noteIndex = note.index;
		let instrument;

		if (notePeriod && !instrumentIndex) {
			// reuse previous instrument
			instrumentIndex = this.trackNotes[track].currentInstrument;
			defaultVolume = typeof this.trackNotes[track].currentVolume === 'number' ? this.trackNotes[track].currentVolume : defaultVolume;

			if (SETTINGS.emulateProtracker1OffsetBug && instrumentIndex && this.trackEffectCache[track].offset) {
				if (this.trackEffectCache[track].offset.instrument === instrumentIndex) {
					trackEffects.offset = this.trackEffectCache[track].offset;
				}
			}
		}

		if (typeof note.instrument === 'number') {
			instrument = this.getInstrument(note.instrument);
			if (instrument) {
				defaultVolume = 100 * (instrument.sample.volume / 64);

				if (SETTINGS.emulateProtracker1OffsetBug) {
					// reset instrument offset when a instrument number is present;
					this.trackEffectCache[track].offset = this.trackEffectCache[track].offset || {};
					this.trackEffectCache[track].offset.value = 0;
					this.trackEffectCache[track].offset.instrument = note.instrument;
				}
			}
		}

		let volume = defaultVolume;
		let doPlayNote = true;

		if (typeof instrumentIndex === 'number') {
			instrument = this.getInstrument(instrumentIndex);
		}

		if (noteIndex && this.inFTMode()) {

			if (noteIndex === 97) {
				noteIndex = NOTEOFF;
			}

			if (noteIndex === NOTEOFF) {
				const offInstrument = instrument || this.getInstrument(this.trackNotes[track].currentInstrument);
				if (offInstrument) {
					volume = offInstrument.noteOff(time, this.trackNotes[track]);
				} else {
					volume = 0;
				}
				defaultVolume = volume;
				doPlayNote = false;
			} else {
				if (instrument) {
					instrument.setSampleForNoteIndex(noteIndex);

					if (instrument.sample.relativeNote) {
						noteIndex += instrument.sample.relativeNote;
					}
					// TODO: check of note gets out of range
					// but apparently they still get played ... -> extend scale to 9, 10 or 11 octaves ?
					// see jt_letgo.xm instrument 6 (track 20) for example
				}

				if (this.useLinearFrequency) {
					notePeriod = 7680 - (noteIndex - 1) * 64;
				} else {
					const ftNote = this.FTNotes[noteIndex];
					if (ftNote) {
						notePeriod = ftNote.period;
					}
				}
			}
		}

		let value = note.param;
		let x;
		let y;
		const result = {};

		if (note.volumeEffect && this.inFTMode()) {
			const ve = note.volumeEffect;
			x = ve >> 4;
			y = ve & 0x0f;

			if (ve > 15 && ve <= 80) {
				volume = ((ve - 16) / 64) * 100;
				defaultVolume = volume;

				// note this is not relative to the default instrument volume but sets the instrument volume
				trackEffects.volume = {
					value: volume
				};
			} else {

				switch (x) {
					case 6:
						// volume slide down
						trackEffects.fade = {
							value: -y * 100 / 64,
						};
						break;
					case 7:
						// volume slide up
						trackEffects.fade = {
							value: y * 100 / 64,
						};
						break;
					case 8:
						// Fine volume slide down
						trackEffects.fade = {
							value: -y * 100 / 64,
							fine: true,
						};
						break;
					case 9:
						// Fine volume slide up
						trackEffects.fade = {
							value: y * 100 / 64,
							fine: true,
						};
						break;
					case 10:
						// set vibrato speed
						// console.warn('set vibrato speed not implemented');
						break;
					case 11:
						// Vibrato
						// console.warn('Vibrato not implemented');
						break;
					case 12:
						// Set panning
						trackEffects.panning = {
							value: (ve - 192) * 17,
							slide: false,
						};
						break;
					case 13:
						// Panning slide left
						// console.warn('Panning slide left not implemented - track ' + track);
						trackEffects.panning = {
							value: ve,
							slide: true,
						};
						break;
					case 14:
						// Panning slide right
						// console.warn('Panning slide right not implemented - track ' + track);
						break;
					case 15:
						// Tone porta
						// console.warn('Tone Porta not implemented');
						break;
				}
			}
		}

		switch (note.effect) {
			case 0:
				// Arpeggio
				if (value) {
					x = value >> 4;
					y = value & 0x0f;
					let finetune = 0;

					// TODO: when a instrument index is present other than the previous index, but no note
					// how does this work? see example just_about_seven.mod
					instrument = instrument || this.getInstrument(this.trackNotes[track].currentInstrument);

					if (this.inFTMode()) {
						if (instrument) {
							const _noteIndex = noteIndex || this.trackNotes[track].noteIndex;
							const root = instrument.getPeriodForNote(_noteIndex, true);

							if (noteIndex === NOTEOFF) {
								trackEffects.arpeggio = this.trackEffectCache[track].arpeggio;
							} else {
								trackEffects.arpeggio = {
									root: root,
									interval1: root - instrument.getPeriodForNote(_noteIndex + x, true),
									interval2: root - instrument.getPeriodForNote(_noteIndex + y, true),
									step: 1
								};

								this.trackEffectCache[track].arpeggio = trackEffects.arpeggio
							}
						}
					} else {
						let root = notePeriod || this.trackNotes[track].startPeriod;
						// check if the instrument is finetuned
						if (instrument) {
							finetune = instrument.getFineTune();
							if (finetune) {
								root = this.audio.getFineTuneForPeriod(root, finetune);
							}
						}

						trackEffects.arpeggio = {
							root: root,
							interval1: root - this.audio.getSemiToneFrom(root, x, finetune),
							interval2: root - this.audio.getSemiToneFrom(root, y, finetune),
							step: 1
						};
					}
				}

				// set volume, even if no effect present
				// note: this is consistent with the Protracker 3.15 and later playback
				// on Protracker 2.3 and 3.0, the volume effect seems much bigger - why ? (see 'nugget - frust.mod')
				if (note.instrument) {
					trackEffects.volume = {
						value: defaultVolume,
					};
				}

				break;
			case 1:
				// Slide Up
				value = value * -1;

				// note: on protracker 2 and 3 , the effectcache is NOT used on this effect
				// it is on Milkytracker (in all playback modes)

				if (this.inFTMode()) {
					if (!value && this.trackEffectCache[track].slideUp) value = this.trackEffectCache[track].slideUp.value;
				}

				trackEffects.slide = {
					value: value
				};

				this.trackEffectCache[track].slideUp = trackEffects.slide;
				break;
			case 2:
				// Slide Down

				// note: on protracker 2 and 3 , the effectcache is NOT used on this effect
				// it is on Milkytracker (in all playback modes)

				if (this.inFTMode()) {
					if (!value && this.trackEffectCache[track].slideDown) value = this.trackEffectCache[track].slideDown.value;
				}

				trackEffects.slide = {
					value: value
				};

				this.trackEffectCache[track].slideDown = trackEffects.slide;
				break;
			case 3:
				// Slide to Note - if there's a note provided, it is not played directly,
				// if the instrument number is set, the default volume of that instrument will be set

				// if value == 0 then the old slide will continue

				doPlayNote = false;
				// note: protracker2 switches samples on the fly if the instrument index is different from the previous instrument ...
				// Should we implement that?
				// fasttracker does not.
				// protracker 3 does not
				// milkytracker tries, but not perfect
				// the ProTracker clone of 8bitbubsy does this completely compatible to protracker2.

				let target = notePeriod;
				if (this.inFTMode() && noteIndex === NOTEOFF) target = 0;

				// avoid using the fineTune of another instrument if another instrument index is present
				if (this.trackNotes[track].currentInstrument) instrumentIndex = this.trackNotes[track].currentInstrument;

				if (target && instrumentIndex) {
					// check if the instrument is finetuned
					const instrument = this.getInstrument(instrumentIndex);
					if (instrument && instrument.getFineTune()) {
						target = this.inFTMode() ? instrument.getPeriodForNote(noteIndex, true) : this.audio.getFineTuneForPeriod(target, instrument.getFineTune());
					}
				}

				const prevSlide = this.trackEffectCache[track].slide;

				if (prevSlide) {
					if (!value) value = prevSlide.value;
				}

				if (!target) {
					target = this.trackEffectCache[track].defaultSlideTarget;
				}

				trackEffects.slide = {
					value: value,
					target: target,
					canUseGlissando: true,
					resetVolume: !!note.instrument,
					volume: defaultVolume
				};

				this.trackEffectCache[track].slide = trackEffects.slide;

				if (note.instrument) {
					trackEffects.volume = {
						value: defaultVolume
					};
				}

				break;
			case 4:
				// vibrato
				// reset volume and vibrato timer if instrument number is present
				if (note.instrument) {
					if (this.trackNotes[track].startVolume) {
						trackEffects.volume = {
							value: volume
						};
					}

					this.trackNotes[track].vibratoTimer = 0;
				}

				x = value >> 4;
				y = value & 0x0f;

				let freq = (x * this.ticksPerStep) / 64;
				const prevVibrato = this.trackEffectCache[track].vibrato;

				if (x == 0 && prevVibrato) {
					freq = prevVibrato.freq;
				}

				if (y == 0 && prevVibrato) {
					y = prevVibrato.amplitude;
				}

				trackEffects.vibrato = {
					amplitude: y,
					freq: freq
				};

				this.trackEffectCache[track].vibrato = trackEffects.vibrato;

				break;
			case 5:
				// continue slide to note
				doPlayNote = false;
				target = notePeriod;

				if (target && instrumentIndex) {
					// check if the instrument is finetuned
					instrument = this.getInstrument(instrumentIndex);
					if (instrument && instrument.getFineTune()) {
						target = this.inFTMode() ? this.audio.getFineTuneForNote(noteIndex, instrument.getFineTune()) : this.audio.getFineTuneForPeriod(target, instrument.getFineTune());
					}
				}

				value = 1;

				const contPrevSlide = this.trackEffectCache[track].slide;
				if (contPrevSlide) {
					if (!target) target = contPrevSlide.target || 0;
					value = contPrevSlide.value;
				}

				trackEffects.slide = {
					value: value,
					target: target
				};

				this.trackEffectCache[track].slide = trackEffects.slide;

				if (note.instrument) {
					trackEffects.volume = {
						value: defaultVolume
					};
				}

				// and do volume slide
				value = note.param;
				if (!value) {
					// don't do volume slide
				} else {
					if (note.param < 16) {
						// slide down
						value = value * -1;
					} else {
						// slide up
						//value = note.param & 0x0f;
						value = note.param >> 4;
					}

					// this is based on max volume of 64 -> normalize to 100;
					value = value * 100 / 64;

					trackEffects.fade = {
						value: value,
						resetOnStep: !!note.instrument // volume only needs resetting when the instrument number is given, other wise the volue is remembered from the preious state
					};
					this.trackEffectCache[track].fade = trackEffects.fade;
				}
				break;

			case 6:
				// Continue Vibrato and do volume slide
				// reset volume and vibrato timer if instrument number is present
				if (note.instrument) {
					if (this.trackNotes[track].startVolume) {
						trackEffects.volume = {
							value: volume
						};
					}

					this.trackNotes[track].vibratoTimer = 0;
				}
				if (note.param) {
					if (note.param < 16) {
						// volume slide down
						value = value * -1;
					} else {
						// volume slide up
						value = note.param & 0x0f;
					}

					// this is based on max volume of 64 -> normalize to 100;
					value = value * 100 / 64;

					trackEffects.fade = {
						value: value
					};

					this.trackEffectCache[track].fade = trackEffects.fade;
				} else {
					// on Fasttracker this command is remembered - on Protracker it is not.
					if (this.inFTMode()) {
						if (this.trackEffectCache[track].fade) trackEffects.fade = this.trackEffectCache[track].fade;
					}
				}

				if (this.trackEffectCache[track].vibrato) trackEffects.vibrato = this.trackEffectCache[track].vibrato;
				break;
			case 7:
				// Tremolo
				// note: having a instrument number without a period doesn't seem te have any effect (protracker)
				// when only a period -> reset the wave form / timer

				if (notePeriod && !note.instrument) {
					if (this.trackNotes[track].startVolume) {
						trackEffects.volume = {
							value: volume
						};
					}

					this.trackNotes[track].tremoloTimer = 0;
				}

				x = value >> 4;
				y = value & 0x0f;

				let amplitude = y;
				let tFreq = (x * this.ticksPerStep) / 64;
				const prevTremolo = this.trackEffectCache[track].tremolo;

				if (x == 0 && prevTremolo) {
					tFreq = prevTremolo.freq;
				}

				if (y == 0 && prevTremolo) {
					amplitude = prevTremolo.amplitude;
				}

				trackEffects.tremolo = {
					amplitude: amplitude,
					freq: tFreq
				};

				this.trackEffectCache[track].tremolo = trackEffects.tremolo;

				break;
			case 8:
				// Set Panning position
				trackEffects.panning = {
					value: value,
					slide: false
				};
				break;
			case 9:
				// Set instrument offset

				/* quirk in Protracker 1 and 2 ?
				 if NO NOTE is given but a instrument number is present,
				 then the offset is remembered for the next note WITHOUT instrument number
				 but only when the derived instrument number is the same as the offset instrument number
				 see 'professional tracker' mod for example

				 also:
				 * if no instrument number is present: don't reset the offset
				  -> the effect cache of the previous 9 command of the instrument is used
				 * if a note is present REAPPLY the offset in the effect cache (but don't set start of instrument)
				  -> the effect cache now contains double the offset
				 */

				value = value << 8;
				if (!value && this.trackEffectCache[track].offset) {
					value = this.trackEffectCache[track].offset.stepValue || this.trackEffectCache[track].offset.value || 0;
				}
				const stepValue = value;

				if (SETTINGS.emulateProtracker1OffsetBug && !note.instrument && this.trackEffectCache[track].offset) {
					// bug in PT1 and PT2: add to existing offset if no instrument number is given
					value += this.trackEffectCache[track].offset.value;
				}

				trackEffects.offset = {
					value: value,
					stepValue: stepValue
				};

				// note: keep previous trackEffectCache[track].offset.instrument intact
				this.trackEffectCache[track].offset = this.trackEffectCache[track].offset || {};
				this.trackEffectCache[track].offset.value = trackEffects.offset.value;
				this.trackEffectCache[track].offset.stepValue = trackEffects.offset.stepValue;


				if (SETTINGS.emulateProtracker1OffsetBug) {

					// quirk in PT1 and PT2: remember instrument offset for instrument
					if (note.instrument) {
						//console.log('set offset cache for instrument ' + note.instrument);
						this.trackEffectCache[track].offset.instrument = note.instrument;
					}

					// bug in PT1 and PT2: re-apply instrument offset in effect cache
					if (notePeriod) {
						//console.log('re-adding offset in effect cache');
						this.trackEffectCache[track].offset.value += stepValue;
					}

				}

				if (note.instrument) {
					trackEffects.volume = {
						value: defaultVolume
					};
				}

				break;
			case 10:
				// volume slide
				if (note.param < 16) {
					// slide down
					value = value * -1;
				} else {
					// slide up
					value = note.param >> 4;
				}

				// this is based on max volume of 64 -> normalize to 100;
				value = value * 100 / 64;

				if (!note.param) {
					const prevFade = this.trackEffectCache[track].fade;
					if (prevFade) {
						value = prevFade.value;
					}
				}

				trackEffects.fade = {
					value: value,
					resetOnStep: !!note.instrument // volume only needs resetting when the instrument number is given, otherwise the volume is remembered from the previous state
				};

				//!!! in FT2 this effect is remembered - in Protracker it is not
				if (this.inFTMode()) {
					this.trackEffectCache[track].fade = trackEffects.fade;
				}

				break;
			case 11:
				// Position Jump
				result.patternBreak = true;
				result.positionBreak = true;
				result.targetSongPosition = note.param;
				result.targetPatternPosition = 0;
				break;
			case 12:
				//volume
				volume = (note.param / 64) * 100;
				// not this is not relative to the default instrument volume but sets the instrument volume
				trackEffects.volume = {
					value: volume
				};
				break;
			case 13:
				// Pattern Break
				result.patternBreak = true;
				x = value >> 4;
				y = value & 0x0f;
				result.targetPatternPosition = x * 10 + y;
				break;
			case 14:
				// Subeffects
				const subEffect = value >> 4;
				let subValue = value & 0x0f;
				switch (subEffect) {
					case 0:
						if (!this.inFTMode()) this.audio.setAmigaLowPassFilter(!subValue, time);
						break;
					case 1: // Fine slide up
						subValue = subValue * -1;
						if (!subValue && this.trackEffectCache[track].fineSlide) subValue = this.trackEffectCache[track].fineSlide.value;
						trackEffects.slide = {
							value: subValue,
							fine: true
						};
						this.trackEffectCache[track].fineSlide = trackEffects.slide;
						break;
					case 2: // Fine slide down
						if (!subValue && this.trackEffectCache[track].fineSlide) subValue = this.trackEffectCache[track].fineSlide.value;
						trackEffects.slide = {
							value: subValue,
							fine: true
						};
						this.trackEffectCache[track].fineSlide = trackEffects.slide;
						break;
					case 3: // set glissando control
						this.trackEffectCache[track].glissando = !!subValue;
						break;
					case 4: // Set Vibrato Waveform
						switch (subValue) {
							case 1: this.vibratoFunction = this.audio.waveFormFunction.saw; break;
							case 2: this.vibratoFunction = this.audio.waveFormFunction.square; break;
							case 3: this.vibratoFunction = this.audio.waveFormFunction.sine; break; // random
							case 4: this.vibratoFunction = this.audio.waveFormFunction.sine; break; // no retrigger
							case 5: this.vibratoFunction = this.audio.waveFormFunction.saw; break; // no retrigger
							case 6: this.vibratoFunction = this.audio.waveFormFunction.square; break; // no retrigger
							case 7: this.vibratoFunction = this.audio.waveFormFunction.sine; break; // random, no retrigger
							default: this.vibratoFunction = this.audio.waveFormFunction.sine; break;
						}
						break;
					case 5: // Set Fine Tune
						if (instrumentIndex) {
							const instrument = this.getInstrument(instrumentIndex);
							trackEffects.fineTune = {
								original: instrument.getFineTune(),
								instrument: instrument
							};
							instrument.setFineTune(subValue);
						}
						break;
					case 6: // Pattern Loop
						if (subValue) {
							this.patternLoopCount[track] = this.patternLoopCount[track] || 0;
							if (this.patternLoopCount[track] < subValue) {
								this.patternLoopCount[track]++;
								result.patternBreak = true;
								result.positionBreak = true;
								result.targetSongPosition = songPos.position; // keep on same position
								result.targetPatternPosition = this.patternLoopStart[track] || 0; // should we default to 0 if no start was set or just ignore?

								// console.log('looping to ' + result.targetPatternPosition + ' for ' + this.patternLoopCount[track] + '/' + subValue);
								this.events.emit(EVENT.patternLoopChange, {target: result.targetPatternPosition, count: this.patternLoopCount[track]});
							} else {
								this.patternLoopCount[track] = 0;
							}
						} else {
							// console.log('setting loop start to ' + songPos.step + ' on track ' + track);
							this.patternLoopStart[track] = songPos.step;
						}
						break;
					case 7: // Set Tremolo WaveForm
						switch (subValue) {
							case 1: this.tremoloFunction = this.audio.waveFormFunction.saw; break;
							case 2: this.tremoloFunction = this.audio.waveFormFunction.square; break;
							case 3: this.tremoloFunction = this.audio.waveFormFunction.sine; break; // random
							case 4: this.tremoloFunction = this.audio.waveFormFunction.sine; break; // no retrigger
							case 5: this.tremoloFunction = this.audio.waveFormFunction.saw; break; // no retrigger
							case 6: this.tremoloFunction = this.audio.waveFormFunction.square; break; // no retrigger
							case 7: this.tremoloFunction = this.audio.waveFormFunction.sine; break; // random, no retrigger
							default: this.tremoloFunction = this.audio.waveFormFunction.sine; break;
						}
						break;
					case 8: // Set Panning - is this used ?
						// console.warn('Set Panning - not implemented');
						break;
					case 9: // Retrigger Note
						if (subValue) {
							trackEffects.reTrigger = {
								value: subValue
							}
						}
						break;
					case 10: // Fine volume slide up
						subValue = subValue * 100 / 64;
						trackEffects.fade = {
							value: subValue,
							fine: true
						};
						break;
					case 11: // Fine volume slide down

						subValue = subValue * 100 / 64;

						trackEffects.fade = {
							value: -subValue,
							fine: true
						};
						break;
					case 12: // Cut Note
						if (subValue) {
							if (subValue < this.ticksPerStep) {
								trackEffects.cutNote = {
									value: subValue
								}
							}
						} else {
							doPlayNote = false;
						}
						break;
					case 13: // Delay Sample start
						if (subValue) {
							if (subValue < this.ticksPerStep) {
								time += this.tickTime * subValue;
							} else {
								doPlayNote = false;
							}
						}
						break;
					case 14: // Pattern Delay
						result.patternDelay = subValue;
						break;
					case 15: // Invert Loop
						// Don't think is used somewhere - ignore
						break;
					default:
						// console.warn('Subeffect ' + subEffect + ' not implemented');
				}
				break;
			case 15:
				//speed
				// Note: shouldn't this be 'set speed at time' instead of setting it directly?
				// TODO: -> investigate
				// TODO: Yes ... this is actually quite wrong FIXME !!!!

				if (note.param <= 32) {
					//if (note.param == 0) note.param = 1;
					this.setAmigaSpeed(note.param, time);
				} else {
					this.setBPM(note.param)
				}
				break;

			case 16:
				//Fasttracker only - global volume
				value = Math.min(value, 64);
				this.audio.setMasterVolume(value / 64, time);
				break;
			case 17:
				//Fasttracker only - global volume slide

				x = value >> 4;
				y = value & 0x0f;
				const currentVolume = this.audio.getLastMasterVolume() * 64;
				let amount = 0;
				let targetTime;

				if (x) {
					targetTime = time + (x * this.tickTime);
					amount = x * (this.ticksPerStep - 1);
				} else if (y) {
					targetTime = time + (y * this.tickTime);
					amount = -y * (this.ticksPerStep - 1);
				}

				if (amount) {
					value = (currentVolume + amount) / 64;
					value = Math.max(0, value);
					value = Math.min(1, value);

					this.audio.slideMasterVolume(value, targetTime);
				}

				break;
			case 20:
				//Fasttracker only - Key off
				if (this.inFTMode()) {
					offInstrument = instrument || this.getInstrument(this.trackNotes[track].currentInstrument);
					if (offInstrument) {
						volume = offInstrument.noteOff(time, this.trackNotes[track]);
					} else {
						volume = 0;
					}
					defaultVolume = volume;
					doPlayNote = false;
				}
				break;
			case 21:
				//Fasttracker only - Set envelope position
				// console.warn('Set envelope position not implemented');
				break;
			case 25:
				//Fasttracker only - Panning slide
				// console.warn('Panning slide not implemented - track ' + track);
				break;
			case 27:
				//Fasttracker only - Multi retrig note
				// still not 100% sure how this is supposed to work ...
				// see https://forum.openmpt.org/index.php?topic=4999.15
				// see lupo.xm for an example (RO1 command)
				trackEffects.reTrigger = {
					value: note.param
				};
				break;
			case 29:
				//Fasttracker only - Tremor
				// console.warn('Tremor not implemented');
				break;
			case 33:
				//Fasttracker only - Extra fine porta
				// console.warn('Extra fine porta not implemented');
				break;
			default:
				// console.warn('unhandled effect: ' + note.effect);
		}

		if (doPlayNote && instrumentIndex && notePeriod) {
			// cut off previous note on the same track;
			this.cutNote(track, time);
			this.trackNotes[track] = {};

			if (instrument) {
				this.trackNotes[track] = instrument.play(noteIndex, notePeriod, volume, track, trackEffects, time);
			}

			//trackNotes[track] = this.audio.playSample(instrumentIndex,notePeriod,volume,track,trackEffects,time,noteIndex);
			this.trackEffectCache[track].defaultSlideTarget = this.trackNotes[track].startPeriod;
		}

		if (instrumentIndex) {
			this.trackNotes[track].currentInstrument = instrumentIndex;

			// reset temporary instrument settings
			if (trackEffects.fineTune && trackEffects.fineTune.instrument) {
				trackEffects.fineTune.instrument.setFineTune(trackEffects.fineTune.original || 0);
			}
		}

		if (instrument && instrument.hasVibrato()) {
			this.trackNotes[track].hasAutoVibrato = true;
		}

		this.trackNotes[track].effects = trackEffects;
		this.trackNotes[track].note = note;

		return result;
	}

	cutNote(track, time) {
		// ramp to 0 volume to avoid clicks
		try {
			if (this.trackNotes[track].source) {
				const gain = this.trackNotes[track].volume.gain;
				gain.setValueAtTime(this.trackNotes[track].currentVolume / 100, time - 0.002);
				gain.linearRampToValueAtTime(0, time);
				this.trackNotes[track].source.stop(time + 0.02);
				//trackNotes[track].source.stop(time);
			}
		} catch (e) {

		}
	}

	applyAutoVibrato(trackNote, currentPeriod) {
		const instrument = this.getInstrument(trackNote.instrumentIndex);
		if (instrument) {
			const _freq = -instrument.vibrato.rate / 40;
			let _amp = instrument.vibrato.depth / 8;
			if (this.useLinearFrequency) {
				_amp *= 4;
			}
			trackNote.vibratoTimer = trackNote.vibratoTimer || 0;

			if (instrument.vibrato.sweep && trackNote.vibratoTimer < instrument.vibrato.sweep) {
				const sweepAmp = 1 - ((instrument.vibrato.sweep - trackNote.vibratoTimer) / instrument.vibrato.sweep);
				_amp *= sweepAmp;
			}
			const instrumentVibratoFunction = instrument.getAutoVibratoFunction();
			const targetPeriod = instrumentVibratoFunction(currentPeriod, trackNote.vibratoTimer, _freq, _amp);
			trackNote.vibratoTimer++;

			return targetPeriod;
		}

		return currentPeriod;
	}

	applyEffects(track, time) {
		const trackNote = this.trackNotes[track];
		const effects = trackNote.effects;
		let value;
		let autoVibratoHandled = false;

		if (!trackNote) { return; }
		if (!effects) { return; }

		trackNote.startVibratoTimer = trackNote.vibratoTimer || 0;

		if (trackNote.resetPeriodOnStep && trackNote.source) {
			// vibrato or arpeggio is done
			// for slow vibratos it seems logical to keep the current frequency, but apparently most trackers revert back to the pre-vibrato one
			const targetPeriod = trackNote.currentPeriod || trackNote.startPeriod;
			this.setPeriodAtTime(trackNote, targetPeriod, time);
			trackNote.resetPeriodOnStep = false;
		}

		if (effects.volume) {
			const volume = effects.volume.value;
			if (trackNote.volume) {
				trackNote.volume.gain.setValueAtTime(volume / 100, time);
			}
			trackNote.currentVolume = volume;
		}

		if (effects.panning) {
			value = effects.panning.value;
			if (value === 255) value = 254;
			if (trackNote.panning) {
				trackNote.panning.pan.setValueAtTime((value - 127) / 127, time);
			}
		}

		if (effects.fade) {
			value = effects.fade.value;
			let currentVolume;
			let startTick = 1;

			if (effects.fade.resetOnStep) {
				currentVolume = trackNote.startVolume;
			} else {
				currentVolume = trackNote.currentVolume;
			}

			let steps = this.ticksPerStep;
			if (effects.fade.fine) {
				// fine Volume Up or Down
				startTick = 0;
				steps = 1;
			}

			for (let tick = startTick; tick < steps; tick++) {
				if (trackNote.volume) {
					trackNote.volume.gain.setValueAtTime(currentVolume / 100, time + (tick * this.tickTime));
					currentVolume += value;
					currentVolume = Math.max(currentVolume, 0);
					currentVolume = Math.min(currentVolume, 100);
				}
			}

			trackNote.currentVolume = currentVolume;
		}

		if (effects.slide) {
			if (trackNote.source) {
				const currentPeriod = trackNote.currentPeriod || trackNote.startPeriod;
				const slideValue = this.inFTMode() && this.useLinearFrequency ? effects.slide.value * 4 : effects.slide.value;
				let targetPeriod = currentPeriod;
				let steps = this.ticksPerStep;

				if (effects.slide.fine) {
					// fine Slide Up or Down
					steps = 2;
				}

				value = Math.abs(slideValue);

				if (this.inFTMode() && effects.slide.resetVolume && (trackNote.volumeFadeOut || trackNote.volumeEnvelope)) {
					// crap ... this should reset the volume envelope to the beginning ... annoying ...
					const instrument = this.getInstrument(trackNote.instrumentIndex);
					if (instrument) {
						instrument.resetVolume(time, trackNote);
					}
				}

				trackNote.vibratoTimer = trackNote.startVibratoTimer;

				// TODO: Why don't we use a RampToValueAtTime here ?
				for (let tick = 1; tick < steps; tick++) {
					if (effects.slide.target) {
						this.trackEffectCache[track].defaultSlideTarget = effects.slide.target;
						if (targetPeriod < effects.slide.target) {
							targetPeriod += value;
							if (targetPeriod > effects.slide.target) targetPeriod = effects.slide.target;
						} else {
							targetPeriod -= value;
							if (targetPeriod < effects.slide.target) targetPeriod = effects.slide.target;
						}
					} else {
						targetPeriod += slideValue;
						if (this.trackEffectCache[track].defaultSlideTarget) {
							this.trackEffectCache[track].defaultSlideTarget += slideValue;
						}
					}

					if (!this.inFTMode()) {
						targetPeriod = this.audio.limitAmigaPeriod(targetPeriod);
					}

					let newPeriod = targetPeriod;
					if (effects.slide.canUseGlissando && this.trackEffectCache[track].glissando) {
						newPeriod = this.audio.getNearestSemiTone(targetPeriod, trackNote.instrumentIndex);
					}

					if (newPeriod !== trackNote.currentPeriod) {
						trackNote.currentPeriod = targetPeriod;

						if (trackNote.hasAutoVibrato && this.inFTMode()) {
							targetPeriod = this.applyAutoVibrato(trackNote, targetPeriod);
							autoVibratoHandled = true;
						}

						this.setPeriodAtTime(trackNote, newPeriod, time + (tick * this.tickTime));
					}
				}
			}
		}

		if (effects.arpeggio) {
			if (trackNote.source) {
				const currentPeriod = trackNote.currentPeriod || trackNote.startPeriod;
				let targetPeriod;

				trackNote.resetPeriodOnStep = true;
				trackNote.vibratoTimer = trackNote.startVibratoTimer;

				for (let tick = 0; tick < this.ticksPerStep; tick++) {
					const t = tick % 3;

					if (t == 0) {
						targetPeriod = currentPeriod;
					}

					if (t == 1 && effects.arpeggio.interval1) {
						targetPeriod = currentPeriod - effects.arpeggio.interval1;
					}

					if (t == 2 && effects.arpeggio.interval2) {
						targetPeriod = currentPeriod - effects.arpeggio.interval2;
					}

					if (trackNote.hasAutoVibrato && this.inFTMode()) {
						targetPeriod = this.applyAutoVibrato(trackNote, targetPeriod);
						autoVibratoHandled = true;
					}

					this.setPeriodAtTime(trackNote, targetPeriod, time + (tick * this.tickTime));
				}
			}
		}

		if (effects.vibrato || (trackNote.hasAutoVibrato && !autoVibratoHandled)) {
			effects.vibrato = effects.vibrato || { freq: 0, amplitude: 0 };

			const freq = effects.vibrato.freq;
			const amp = this.inFTMode() && this.useLinearFrequency ? effects.vibrato.amplitude * 4 : effects.vibrato.amplitude;

			trackNote.vibratoTimer = trackNote.vibratoTimer || 0;

			if (trackNote.source) {
				trackNote.resetPeriodOnStep = true;
				const currentPeriod = trackNote.currentPeriod || trackNote.startPeriod;

				trackNote.vibratoTimer = trackNote.startVibratoTimer;
				for (let tick = 0; tick < this.ticksPerStep; tick++) {
					let targetPeriod = this.vibratoFunction(currentPeriod, trackNote.vibratoTimer, freq, amp);

					// should we add or average the 2 effects?
					if (trackNote.hasAutoVibrato && this.inFTMode()) {
						targetPeriod = this.applyAutoVibrato(trackNote, targetPeriod);
						autoVibratoHandled = true;
					} else {
						trackNote.vibratoTimer++;
					}

					// TODO: if we ever allow multiple effect on the same tick then we should rework this as you can't have concurrent 'setPeriodAtTime' commands
					this.setPeriodAtTime(trackNote, targetPeriod, time + (tick * this.tickTime));
				}
			}
		}

		if (effects.tremolo) {
			const freq = effects.tremolo.freq;
			const amp = effects.tremolo.amplitude;

			trackNote.tremoloTimer = trackNote.tremoloTimer || 0;

			if (trackNote.volume) {
				let _volume = trackNote.startVolume;

				for (let tick = 0; tick < this.ticksPerStep; tick++) {

					_volume = this.tremoloFunction(_volume, trackNote.tremoloTimer, freq, amp);

					if (_volume < 0) {
						_volume = 0;
					}

					if (_volume > 100) {
						_volume = 100;
					}

					trackNote.volume.gain.setValueAtTime(_volume / 100, time + (tick * this.tickTime));
					trackNote.currentVolume = _volume;
					trackNote.tremoloTimer++;
				}
			}
		}

		if (effects.cutNote) {
			if (trackNote.volume) {
				trackNote.volume.gain.setValueAtTime(0, time + (effects.cutNote.value * this.tickTime));
			}

			trackNote.currentVolume = 0;
		}

		if (effects.reTrigger) {
			const instrumentIndex = trackNote.instrumentIndex;
			const notePeriod = trackNote.startPeriod;
			const volume = trackNote.startVolume;
			const noteIndex = trackNote.noteIndex;
			const triggerStep = effects.reTrigger.value || 1;
			let triggerCount = triggerStep;

			while (triggerCount < this.ticksPerStep) {
				const triggerTime = time + (triggerCount * this.tickTime);
				this.cutNote(track, triggerTime);
				this.trackNotes[track] = this.audio.playSample(instrumentIndex, notePeriod, volume, track, effects, triggerTime, noteIndex);
				triggerCount += triggerStep;
			}
		}
	}

	setBPM(newBPM) {
		if (this.clock) {
			this.clock.timeStretch(this.audio.context.currentTime, [this.mainTimer], this.bpm / newBPM);
		}
		this.bpm = newBPM;
		this.tickTime = 2.5 / this.bpm;
		events.emit(EVENT.songBPMChange, this.bpm);
	}

	getBPM() {
		return this.bpm;
	}

	setAmigaSpeed(speed) {
		// 1 tick is 0.02 seconds on a PAL Amiga
		// 4 steps is 1 beat
		// the speeds sets the amount of ticks in 1 step
		// default is 6 -> 60/(6*0.02*4) = 125 bpm

		//note: this changes the speed of the song, but not the speed of the main loop
		this.ticksPerStep = speed;
	}

	getAmigaSpeed() {
		return this.ticksPerStep;
	}

	getPatternLength() {
		return this.patternLength;
	}

	setPatternLength(value) {
		this.patternLength = value;

		const currentLength = this.song.patterns[this.currentPattern].length;
		if (currentLength === this.patternLength) {
			return;
		}

		if (currentLength < this.patternLength) {
			for (let step = currentLength; step < this.patternLength; step++) {
				const row = [];
				for (let channel = 0; channel < this.trackCount; channel++) {
					row.push(new Note(this));
				}
				this.song.patterns[this.currentPattern].push(row);
			}
		} else {
			this.song.patterns[this.currentPattern] = this.song.patterns[this.currentPattern].splice(0, this.patternLength);
			if (this.currentPatternPos >= this.patternLength) {
				this.setCurrentPatternPos(this.patternLength - 1);
			}
		}

		events.emit(EVENT.patternChange, this.currentPattern);
	}

	getTrackCount() {
		return this.trackCount;
	}

	setTrackCount(count) {
		this.trackCount = count;

		for (let i = this.trackNotes.length; i < this.trackCount; i++) {
			this.trackNotes.push({});
		}

		for (let i = this.trackEffectCache.length; i < this.trackCount; i++) {
			this.trackEffectCache.push({});
		}

		events.emit(EVENT.trackCountChange, this.trackCount);
	}

	setStateAtTime(time, state) {
		this.trackerStates.push({ time: time, state: state });
	}

	getStateAtTime(time) {
		let result = undefined;
		for (let i = 0, len = this.trackerStates.length; i < len; i++) {
			const state = this.trackerStates[0];
			if (state.time < time) {
				result = this.trackerStates.shift().state;
			} else {
				return result;
			}
		}
		return result;
	}

	getTimeStates() {
		return this.trackerStates;
	}

	setPeriodAtTime(trackNote, period, time) {
		let rate;
		period = Math.max(period, 1);

		if (this.inFTMode() && this.useLinearFrequency) {
			const sampleRate = (8363 * Math.pow(2, ((4608 - period) / 768)));
			rate = sampleRate / this.audio.context.sampleRate;
		} else {
			rate = (trackNote.startPeriod / period);
			rate = trackNote.startPlaybackRate * rate;
		}

		trackNote.source.playbackRate.setValueAtTime(rate, time);
	}

	load(url) {
		url = url || '';
		let name = '';

		if (typeof url === 'string') {
			name = url.substr(url.lastIndexOf('/') + 1);
			loadFile(url, (result) => {
				this.processFile(result, name);
			});
		} else {
			name = url.name || '';
			this.processFile(url.buffer || url, name);
		}
	}

	processFile(arrayBuffer, name) {
		events.emit(EVENT.songLoading, name);

		let file = new BinaryStream(arrayBuffer, true);
		let result = this.detector.detect(file, name);

		if (result.isMod && result.loader) {
			if (this.isPlaying) {
				this.stop();
			}

			this.resetDefaultSettings();

			this.song = result.loader().load(file, name);
			this.song.filename = name;
			this.song.trackerType = result.name;

			this.onModuleLoad();
		}

		if (result.isSample) {
			console.error('Pasuuna cannot play samples on their own');
		}
	}

	onModuleLoad() {
		if (this.song.channels) {
			this.setTrackCount(this.song.channels);
		}

		this.prevPatternPos = undefined;
		this.prevInstrumentIndex = undefined;
		this.prevPattern = undefined;
		this.prevSongPosition = undefined;


		if (this.song.patternTable) {
			this.setCurrentPattern(this.song.patternTable[0]);
		}
		this.setCurrentPatternPos(0);

		this.clearEffectsCache();

		events.emit(EVENT.songLoaded, this.song);
		events.emit(EVENT.songPropertyChange, this.song);
	}

	getSong() {
		return this.song;
	}

	getInstruments() {
		return this.instruments;
	}

	getInstrument(index) {
		return this.instruments[index];
	}

	setInstrument(index, instrument) {
		instrument.instrumentIndex = index;
		this.instruments[index] = instrument;
	}

	setTrackerMode(mode) {
		this.trackerMode = mode;
		SETTINGS.emulateProtracker1OffsetBug = !this.inFTMode();
		events.emit(EVENT.trackerModeChanged, mode);
	}

	getTrackerMode() {
		return this.trackerMode;
	}

	inFTMode() {
		return this.trackerMode === TRACKERMODE.FASTTRACKER
	}

	clearInstrument() {
		this.instruments[this.currentInstrumentIndex] = new Instrument(this);
		events.emit(EVENT.instrumentChange, this.currentInstrumentIndex);
		events.emit(EVENT.instrumentNameChange, this.currentInstrumentIndex);
	};

	getEmptyPattern() {
		const result = [];
		for (let step = 0; step < this.patternLength; step++) {
			const row = [];
			for (let channel = 0; channel < this.trackCount; channel++) {
				row.push(new Note(this));
			}
			result.push(row);
		}
		return result;
	}

}
