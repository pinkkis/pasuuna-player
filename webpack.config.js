const TerserPlugin = require('terser-webpack-plugin');
const CleanPlugin = require('clean-webpack-plugin');
const webpack = require('webpack');

module.exports = (env, argv) => {
	return {
		output: {
			filename: 'pasuunaplayer.js',
			library: 'PasuunaPlayer',
			libraryTarget: 'umd'
		},
		entry: {
			player: ['./src/index.js']
		},
		devtool: argv.mode === 'production' ? undefined : 'eval-source-map',
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
			new CleanPlugin()
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
	}
};
