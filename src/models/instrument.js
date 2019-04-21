import {Sample} from './sample';
import { events } from '../events';
import {EVENT} from '../enum';

export class Instrument {
	constructor(tracker) {
		this.tracker = tracker;
		this.type = 'sample';
		this.name = '';
		this.instrumentIndex = 0;
		this.sampleIndex = -1;
		this.fadeout = 128;
		this.data = [];
		this.samples = [new Sample()];
		this.sample = this.samples[0];
		this.volumeEnvelope = { raw: [], enabled: false, points: [[0, 48], [10, 64], [20, 40], [30, 18], [40, 28], [50, 18]], count: 6 };
		this.panningEnvelope = { raw: [], enabled: false, points: [[0, 32], [20, 40], [40, 24], [60, 32], [80, 32]], count: 5 };
		this.vibrato = {};
		this.sampleNumberForNotes = [];
	}

	processEnvelop(envelope, audioNode, time) {
		const tickTime = this.tracker.getProperties().tickTime;
		let maxPoint = envelope.sustain ? envelope.sustainPoint + 1 : envelope.count;
		let scheduledTime = 0;
		let lastX = 0;
		let audioParam;
		let center;
		let max;

		// some XM files seem to have loop points outside the range.
		// e.g. springmellow_p_ii.xm - instrument 15;
		envelope.loopStartPoint = Math.min(envelope.loopStartPoint, envelope.count - 1);
		envelope.loopEndPoint = Math.min(envelope.loopEndPoint, envelope.count - 1);

		let doLoop = envelope.loop && (envelope.loopStartPoint < envelope.loopEndPoint);
		if (envelope.sustain && envelope.sustainPoint <= envelope.loopStartPoint) {
			doLoop = false;
		}

		if (doLoop) {
			maxPoint = envelope.loopEndPoint + 1;
		}

		if (audioNode.gain) {
			// volume
			audioParam = audioNode.gain;
			center = 0;
			max = 64;
		} else {
			// panning node
			audioParam = audioNode.pan;
			center = 32;
			max = 32;
		}

		audioParam.setValueAtTime((envelope.points[0][1] - center) / max, time);

		for (let p = 1; p < maxPoint; p++) {
			const point = envelope.points[p];
			lastX = point[0];
			scheduledTime = lastX * tickTime;
			audioParam.linearRampToValueAtTime((point[1] - center) / max, time + scheduledTime);
		}

		if (doLoop) {
			return this.scheduleEnvelopeLoop(audioNode, time, 2, scheduledTime);
		}

		return false;
	}

	play(noteIndex, notePeriod, volume, track, trackEffects, time) {
		if (this.tracker.inFTMode()) {
			notePeriod = this.getPeriodForNote(noteIndex);
		}
		return this.tracker.audio.playSample(this.instrumentIndex, notePeriod, volume, track, trackEffects, time, noteIndex);
	};

	noteOn(time) {
		let volumeEnvelope;
		let panningEnvelope;
		let envelope;
		let scheduledTime;
		const scheduled = {};

		if (this.volumeEnvelope.enabled) {
			volumeEnvelope = this.tracker.audio.context.createGain();
			envelope = this.volumeEnvelope;
			scheduledTime = this.processEnvelop(envelope, volumeEnvelope, time);
			if (scheduledTime) {
				scheduled.volume = (time + scheduledTime);
			}
		}

		if (this.panningEnvelope.enabled && this.tracker.audio.usePanning) {
			panningEnvelope = this.tracker.audio.context.createStereoPanner();
			envelope = this.panningEnvelope;
			scheduledTime = this.processEnvelop(envelope, panningEnvelope, time);
			if (scheduledTime) {
				scheduled.panning = (time + scheduledTime);
			}
		}

		if (this.vibrato.rate && this.vibrato.depth) {
			scheduled.ticks = 0;
			scheduled.vibrato = time;
			scheduled.vibratoFunction = this.getAutoVibratoFunction();
		}

		return { volume: volumeEnvelope, panning: panningEnvelope, scheduled: scheduled };
	};

	noteOff(time, noteInfo) {
		if (!noteInfo || !noteInfo.volume) return;

		function cancelScheduledValues() {
			// Note: we should cancel Volume and Panning scheduling independently ...
			noteInfo.volume.gain.cancelScheduledValues(time);
			noteInfo.volumeFadeOut.gain.cancelScheduledValues(time);

			if (noteInfo.volumeEnvelope) {
				noteInfo.volumeEnvelope.gain.cancelScheduledValues(time);
			}

			if (noteInfo.panningEnvelope) {
				noteInfo.panningEnvelope.pan.cancelScheduledValues(time);
			}

			noteInfo.scheduled = undefined;
		}

		if (this.tracker.inFTMode()) {
			const tickTime = this.tracker.getProperties().tickTime;

			if (this.volumeEnvelope.enabled) {
				if (this.volumeEnvelope.sustain && noteInfo.volumeEnvelope) {
					cancelScheduledValues();
					let timeOffset = 0;
					const startPoint = this.volumeEnvelope.points[this.volumeEnvelope.sustainPoint];

					if (startPoint) {
						timeOffset = startPoint[0] * tickTime;
					}

					for (let p = this.volumeEnvelope.sustainPoint; p < this.volumeEnvelope.count; p++) {
						const point = this.volumeEnvelope.points[p];
						if (point) {
							noteInfo.volumeEnvelope.gain.linearRampToValueAtTime(point[1] / 64, time + (point[0] * tickTime) - timeOffset);
						}
					}
				}

				if (this.fadeout) {
					const fadeOutTime = (65536 / this.fadeout) * tickTime / 2;
					noteInfo.volumeFadeOut.gain.linearRampToValueAtTime(0, time + fadeOutTime);
				}

			} else {
				cancelScheduledValues();
				noteInfo.volumeFadeOut.gain.linearRampToValueAtTime(0, time + 0.1)
			}

			if (this.panningEnvelope.enabled && this.tracker.audio.usePanning) {
				let timeOffset = 0;
				const startPoint = this.panningEnvelope.points[this.panningEnvelope.sustainPoint];
				if (startPoint) {
					timeOffset = startPoint[0] * tickTime;
				}

				for (let p = this.panningEnvelope.sustainPoint; p < this.panningEnvelope.count; p++) {
					const point = this.panningEnvelope.points[p];
					if (point) {
						noteInfo.panningEnvelope.pan.linearRampToValueAtTime((point[1] - 32) / 32, time + (point[0] * tickTime) - timeOffset);
					}
				}
			}

			return 100;

		} else {
			cancelScheduledValues();
			if (noteInfo.isKey && noteInfo.volume) {
				noteInfo.volume.gain.linearRampToValueAtTime(0, time + 0.5)
			} else {
				return 0;
			}
		}

	};

	scheduleEnvelopeLoop(audioNode, startTime, seconds, scheduledTime) {
		// note - this is not 100% accurate when the ticktime would change during the scheduled ahead time
		scheduledTime = scheduledTime || 0;
		const tickTime = this.tracker.getProperties().tickTime;
		let envelope;
		let audioParam;
		let center;
		let max;

		if (audioNode.gain) {
			// volume
			envelope = this.volumeEnvelope;
			audioParam = audioNode.gain;
			center = 0;
			max = 64;
		} else {
			// panning node
			envelope = this.panningEnvelope;
			audioParam = audioNode.pan;
			center = 32;
			max = 32;
		}

		let point = envelope.points[envelope.loopStartPoint];
		let loopStartX = point[0];

		const doLoop = envelope.loop && (envelope.loopStartPoint < envelope.loopEndPoint);
		if (doLoop) {
			while (scheduledTime < seconds) {
				const startScheduledTime = scheduledTime;
				for (let p = envelope.loopStartPoint; p <= envelope.loopEndPoint; p++) {
					point = envelope.points[p];
					scheduledTime = startScheduledTime + ((point[0] - loopStartX) * tickTime);
					audioParam.linearRampToValueAtTime((point[1] - center) / max, startTime + scheduledTime);
				}
			}
		}

		return scheduledTime;
	};


	scheduleAutoVibrato(note, seconds) {
		// this is only used for keyboard notes as in the player the main playback timer is used for this
		const tickTime = this.tracker.getProperties().tickTime;
		let scheduledTime = 0;
		note.scheduled.ticks = note.scheduled.ticks || 0;

		const freq = -this.vibrato.rate / 40;
		const amp = this.tracker.useLinearFrequency ? this.vibrato.depth / 2 : this.vibrato.depth / 8;

		let currentPeriod;
		let vibratoFunction;
		let time;
		let tick;

		if (note.source) {
			currentPeriod = note.startPeriod;
			vibratoFunction = note.scheduled.vibratoFunction || this.tracker.audio.waveFormFunction.sine;
			time = note.scheduled.vibrato || this.tracker.audio.context.currentTime;
			tick = 0;
		}


		while (scheduledTime < seconds) {
			scheduledTime += tickTime;

			if (currentPeriod) {
				let sweepAmp = 1;
				if (this.vibrato.sweep && note.scheduled.ticks < this.vibrato.sweep) {
					sweepAmp = 1 - ((this.vibrato.sweep - note.scheduled.ticks) / this.vibrato.sweep);
				}

				const targetPeriod = vibratoFunction(currentPeriod, note.scheduled.ticks, freq, amp * sweepAmp);
				this.tracker.setPeriodAtTime(note, targetPeriod, time + (tick * tickTime));
				tick++;
			}
			note.scheduled.ticks++;
		}

		return scheduledTime;
	};

	getAutoVibratoFunction() {
		switch (this.vibrato.type) {
			case 1: return this.tracker.audio.waveFormFunction.square;
			case 2: return this.tracker.audio.waveFormFunction.saw;
			case 3: return this.tracker.audio.waveFormFunction.sawInverse;
		}
		return this.tracker.audio.waveFormFunction.sine;
	};

	resetVolume(time, noteInfo) {
		if (noteInfo.volumeFadeOut) {
			noteInfo.volumeFadeOut.gain.cancelScheduledValues(time);
			noteInfo.volumeFadeOut.gain.setValueAtTime(1, time);
		}

		if (noteInfo.volumeEnvelope) {
			noteInfo.volumeEnvelope.gain.cancelScheduledValues(time);
			const tickTime = this.tracker.getProperties().tickTime;
			const maxPoint = this.volumeEnvelope.sustain ? this.volumeEnvelope.sustainPoint + 1 : this.volumeEnvelope.count;

			noteInfo.volumeEnvelope.gain.setValueAtTime(this.volumeEnvelope.points[0][1] / 64, time);

			for (let p = 1; p < maxPoint; p++) {
				const point = this.volumeEnvelope.points[p];
				noteInfo.volumeEnvelope.gain.linearRampToValueAtTime(point[1] / 64, time + (point[0] * tickTime));
			}
		}
	};

	getFineTune() {
		return this.tracker.inFTMode() ? this.sample.finetuneX : this.sample.finetune;
	};

	setFineTune(finetune) {
		if (this.tracker.inFTMode()) {
			this.sample.finetuneX = finetune;
			this.sample.finetune = finetune >> 4;
		} else {
			if (finetune > 7) finetune = finetune - 15;
			this.sample.finetune = finetune;
			this.sample.finetuneX = finetune << 4;
		}
	};

	// in FT mode
	getPeriodForNote(noteIndex, withFineTune) {
		let result = 0;

		if (this.tracker.useLinearFrequency) {
			result = 7680 - (noteIndex - 1) * 64;
			if (withFineTune) result -= this.getFineTune() / 2;
		} else {
			result = this.tracker.FTNotes[noteIndex].period;
			if (withFineTune && this.getFineTune()) {
				result = this.tracker.audio.getFineTuneForNote(noteIndex, this.getFineTune());
			}
		}

		return result;
	};

	setSampleForNoteIndex(noteIndex) {
		const sampleIndex = this.sampleNumberForNotes[noteIndex - 1];
		if (sampleIndex !== this.sampleIndex && typeof sampleIndex === 'number') {
			this.setSampleIndex(sampleIndex);
		}
	};

	setSampleIndex(index) {
		if (this.sampleIndex !== index) {
			this.sample = this.samples[index];
			this.sampleIndex = index;

			events.emit(EVENT.sampleIndexChange, this.instrumentIndex);
		}
	};

	hasSamples() {
		for (let i = 0, max = this.samples.length; i < max; i++) {
			if (this.samples[i].length) {
				return true;
			}
		}
	};

	hasVibrato() {
		return this.vibrato.rate && this.vibrato.depth;
	};

}