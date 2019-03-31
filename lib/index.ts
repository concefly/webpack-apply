import md5 from 'spark-md5';
import { statSync } from 'fs-extra';
import webpack = require('webpack');
import _ from 'lodash';
import { join } from 'path';
import { cpus } from 'os';
import * as threadLoader from 'thread-loader';
import TsconfigPathsPlugin from 'tsconfig-paths-webpack-plugin';
import ForkTsCheckerWebpackPlugin from 'fork-ts-checker-webpack-plugin';
import ManifestPlugin from 'webpack-manifest-plugin';
import HtmlWebpackPlugin from 'html-webpack-plugin';
import CaseSensitivePathsPlugin from 'case-sensitive-paths-webpack-plugin';
import ProgressBarPlugin from 'progress-bar-webpack-plugin';
import merge from 'webpack-merge';

const CWD = process.cwd();

/** 计算一组文件的 hash */
export function getFilesHash(filePaths: string[]) {
  return md5.hash(filePaths.map(p => statSync(p).mtime.valueOf() + '').join(':'));
}

/** 配置样式加载规则 */
export const applyStyle = (opt: { theme: { [name: string]: string } }) => (
  config: webpack.Configuration
) => {
  const loaderUse = {
    less: {
      loader: require.resolve('less-loader'),
      options: {
        javascriptEnabled: true,
        modifyVars: opt.theme,
      },
    },
    style: {
      loader: require.resolve('style-loader'),
    },
    css: ({ modules }) => ({
      loader: require.resolve('css-loader'),
      options: { modules },
    }),
  };

  return merge(config, {
    module: {
      rules: [
        {
          test: /\.css$/,
          use: [loaderUse.style, loaderUse.css({ modules: false })],
        },
        {
          test: /\.module\.less$/,
          use: [loaderUse.style, loaderUse.css({ modules: true }), loaderUse.less],
        },
        {
          test: /\.less$/,
          exclude: /\.module\.less$/,
          use: [loaderUse.style, loaderUse.css({ modules: false }), loaderUse.less],
        },
      ],
    },
  });
};

/** 配置脚本加载规则 */
export const applyScript = (opt: {
  enableCache: boolean;
  cacheIdentifier: string[];
  hotReload: boolean;
  assetsTsConfigPath: string;
}) => (config: webpack.Configuration) => {
  // 设置缓存失效条件
  const cacheIdentifier = opt.cacheIdentifier;

  const loaderUse = {
    cache: {
      loader: require.resolve('cache-loader'),
      options: {
        cacheDirectory: join(CWD, 'node_modules', '.cache-loader'),
        cacheIdentifier,
      },
    },

    thread: {
      loader: require.resolve('thread-loader'),
      options: {
        // 留 1 个 CPU 给 fork-ts-checker-webpack-plugin
        workers: cpus().length - 1,
      },
    },

    worker: {
      loader: require.resolve('worker-loader'),
      options: { inline: true },
    },

    // babel -> 增强 es5
    babel: {
      loader: require.resolve('babel-loader'),
      options: {
        // 缓存地址 ./node_modules/.cache/babel-loader
        cacheDirectory: opt.enableCache,
        cacheIdentifier,
        babelrc: false,
        plugins: [
          ...(opt.hotReload ? [require.resolve('react-hot-loader/babel')] : []),
          require.resolve('@babel/plugin-syntax-dynamic-import'),
          [require.resolve('babel-plugin-import'), { libraryName: 'antd', libraryDirectory: 'es' }],
          [
            require.resolve('babel-plugin-import'),
            { libraryName: 'lodash', libraryDirectory: '', camel2DashComponentName: false },
            'import-lodash',
          ],
        ],
      },
    },

    // tsc -> 编译 typescript 到 es5
    ts: ({ happyPackMode }) => ({
      loader: require.resolve('ts-loader'),
      options: {
        configFile: opt.assetsTsConfigPath,
        transpileOnly: true,
        happyPackMode,
      },
    }),
  };

  // 多线程 loader 预热
  threadLoader.warmup({}, ['ts-loader']);

  return merge(config, {
    module: {
      rules: [
        // 普通 tsx 的 loader
        {
          test: /\.tsx?$/,
          use: [
            loaderUse.thread,
            ...(opt.enableCache ? [loaderUse.cache] : []),
            loaderUse.babel,
            loaderUse.ts({ happyPackMode: true }),
          ],
        }
      ],
    },

    output: {
      globalObject: 'this',
      // 给异步加载的 script 也加上 crossorigin
      crossOriginLoading: 'anonymous',
    },

    plugins: [
      new ForkTsCheckerWebpackPlugin({
        checkSyntacticErrors: true,
        tsconfig: opt.assetsTsConfigPath,
        memoryLimit: 1024,
        workers: 1,
      }),

      ...(opt.hotReload ? [new webpack.HotModuleReplacementPlugin()] : []),
    ],

    resolve: {
      extensions: ['.ts', '.tsx', '.js'],
      plugins: [
        // 把 tsconfig 的计算 path 转换成 webpack alias
        new TsconfigPathsPlugin({
          configFile: opt.assetsTsConfigPath,
        }),
      ],
    },

    stats: {
      warningsFilter: /export .* was not found in/,
    },

    optimization: {
      splitChunks: {
        chunks: 'async',
        minChunks: 1,
        // 200k 就要拆分出去
        minSize: 200 * 1024,
        // module 定义见 webpack 源码的 NormalModule
        name: m => {
          const resourceName = m.resource || '';

          if (!resourceName) return 'vendor';

          const assetsPath = _.chain(resourceName)
            .trimStart(CWD)
            .trimStart('node_modules')
            .kebabCase()
            .value();

          return assetsPath;
        },
      },
    },
  });
};

/** 配置图片加载规则 */
export const applyImage = () => (config: webpack.Configuration) => {
  return merge(config, {
    module: {
      rules: [
        // svg
        {
          test: /\.svg(\?v=\d+\.\d+\.\d+)?$/,
          use: [
            {
              loader: require.resolve('@svgr/webpack'),
            },
          ],
        },
      ],
    },
  });
};

/** 生成 Manifest */
export const applyManifest = (opt: { publicPath: string }) => (config: webpack.Configuration) => {
  const { publicPath } = opt;

  return merge(config, {
    plugins: [new ManifestPlugin({ publicPath })],
  });
};

export const applyTemplate = (opt: {
  tplDir: string;
  entryNames: string[];
  params: { [name: string]: any };
}) => (config: webpack.Configuration) => {
  const { tplDir, entryNames } = opt;

  return merge(config, {
    module: {
      rules: [
        {
          test: /\.ejs$/,
          loader: require.resolve('ejs-compiled-loader'),
        },
      ],
    },

    plugins: [
      ..._.keys(entryNames).map(
        name =>
          new HtmlWebpackPlugin({
            title: name,
            filename: `${name}.html`,
            template: join(tplDir, `${name}.ejs`),
            inject: false,
            templateParameters: opt.params,
          })
      ),
    ],
  });
};

export const applyDevServer = (opt: { port: number; https: boolean }) => (
  config: webpack.Configuration
) => {
  const newConfig = {
    ...config,
    devServer: {
      ...(config as any).devServer,

      https: opt.https,
      port: opt.port,
      disableHostCheck: true,
      stats: 'errors-only',
      hot: true,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
        'Access-Control-Allow-Headers': 'X-Requested-With, content-type, Authorization',
      },
    },
  };

  return newConfig;
};

export const applyCommon = (opt: {
  entry: { [name: string]: string };
  assetsTsConfigPath: string;
  mode: 'development' | 'production';
  enableCache: boolean;
  hotReload: boolean;
  publicPath: string;
  env: string;
  define: any;
  /** 指定 manifest 输出路径 */
  manifestPath?: string;
  templateDir?: string;
  devServer?: {
    https: boolean;
    port: number;
  };
}) => (config: webpack.Configuration): webpack.Configuration => {
  const defaultConfig = {
    entry: opt.entry,

    output: {
      ...config.output,
      publicPath: opt.publicPath,
    },

    mode: opt.mode,
    devtool: opt.mode === 'development' ? 'cheap-module-source-map' : 'nosources-source-map',

    plugins: [
      // 显示打包进度条
      new ProgressBarPlugin({
        format: '[:bar] [:percent] :msg',
      }),

      new webpack.DefinePlugin({
        ENV: JSON.stringify(opt.env),
        PUBLIC_PATH: JSON.stringify(opt.publicPath),
        ...opt.define,
      }),

      // 路径检查大小写
      new CaseSensitivePathsPlugin(),
    ],
  };

  return _.flowRight([
    ...(opt.devServer
      ? [
          applyDevServer({
            port: opt.devServer.port,
            https: opt.devServer.https,
          }),
        ]
      : []),
    ...(opt.templateDir
      ? [
          applyTemplate({
            params: {
              ENV: opt.env,
            },
            tplDir: opt.templateDir,
            entryNames: _.keys(opt.entry),
          }),
        ]
      : []),
    applyManifest({
      publicPath: opt.manifestPath || opt.publicPath,
    }),
    applyImage(),
    applyStyle({ theme: {} }),
    applyScript({
      enableCache: opt.enableCache,
      hotReload: opt.hotReload,
      assetsTsConfigPath: opt.assetsTsConfigPath,
      cacheIdentifier: [],
    }),
    c => merge(c, defaultConfig as any),
  ])(config);
};

export default applyCommon;
