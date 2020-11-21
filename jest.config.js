process.env.VUE_CLI_BABEL_TARGET_NODE = true;
process.env.VUE_CLI_BABEL_TRANSPILE_MODULES = true;

module.exports = {
/*  roots: [
    '<rootDir>/test',
    '<rootDir>/flow-test',
  ],*/
  moduleFileExtensions: [
    'js', 'vue', 'json'
  ],
  moduleDirectories: [
    'node_modules'
  ],
  /*moduleNameMapper: {
    '^@/(.*)$': "<rootDir>/src/$1"
  },*/
  testMatch: [
    '**/*.test.js',
  ],
  transform: {
    '^.+\\.js$': "<rootDir>/node_modules/babel-jest",
  },
  transformIgnorePatterns: ['<rootDir>/node_modules'],
  snapshotSerializers: ["jest-serializer-html"]
}
