const {ObjectID} = require("bson");
function convertNameToTestFunction(name) {
  return typeof name === 'function' ? name : _name => name === _name;
}

function stringify() {
  return JSON.parse(
    JSON.stringify(
      arguments[0],
      function (k, v) {
        if (
          this[k] instanceof ObjectID ||
          (typeof this[k] === "object" && ObjectID.isValid(this[k]))
        ) {
          return "ObjectID";
        }
        return v;
      },
      4
    )
  );
}

const util = require('util');
const inspect = (obj) => util.inspect(obj, {depth: 1});

module.exports = {
  convertNameToTestFunction,
  stringify,
  inspect
}
