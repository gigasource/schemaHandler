/*process.env.VUE_CLI_BABEL_TARGET_NODE = true;
process.env.VUE_CLI_BABEL_TRANSPILE_MODULES = true;*/

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
  testEnvironment: "node",
  /*moduleNameMapper: {
    '^@/(.*)$': "<rootDir>/src/$1"
  },*/
  testMatch: [
    '**/*.test.js',
  ],
  /*transform: {
    '^.+\\.js$': "<rootDir>/node_modules/babel-jest",
  },*/
  transformIgnorePatterns: [
    '<rootDir>/node_modules',
    '<rootDir>/flow-test',
    '<rootDir>/test',
    '<rootDir>/sync',
  ],
  //snapshotSerializers: ["jest-serializer-html"],
  slowTestThreshold: 20
}
