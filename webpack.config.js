const path = require('path');
const TerserPlugin = require('terser-webpack-plugin');
const CleanPlugin = require('clean-webpack-plugin');

module.exports = {
	output: {
		globalObject: 'this',
		filename: 'bassoonplayer.js'
	},
	entry: {
		player: ['./src/player.js']
	},
	module: {
		rules: [{
			test: /\.tsx?$/,
			use: 'babel-loader',
			exclude: /node_modules/
		},
		{
			test: /\.map.js$/,
			use: 'source-map-loader',
			enforce: "pre"
		},
		]
	},
	plugins: [
		new CleanPlugin(),
	],
	resolve: {
		extensions: ['.ts', '.js'],
	},
	optimization: {
		minimizer: [
			new TerserPlugin(),
		],
	},
	watchOptions: {
		ignored: [
			'node_modules',
		]
	}
};
