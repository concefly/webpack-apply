import applyCommon from '../lib/index';

const CWD = process.cwd();

describe.skip('applyCommon', () => {
  it('normal', async () => {
    const config = applyCommon({
      entry: {
        main: 'main.js',
      },
      assetsTsConfigPath: `${CWD}/test/mock-tsconfig.json`,
      mode: 'development',
      enableCache: true,
      hotReload: true,
      publicPath: 'publicPath',
      env: 'ent',
      define: {
        aa: 'aa',
      },
      devServer: {
        https: true,
        port: 8888,
      },
      templateDir: 'templateDir',
    })({});

    expect(config).toBeTruthy();
  });
});
