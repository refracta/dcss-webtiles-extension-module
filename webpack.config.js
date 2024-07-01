const path = require('path');

module.exports = {
    entry: './src/index.js',
    output: {
        filename: 'bundle.js',
        path: path.resolve(__dirname, 'dist'),
        library: 'MyModules', // 번들링된 파일을 전역 라이브러리로 설정
        libraryTarget: 'var', // 전역 변수를 사용하여 접근 가능하도록 설정
        module: true,
    },
    module: {
        rules: [
            {
                test: /\.js$/,
                exclude: /node_modules/,
                use: {
                    loader: 'babel-loader',
                    options: {
                        presets: ['@babel/preset-env'],
                        plugins: ['@babel/plugin-syntax-dynamic-import']
                    },
                },
            },
        ],
    },
    resolve: {
        extensions: ['.js'],
    },
    experiments: {
        outputModule: true,
    }
};
