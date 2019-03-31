window.Tracker = require('./tracker')();
window.Audio = require('./audio')(Tracker);

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
