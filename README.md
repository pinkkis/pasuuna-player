# Pasuuna mod player

Mod player with support for SoundTracker, ProTracker and FastTracker formats. See basic demo of it in action: https://pinkkis.github.io/pasuuna-player

Based on [BassoonTracker](https://github.com/steffest/BassoonTracker) by @Steffest

## Goals
The goal of this project is to rewrite the player portion, to only have playback, and add a better eventing system.

This will then be used for Phaser 3 and other browser games with additional plugins.

Still a work in progress, will create proper demos once we're there.

# Notes
* There is a small delay between the playback events firing and playback itself. You can find the delay in the enum.js/SETTINGS constants. It's probably set to about 0.05. If you don't need accuracy, you can increase this. It may improve cpu usage/compatibility. But on higher delays, you can't for exampel track pattern changes or notes playing.