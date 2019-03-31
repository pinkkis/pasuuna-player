export class FilterChain {
	constructor(audio, filters) {
		this.filters = filters || {
			volume: true,
			panning: true
		};

		this.input = null;
		this.output = null;
		this.output2 = null;
		this.volumeGain = null;
		this.highGain = null;
		this.midGain = null;
		this.lowGain = null;
		this.lowPassfilter = null;
		this.reverb = null;
		this.reverbGain = null;
		this.panner = null;

		this.context = audio.context;

		this.useVolume = filters.volume;
		this.usePanning = filters.panning && this.context.createStereoPanner;
		this.useHigh = filters.high;
		this.useMid = filters.mid;
		this.useLow = filters.low;
		this.useLowPass = filters.lowPass;
		this.useReverb = filters.reverb;
		this.useDistortion = filters.distortion;

		this._lowValue = 0.0;
		this._midValue = 0.0;
		this._highValue = 0.0;
		this._volumeValue = 70;
		this._panningValue = 0;
		this.FREQ_MUL = 7000;
		this.QUAL_MUL = 30;

		// use a simple Gain as input so that we can leave this connected while changing filters
		this.input = this.context.createGain();
		this.input.gain.value = 1;
		this.output = this.input;

		this.connectFilters();
		this.volumeValue(this._volumeValue);
	}

	lowValue(value) {
		if (!this.useLow) return;
		if (typeof value !== "undefined") {
			const maxRange = 20;
			this._lowValue = value;
			this.lowGain.gain.value = this._lowValue * maxRange;
		}
		return this._lowValue;
	};

	midValue(value) {
		if (!this.useMid) return;
		if (typeof value !== "undefined") {
			const maxRange = 20;
			this._midValue = value;
			this.midGain.gain.value = this._midValue * maxRange;
		}
		return this._midValue;
	};

	highValue(value) {
		if (!this.useHigh) return;
		if (typeof value !== "undefined") {
			const maxRange = 20;
			this._highValue = value;
			this.highGain.gain.value = this._highValue * maxRange;
		}
		return this._highValue;
	};

	lowPassFrequencyValue(value) {
		if (!this.useLowPass) return;
		// Clamp the frequency between the minimum value (40 Hz) and half of the
		// sampling rate.
		const minValue = 40;
		const maxValue = this.context.sampleRate / 2;
		// Logarithm (base 2) to compute how many octaves fall in the range.
		const numberOfOctaves = Math.log(maxValue / minValue) / Math.LN2;
		// Compute a multiplier from 0 to 1 based on an exponential scale.
		const multiplier = Math.pow(2, numberOfOctaves * (value - 1.0));
		// Get back to the frequency value between min and max.

		this.lowPassfilter.frequency.value = maxValue * multiplier;
	};

	lowPassQualityValue(value) {
		if (!this.useLowPass) return;
		this.lowPassfilter.Q.value = value * QUAL_MUL;
	};

	volumeValue(value) {
		if (!this.useVolume) return;
		if (typeof value !== "undefined") {
			const max = 100;
			const fraction = value / max;
			this._volumeValue = value;
			this.volumeGain.gain.value = fraction * fraction;
		}
		return this._volumeValue;
	};

	panningValue(value, time) {
		if (!this.usePanning) return;

		if (typeof value !== "undefined") {
			this._panningValue = value;
			if (time) {
				this.panner.pan.setValueAtTime(this._panningValue, time);
			} else {
				// very weird bug in safari on OSX ... setting pan.value directy to 0 does not work
				this.panner.pan.setValueAtTime(this._panningValue, this.context.currentTime);
			}

		}
		return this._panningValue;
	};

	setState(name, value) {
		console.error(name, value);

		this.disConnectFilter();

		if (name === "high") this.useHigh = !!value;
		if (name === "mid")  this.useMid = !!value;
		if (name === "low")  this.useLow = !!value;
		if (name === "lowPass") this.useLowPass = !!value;
		if (name === "reverb")  this.useReverb = !!value;
		if (name === "panning") this.usePanning = (!!value) && this.context.createStereoPanner;

		this.connectFilters();

	};

	connectFilters() {
		this.output = this.input;

		if (this.useHigh) {
			this.highGain = this.highGain || this.createHigh();
			this.output.connect(this.highGain);
			this.output = this.highGain;
		}

		if (this.useMid) {
			this.midGain = this.midGain || this.createMid();
			this.output.connect(this.midGain);
			this.output = this.midGain;
		}

		if (this.useLow) {
			this.lowGain = this.lowGain || this.createLow();
			this.output.connect(this.lowGain);
			this.output = this.lowGain;
		}

		if (this.useLowPass) {
			this.lowPassfilter = this.lowPassfilter || this.createLowPass();
			this.output.connect(this.lowPassfilter);
			this.output = this.lowPassfilter;
		}

		if (this.useReverb) {
			this.reverb = this.reverb || this.context.createConvolver();
			this.reverbGain = this.reverbGain || this.context.createGain();
			this.reverbGain.gain.value = 0;

			this.output.connect(this.reverbGain);
			this.reverbGain.connect(this.reverb);
			this.output2 = this.reverb;
		}

		if (this.useDistortion) {
			const distortion = this.context.createWaveShaper();
			distortion.curve = this.distortionCurve(400);
			distortion.oversample = '4x';
		}

		if (this.usePanning) {
			this.panner = this.panner || this.context.createStereoPanner();
			this.output.connect(this.panner);
			this.output = this.panner;
		}

		this.volumeGain = this.volumeGain || this.context.createGain();
		this.output.connect(this.volumeGain);
		if (this.output2) this.output2.connect(this.volumeGain);
		this.output = this.volumeGain;
	}

	disConnectFilter() {
		this.input.disconnect();
		if (this.highGain) this.highGain.disconnect();
		if (this.midGain) this.midGain.disconnect();
		if (this.lowGain) this.lowGain.disconnect();
		if (this.lowPassfilter) this.lowPassfilter.disconnect();
		if (this.reverbGain) this.reverbGain.disconnect();
		if (this.panner) this.panner.disconnect();
		this.output2 = undefined;
	}


	createHigh() {
		const filter = this.context.createBiquadFilter();
		filter.type = "highshelf";
		filter.frequency.value = 3200.0;
		filter.gain.value = this._highValue;
		return filter;
	}

	createMid() {
		const filter = this.context.createBiquadFilter();
		filter.type = "peaking";
		filter.frequency.value = 1000.0;
		filter.Q.value = 0.5;
		filter.gain.value = this._midValue;
		return filter;
	}

	createLow() {
		const filter = this.context.createBiquadFilter();
		filter.type = "lowshelf";
		filter.frequency.value = 320.0;
		filter.gain.value = this._lowValue;
		return filter;
	}

	createLowPass() {
		const filter = this.context.createBiquadFilter();
		filter.type = "lowpass";
		filter.frequency.value = 5000;
		return filter;
	}

	distortionCurve(amount) {
		const k = typeof amount === 'number' ? amount : 50;
		const n_samples = 44100;
		const curve = new Float32Array(n_samples);
		const deg = Math.PI / 180;
		let x;

		for (i = 0; i < n_samples; ++i) {
			x = i * 2 / n_samples - 1;
			curve[i] = (3 + k) * x * 20 * deg / (Math.PI + k * Math.abs(x));
		}
		return curve;
	}
};
