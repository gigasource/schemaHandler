function convertNameToTestFunction(name) {
  return typeof name === 'function' ? name : _name => name === _name;
}

module.exports = {
  convertNameToTestFunction
}
