const TerserPlugin = require('terser-webpack-plugin');

module.exports = {
  entry: "./main.ts",
  mode: 'production',
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      }
    ]
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  externals: {
    electron: 'commonjs electron',
    obsidian: "commonjs obsidian",
  },

  optimization: {
    minimize: true,
    minimizer: [
      new TerserPlugin({
        extractComments: false,
        terserOptions: {},
      }),
    ],
  },

  target: 'node',
  output: {
    path: __dirname,
    filename: "main.js",
    libraryTarget: "commonjs",
  },
};
