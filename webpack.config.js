const TerserPlugin = require('terser-webpack-plugin');
const CleanPlugin = require('clean-webpack-plugin');

module.exports = {
	output: {
		filename: 'bassoonplayer.js'
	},
	entry: {
		player: ['./src/BassoonPlayer.js']
	},
	module: {
		rules: [{
			test: /\.m?[t|j]sx?$/,
			use: {
				loader: 'babel-loader',
				options: {
					presets: ['@babel/preset-env'],
					plugins: ['@babel/plugin-transform-runtime', '@babel/proposal-class-properties', '@babel/proposal-object-rest-spread',]
				},
			},
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
