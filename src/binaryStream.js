export class BinaryStream {
	constructor(arrayBuffer, bigEndian) {
		this.index = 0;
		this.littleEndian = !bigEndian;
		this.buffer = arrayBuffer;
		this.dataView = new DataView(arrayBuffer);
		this.length = arrayBuffer.byteLength;
	}

	setIndex(value) {
		value = value === 0 ? value : value || this.index;
		if (value < 0) {
			value = 0;
		}

		if (value >= this.length) {
			value = this.length - 1;
		}

		this.index = value;
	}

	goto(value) {
		this.setIndex(value);
	}

	jump(value) {
		this.goto(this.index + value);
	}

	readByte(position) {
		this.setIndex(position);
		const b = this.dataView.getInt8(this.index);
		this.index++;
		return b;
	}

	readUbyte(position) {
		this.setIndex(position);
		const b = this.dataView.getUint8(this.index);
		this.index++;
		return b;
	}

	readLong(position) { return this.readUint(position); }
	readDWord(position) { return this.readUint(position); }
	readUint(position) {
		this.setIndex(position);
		const i = this.dataView.getUint32(this.index, this.littleEndian);
		this.index += 4;
		return i;
	}

	readBytes(len, position) {
		this.setIndex(position);
		const buffer = new Uint8Array(len);
		let offset = 0;
		let i = this.index

		if ((len += i) > this.length) {
			len = this.length;
		}

		for (; i < len; ++i) {
			buffer.setUint8(offset++, this.dataView.getUint8(i));
		}

		this.setIndex(len);
		return buffer;
	}

	readString(len, position) {
		this.setIndex(position);
		let i = this.index;
		let src = this.dataView;
		let text = '';

		if ((len += i) > this.length) {
			len = this.length;
		}

		for (; i < len; ++i) {
			const c = src.getUint8(i);
			if (c == 0) { break; }
			text += String.fromCharCode(c);
		}

		this.setIndex(len);
		return text;
	}

	// same as readUshort
	readWord(position) {
		this.setIndex(position);
		var w = this.dataView.getUint16(this.index, this.littleEndian);
		this.index += 2;
		return w;
	}

	readShort(value, position) {
		this.setIndex(position);
		var w = this.dataView.getInt16(this.index, this.littleEndian);
		this.index += 2;
		return w;
	};

	isEOF(margin) {
		margin = margin || 0;
		return this.index >= (this.length - margin);
	};
}
