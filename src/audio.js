import { bus } from './eventBus';
import { FilterChain } from './audio/filterChain';

import {
	EVENT,
	STEREOSEPARATION,
	AMIGA_PALFREQUENCY_HALF,
	PC_FREQUENCY_HALF,
	NOTEPERIOD,
	NOTEOFF,
	SETTINGS
} from './enum';

export class Audio {
	constructor(tracker) {
		this.tracker = tracker;

		this.audioContext = new AudioContext();
		this.offlineContext = null;
		this.context = this.audioContext;

		this.masterVolume = null;
		this.cutOffVolume = null;
		this.lowPassfilter = null;
		this.filterChains = [];
		this.isRecording = false;
		this.mediaRecorder = null;
		this.recordingChunks = [];
		this.currentStereoSeparation = STEREOSEPARATION.BALANCED;
		this.lastMasterVolume = 0;
		this.usePanning = false;
		this.scheduledNotes = [[], [], []];
		this.scheduledNotesBucket = 0;
		this.prevSampleRate = 4143.569;
		this.isRendering = false;
		this.filters = {
			volume: true,
			panning: true,
			high: true,
			mid: true,
			low: true,
			lowPass: true,
			reverb: true,
			distortion: false
		};
		this.waveFormFunction = {
			sine: (period, progress, freq, amp) => {
				return period + (Math.sin(progress * freq * 0.8) * amp * 1.7);
			},
			saw: (period, progress, freq, amp) => {
				let value = 1 - Math.abs(((progress * freq / 7) % 1)); // from 1 to 0
				value = (value * 2) - 1; // from -1 to 1
				value = value * amp * -2;
				return period + value;
			},
			square: (period, progress, freq, amp) => {
				let value = Math.sin(progress * freq) <= 0 ? -1 : 1;
				value = value * amp * 2;
				return period + value;
			},
			sawInverse: (period, progress, freq, amp) => {
				let value = Math.abs((progress * freq / 7) % 1); // from 0 to 1
				value = (value * 2) - 1; // from -1 to 1
				value = value * amp * -2;
				return period + value;
			}
		};
	}

	createAudioConnections(actx) {
		this.cutOffVolume = actx.createGain();
		this.cutOffVolume.gain.setValueAtTime(1, 0);
		this.cutOffVolume.connect(actx.destination);

		this.masterVolume = actx.createGain();
		this.masterVolume.connect(this.cutOffVolume);
		this.setMasterVolume(1);

		this.lowPassfilter = actx.createBiquadFilter();
		this.lowPassfilter.type = 'lowpass';
		this.lowPassfilter.frequency.setValueAtTime(20000, 0);

		this.lowPassfilter.connect(this.masterVolume);
	}

	addFilterChain() {
		const filterChain = new FilterChain(this, this.filters);
		filterChain.output.connect(this.lowPassfilter);
		this.filterChains.push(filterChain);
	}

	init(actx) {
		actx = actx || this.audioContext;
		if (!actx) {
			console.warn('No audioContext');
			return;
		} else {
			this.context = actx;
		}

		this.usePanning = !!this.context.createStereoPanner;
		if (!this.usePanning) {
			console.warn('Browser does not support StereoPanners, mono only');
		}

		this.createAudioConnections(actx);

		const numberOfTracks = this.tracker.getTrackCount();
		this.filterChains = [];

		for (let i = 0; i < numberOfTracks; i++) {
			this.addFilterChain();
		}

		if (!this.isRendering) {
			bus.on(EVENT.trackStateChange, (state) => {
				if (typeof state.track !== 'undefined' && this.filterChains[state.track]) {
					this.filterChains[state.track].volumeValue(state.mute ? 0 : 70);
				}
			});

			bus.on(EVENT.trackCountChange, (trackCount) => {
				for (let i = this.filterChains.length; i < trackCount; i++) {
					this.addFilterChain();
				}

				bus.trigger(EVENT.filterChainCountChange, trackCount);
				this.setStereoSeparation(this.currentStereoSeparation);
			});

			bus.on(EVENT.trackerModeChanged, (mode) => {
				this.setStereoSeparation(/*mode*/);
			});
		}
	};

	enable() {
		this.cutOffVolume.gain.setValueAtTime(1, 0);
		this.cutOff = false;
	};

	disable() {
		this.cutOffVolume.gain.setValueAtTime(0, 0);
		this.cutOff = true;

		let totalNotes = 0;
		this.scheduledNotes.forEach((bucket, index) => {
			totalNotes += bucket.length;
			bucket.forEach(function (volume) {
				volume.gain.cancelScheduledValues(0);
				volume.gain.setValueAtTime(0, 0);
			});
			this.scheduledNotes[index] = [];
		});

		if (totalNotes) console.log(totalNotes + ' cleared');
	};

	checkState() {
		if (this.context) {
			if (this.context.state === 'suspended' && this.context.resume) {
				console.info('Audio context is suspended - trying to resume');
				this.context.resume();
			}
		}
	};


	playSample(index, period, volume, track, effects, time, noteIndex) {
		let audioContext;
		if (this.isRendering) {
			audioContext = this.offlineContext;
		} else {
			audioContext = this.audioContext;
			this.enable();
		}

		period = period || 428; // C-3
		if (typeof track === 'undefined') {
			track = 0;
		}

		time = time || audioContext.currentTime;

		if (noteIndex === NOTEOFF) {
			volume = 0; // note off
		}

		const instrument = this.tracker.getInstrument(index);
		const basePeriod = period;
		let volumeEnvelope;
		let panningEnvelope;
		let scheduled;
		let pan = 0;

		if (instrument) {
			let sampleBuffer;
			let offset = 0;
			let sampleLength = 0;
			let sampleRate;
			let initialPlaybackRate = 1;
			let panning = null;

			volume = typeof volume === 'undefined' ? (100 * instrument.sample.volume / 64) : volume;
			pan = (instrument.sample.panning || 0) / 128;

			// apply finetune
			if (this.tracker.inFTMode()) {
				if (this.tracker.useLinearFrequency) {
					period -= instrument.getFineTune() / 2;
				} else {
					if (instrument.getFineTune()) {
						period = this.getFineTuneForNote(noteIndex, instrument.getFineTune());
					}
				}
			} else {
				// protracker frequency
				if (instrument.getFineTune()) {
					period = this.getFineTuneForPeriod(period, instrument.getFineTune());
				}
			}

			sampleRate = this.getSampleRateForPeriod(period);

			if (instrument.sample.data.length) {
				sampleLength = instrument.sample.data.length;
				if (effects && effects.offset) {
					if (effects.offset.value >= sampleLength) effects.offset.value = sampleLength - 1;
					offset = effects.offset.value / audioContext.sampleRate; // in seconds
				}
				// note - on safari you can't set a different samplerate?
				sampleBuffer = audioContext.createBuffer(1, sampleLength, audioContext.sampleRate);
				initialPlaybackRate = sampleRate / audioContext.sampleRate;
			} else {
				// empty samples are often used to cut of the previous instrument
				sampleBuffer = audioContext.createBuffer(1, 1, audioContext.sampleRate);
				offset = 0;
			}

			const buffering = sampleBuffer.getChannelData(0);
			for (let i = 0; i < sampleLength; i++) {
				buffering[i] = instrument.sample.data[i];
			}

			this.prevSampleRate = sampleRate;
			const source = audioContext.createBufferSource();
			source.buffer = sampleBuffer;

			const volumeGain = audioContext.createGain();
			volumeGain.gain.value = volume / 100;
			volumeGain.gain.setValueAtTime(volume / 100, time);

			if (instrument.sample.loop.enabled && instrument.sample.loop.length > 2) {
				if (!SETTINGS.unrollLoops) {
					source.loop = true;
					// in seconds ...
					source.loopStart = instrument.sample.loop.start / audioContext.sampleRate;
					source.loopEnd = (instrument.sample.loop.start + instrument.sample.loop.length) / audioContext.sampleRate;
					//audioContext.sampleRate = samples/second
				}
			}

			if (instrument.volumeEnvelope.enabled || instrument.panningEnvelope.enabled || instrument.hasVibrato()) {
				const envelopes = instrument.noteOn(time);
				let target = source;

				if (envelopes.volume) {
					volumeEnvelope = envelopes.volume;
					source.connect(volumeEnvelope);
					target = volumeEnvelope;
				}

				if (envelopes.panning) {
					panningEnvelope = envelopes.panning;
					target.connect(panningEnvelope);
					target = panningEnvelope;
				}

				scheduled = envelopes.scheduled;

				target.connect(volumeGain);

			} else {
				source.connect(volumeGain);
			}

			const volumeFadeOut = this.context.createGain();
			volumeFadeOut.gain.setValueAtTime(0, time);
			volumeFadeOut.gain.linearRampToValueAtTime(1, time + 0.01);
			volumeGain.connect(volumeFadeOut);

			if (this.usePanning) {
				panning = this.context.createStereoPanner();
				panning.pan.setValueAtTime(pan, time);
				volumeFadeOut.connect(panning);
				panning.connect(this.filterChains[track].input);
			} else {
				volumeFadeOut.connect(this.filterChains[track].input);
			}

			source.playbackRate.value = initialPlaybackRate;
			let sourceDelayTime = 0;
			let playTime = time + sourceDelayTime;

			source.start(playTime, offset);

			var result = {
				source: source,
				volume: volumeGain,
				panning: panning,
				volumeEnvelope: volumeEnvelope,
				panningEnvelope: panningEnvelope,
				volumeFadeOut: volumeFadeOut,
				startVolume: volume,
				currentVolume: volume,
				startPeriod: period,
				basePeriod: basePeriod,
				noteIndex: noteIndex,
				startPlaybackRate: initialPlaybackRate,
				sampleRate: sampleRate,
				instrumentIndex: index,
				effects: effects,
				track: track,
				time: time,
				scheduled: scheduled
			};

			this.scheduledNotes[this.scheduledNotesBucket].push(volumeGain);

			if (!this.isRendering) {
				bus.trigger(EVENT.samplePlay, result);
			}

			return result;
		}

		return {};
	};

	playSilence() {
		// used to activate Audio engine on first touch in IOS and Android devices
		if (this.context) {
			const source = context.createBufferSource();
			source.connect(this.masterVolume);
			source.start();
		}
	};

	playRaw(data, sampleRate) {
		// used to loose snippets of samples (ranges etc)
		if (this.context && data && data.length) {
			const sampleBuffer = this.context.createBuffer(1, data.length, this.context.sampleRate);
			const initialPlaybackRate = sampleRate / audioContext.sampleRate;
			const source = context.createBufferSource();
			source.buffer = sampleBuffer;
			source.loop = true;
			source.playbackRate.value = initialPlaybackRate;
			source.connect(this.masterVolume);
			source.start();
		}
	};

	// startRecording() {
	// 	if (!isRecording) {

	// 		if (context && context.createMediaStreamDestination) {
	// 			var dest = context.createMediaStreamDestination();
	// 			mediaRecorder = new MediaRecorder(dest.stream);

	// 			iaRecorder.ondataavailable(evt) {
	// 				// push each chunk (blobs) in an array
	// 				recordingChunks.push(evt.data);
	// 			};

	// 			iaRecorder.onstop(evt) {
	// 				var blob = new Blob(recordingChunks, { 'type': 'audio/ogg; codecs=opus' });
	// 				saveAs(blob, 'recording.opus');
	// 				//document.querySelector('audio').src = URL.createObjectURL(blob);
	// 			};


	// 			masterVolume.connect(dest);
	// 			mediaRecorder.start();
	// 			isRecording = true;

	// 		} else {
	// 			console.error('recording is not supported on this browser');
	// 		}

	// 	}
	// };

	// stopRecording() {
	// 	if (isRecording) {
	// 		isRecording = false;
	// 		mediaRecorder.stop();
	// 	}
	// };

	startRendering(length) {
		this.isRendering = true;

		console.log('startRendering ' + length);
		this.offlineContext = new OfflineAudioContext(2, 44100 * length, 44100);
		this.context = this.offlineContext;
		this.init(this.offlineContext);
	};

	stopRendering(next) {
		this.isRendering = false;

		this.offlineContext.startRendering()
			.then((renderedBuffer) => {
				console.log('Rendering completed successfully');
				if (next) next(renderedBuffer);
			}).catch((err) => {
				console.log('Rendering failed: ' + err);
				// Note: The promise should reject when startRendering is called a second time on an OfflineAudioContext
			});

		// switch back to online Audio context;
		this.context = this.audioContext;
		this.createAudioConnections(this.context);
		this.init(this.context);
	};

	setStereoSeparation(value) {
		let panAmount;
		const numberOfTracks = this.tracker.getTrackCount();

		if (this.tracker.inFTMode()) {
			panAmount = 0;
		} else {
			value = value || this.currentStereoSeparation;
			this.currentStereoSeparation = value;

			switch (value) {
				case STEREOSEPARATION.NONE:
					// mono, no panning
					panAmount = 0;
					SETTINGS.stereoSeparation = STEREOSEPARATION.NONE;
					break;
				case STEREOSEPARATION.FULL:
					// Amiga style: pan even channels hard to the left, uneven to the right;
					panAmount = 1;
					SETTINGS.stereoSeparation = STEREOSEPARATION.FULL;
					break;
				default:
					// balanced: pan even channels somewhat to the left, uneven to the right;
					panAmount = 0.5;
					SETTINGS.stereoSeparation = STEREOSEPARATION.BALANCED;
					break;
			}
		}

		for (let i = 0; i < numberOfTracks; i++) {
			var filter = this.filterChains[i];
			if (filter) filter.panningValue(i % 2 == 0 ? -panAmount : panAmount);
		}
	};

	getPrevSampleRate() {
		return this.prevSampleRate;
	};

	createPingPongDelay() {
		// example of delay effect.
		// Taken from http://stackoverflow.com/questions/20644328/using-channelsplitter-and-mergesplitter-nodes-in-web-audio-api

		const delayTime = 0.12;
		const feedback = 0.3;
		const merger = this.context.createChannelMerger(2);
		const leftDelay = this.context.createDelay();
		const rightDelay = this.context.createDelay();
		const leftFeedback = this.context.createGain();
		const rightFeedback = this.context.createGain();
		const splitter = this.context.createChannelSplitter(2);

		splitter.connect(leftDelay, 0);
		splitter.connect(rightDelay, 1);

		leftDelay.delayTime.value = delayTime;
		rightDelay.delayTime.value = delayTime;

		leftFeedback.gain.value = feedback;
		rightFeedback.gain.value = feedback;

		// Connect the routing - left bounces to right, right bounces to left.
		leftDelay.connect(leftFeedback);
		leftFeedback.connect(rightDelay);

		rightDelay.connect(rightFeedback);
		rightFeedback.connect(leftDelay);

		// Re-merge the two delay channels into stereo L/R
		leftFeedback.connect(merger, 0, 0);
		rightFeedback.connect(merger, 0, 1);

		// Now connect your input to 'splitter', and connect 'merger' to your output destination.
		return {
			splitter: splitter,
			merger: merger
		}
	}

	/**
	* get a new AudioNode playing at x semitones from the root note
	* used to create Chords and Arpeggio
	*
	* @param {audioNode} source: audioBuffer of the root note
	* @param {Number} root: period of the root note
	* @param {Number} semitones: amount of semitones from the root note
	* @param {Number} finetune: finetune value of the base instrument
	* @return {audioNode} audioBuffer of the new note
	**/
	semiTonesFrom(source, root, semitones, finetune) {
		const target = context.createBufferSource();
		target.buffer = source.buffer;

		if (semitones) {
			const rootNote = this.tracker.periodNoteTable[root];
			const rootIndex = this.tracker.noteNames.indexOf(rootNote.name);
			const targetName = this.tracker.noteNames[rootIndex + semitones];
			if (targetName) {
				const targetNote = this.tracker.nameNoteTable[targetName];
				if (targetNote) {
					target.playbackRate.value = (rootNote.period / targetNote.period) * source.playbackRate.value;
				}
			}
		} else {
			target.playbackRate.value = source.playbackRate.value
		}

		return target;
	}

	getSemiToneFrom(period, semitones, finetune) {
		let result = period;

		if (finetune) {
			period = this.getFineTuneBasePeriod(period, finetune);
			if (!period) {
				period = result;
				console.error('ERROR: base period for finetuned ' + finetune + ' period ' + period + ' not found');
			}
		}

		if (semitones) {
			const rootNote = this.tracker.periodNoteTable[period];
			if (rootNote) {
				const rootIndex = this.tracker.noteNames.indexOf(rootNote.name);
				const targetName = this.tracker.noteNames[rootIndex + semitones];

				if (targetName) {
					const targetNote = this.tracker.nameNoteTable[targetName];
					if (targetNote) {

						result = targetNote.period;
						if (finetune) {
							result = this.getFineTuneForPeriod(result, finetune);
						}
					}
				}
			} else {
				console.error('ERROR: note for period ' + period + ' not found');
				// note: this can happen when the note is in a period slide
				// FIXME
			}
		}
		return result;
	}

	getNearestSemiTone(period, instrumentIndex) {
		let tuning = 8;
		if (instrumentIndex) {
			const instrument = this.tracker.getInstrument(instrumentIndex);
			if (instrument && instrument.sample.finetune) {
				tuning = tuning + instrument.sample.finetune;
			}
		}

		let minDelta = 100000;
		let result = period;
		for (const note in NOTEPERIOD) {
			if (NOTEPERIOD.hasOwnProperty(note)) {
				const p = NOTEPERIOD[note].tune[tuning];
				const delta = Math.abs(p - period);
				if (delta < minDelta) {
					minDelta = delta;
					result = p;
				}
			}
		}

		return result;
	}

	// gives the finetuned period for a base period - protracker mode
	getFineTuneForPeriod(period, finetune) {
		let result = period;
		const note = this.tracker.periodNoteTable[period];
		if (note && note.tune) {
			let centerTune = 8;
			let tune = 8 + finetune;
			if (tune >= 0 && tune < note.tune.length) {
				result = note.tune[tune];
			}
		}

		return result;
	}

	// gives the finetuned period for a base note (Fast Tracker Mode)
	getFineTuneForNote(note, finetune) {
		if (note === NOTEOFF) { return 1; }

		const ftNote1 = this.tracker.FTNotes[note];
		const ftNote2 = finetune > 0 ? this.tracker.FTNotes[note + 1] : this.tracker.FTNotes[note - 1];

		if (ftNote1 && ftNote2) {
			const delta = Math.abs(ftNote2.period - ftNote1.period) / 127;
			return ftNote1.period - (delta * finetune)
		}

		console.warn('unable to find finetune for note ' + note, ftNote1);
		return ftNote1 ? ftNote1.period : 100000;
	}

	// gives the non-finetuned baseperiod for a finetuned period
	getFineTuneBasePeriod(period, finetune) {
		let result = period;
		const table = this.tracker.periodFinetuneTable[finetune];
		if (table) {
			result = table[period];
		}
		return result;
	}

	getSampleRateForPeriod(period) {
		if (this.tracker.inFTMode()) {
			if (this.tracker.useLinearFrequency) {
				return (8363 * Math.pow(2, ((4608 - period) / 768)));
			}

			return PC_FREQUENCY_HALF / period;
		}
		return AMIGA_PALFREQUENCY_HALF / period;
	}

	limitAmigaPeriod(period) {
		// limits the period to the allowed Amiga frequency range, between 113 (B3) and 856 (C1)
		period = Math.max(period, 113);
		period = Math.min(period, 856);

		return period;
	}

	setAmigaLowPassFilter(on, time) {
		// note: this is determined by ear comparing a real Amiga 500 - maybe too much effect ?
		const value = on ? 2000 : 20000;
		this.lowPassfilter.frequency.setValueAtTime(value, time);
	}

	setMasterVolume(value, time) {
		time = time || this.context.currentTime;
		value = value * 0.7;
		this.masterVolume.gain.setValueAtTime(this.lastMasterVolume, time);
		this.masterVolume.gain.linearRampToValueAtTime(value, time + 0.02);
		this.lastMasterVolume = value;
	}

	slideMasterVolume(value, time) {
		time = time || this.context.currentTime;
		value = value * 0.7;
		this.masterVolume.gain.linearRampToValueAtTime(value, time);
		this.lastMasterVolume = value;
	}

	getLastMasterVolume() {
		return this.lastMasterVolume / 0.7;
	}

	clearScheduledNotesCache() {
		// 3 rotating caches
		this.scheduledNotesBucket++;
		if (this.scheduledNotesBucket > 2) {
			this.scheduledNotesBucket = 0;
		}

		this.scheduledNotes[this.scheduledNotesBucket] = [];
	}
}
