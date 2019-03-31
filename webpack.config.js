const TerserPlugin = require('terser-webpack-plugin');
const CleanPlugin = require('clean-webpack-plugin');

module.exports = {
	output: {
		filename: 'bassoonplayer.js'
	},
	entry: {
		player: ['./src/player.js']
	},
	module: {
		rules: [{
			test: /\.[t|j]sx?$/,
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
