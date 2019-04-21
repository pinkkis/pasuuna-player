const TerserPlugin = require('terser-webpack-plugin');
const CleanPlugin = require('clean-webpack-plugin');

module.exports = {
	output: {
		filename: 'pasuunaplayer.js'
	},
	entry: {
		player: ['./src/index.js']
	},
	devtool: process.env.NODE_ENV === 'production' ? undefined : 'eval-source-map',
	module: {
		rules: [{
			test: /\.m?[t|j]sx?$/,
			use: 'babel-loader',
			exclude: /node_modules/
		},
		{
			test: /\.map.js$/,
			use: 'source-map-loader',
			enforce: 'pre'
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
