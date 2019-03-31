import {Tracker as T} from './tracker';
import {Audio as A} from './audio';

window.Tracker = T();
window.Audio = A(Tracker);

window.BassoonTracker = {
	init: () => { Audio.init(); Tracker.init(); },
	load: Tracker.load,
	playSong: Tracker.playSong,
	stop: Tracker.stop,
	togglePlay: Tracker.togglePlay,
	isPlaying: Tracker.isPlaying,
	getTrackCount: Tracker.getTrackCount,
	getSong: Tracker.getSong,
	getStateAtTime: Tracker.getStateAtTime,
	setCurrentSongPosition: Tracker.setCurrentSongPosition,
	audio: Audio
};
