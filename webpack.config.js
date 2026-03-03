//@ts-check

'use strict';

const path = require('path');

/**@type {import('webpack').Configuration}*/
const extensionConfig = {
  target: 'node',
  mode: 'none',

  entry: './src/extension.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'extension.js',
    libraryTarget: 'commonjs2',
  },
  devtool: 'nosources-source-map',
  externals: {
    vscode: 'commonjs vscode',
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: [
          /node_modules/,
          function(modulePath) {
            // Only exclude gameview, not shared (shared is used by extension)
            return modulePath.includes('src\\webview\\gameview') || modulePath.includes('src/webview/gameview');
          }
        ],
        use: [
          {
            loader: 'ts-loader',
            options: {
              transpileOnly: true,
            },
          },
        ],
      },
    ],
  },
  node: {
    __dirname: false,
    __filename: false,
  },
};

/**@type {import('webpack').Configuration}*/
const webviewConfig = {
  target: 'web',
  mode: 'none',

  entry: './src/webview/gameview/index.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'webview-gameview.js',
    libraryTarget: 'umd',
    library: 'GameView',
    globalObject: 'this',
  },
  devtool: 'nosources-source-map',
  externals: {
    // Don't bundle vscode (not used in webview)
    vscode: 'commonjs vscode',
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        loader: 'esbuild-loader',
        options: {
          loader: 'ts',
          target: 'es2020',
        },
      },
    ],
  },
  // Performance hints for the larger webview bundle
  performance: {
    hints: false,
    maxAssetSize: 600000,
    maxEntrypointSize: 600000,
  },
};

module.exports = [extensionConfig, webviewConfig];
