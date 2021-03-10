const {ObjectID} = require("bson");
const traverse = require('traverse');

function convertNameToTestFunction(name) {
  return typeof name === 'function' ? name : _name => name === _name;
}

function stringify() {
  return JSON.parse(
    JSON.stringify(
      arguments[0],
      function (k, v) {
        if (k === 'uuid') return 'uuid-v1'
        if (
          this[k] instanceof ObjectID ||
          (typeof this[k] === "object" && ObjectID.isValid(this[k]))
        ) {
          return "ObjectID";
        }
        if (typeof this[k] === "string" && this[k].length === 24 && ObjectID.isValid(this[k])) {
          return "ObjectID";
        }
        if (k === 'chain' || k === 'condition') {
          let result = stringify(JSON.parse(this[k]));
          result = JSON.stringify(result);
          return result;
        }
        return v;
      },
      4
    )
  );
}

function clearUndefined(obj) {
  const result = traverse(obj).map(function (node) {
    const {key, path, isRoot, parent, isLeaf} = this;
    if (this.node_ instanceof ObjectID || (typeof this.node_ === 'object' && ObjectID.isValid(this.node_))) {
      this.update(this.node_, true);
      return this.block();
    }
    if (!parent) return;
    if (isLeaf && node === undefined && !Array.isArray(parent)) {
      this.delete();
    }
  })
  return result;
}

const util = require('util');
const inspect = (obj) => util.inspect(obj, {depth: 1});

exports.clearUndefined = clearUndefined;
exports.convertNameToTestFunction = convertNameToTestFunction;
exports.stringify = stringify;
exports.inspect = inspect;
