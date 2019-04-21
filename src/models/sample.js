export class Sample {
	constructor() {
		this.data = [];
		this.length = 0;
		this.name = '';
		this.bits = 8;
		this.volume = 64;
		this.finetune = 0;
		this.finetuneX = 0;
		this.panning = 0;
		this.relativeNote = 0;
		this.loop = {
			enabled: false,
			start: 0,
			length: 0,
			type: 0
		};
	}

	check() {
		let min = 0;
		let max = 0;
		for (let i = 0; i < this.data.length; i++) {
			min = Math.min(min, this.data[i]);
			max = Math.max(max, this.data[i]);
		}
		return { min, max };
	}
}
