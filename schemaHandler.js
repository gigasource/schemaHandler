const traverse = require('traverse');
const ObjectID = require('bson').ObjectID;
const _ = require('lodash');
const _merge = require('extend');

function merge() {
  return _merge(true, ...arguments);
}

function convertSchemaToPaths(schema) {
  const schema2 = traverse(schema).map(function (node) {
    const {key, path, isRoot, parent} = this;
    if (isRoot) {
      return;
    }
    if (key === '$options') {
      this.block();
      return;
    }
    if (isSchemaType(key, node, isRoot)) {
      this.after(function (_node) {
        key;
        if (_node.$type) return;
        this.update({$type: _node}, true)
      });
    } else if (hasTypeDefined(key, node, isRoot)) {
      if (hasTypeDefined(key, node, isRoot) === true) {
        this.block();
      }
      const _node = {};
      _node.$options = _.omit(node, ['type', '$type']);
      _node.$type = node.type;
      this.update(_node)
    } else if (key !== '$type' && typeof node === 'object' && !node.hasOwnProperty('type')) {
      //embedded
      this.after(function (_node) {
        this.update({$type: node})
      });
    }
    //console.log(node)
  })

  const paths = {}

  traverse(schema2).map(function (node) {
    const {key, path, isRoot, parent, isLeaf} = this;
    const _path = path.filter(p => p !== '$type').join('.');
    if (isRoot) {
      paths['_id'] = {$type: 'ObjectID'};
    }
    if (key === '$options') {
      this.block();
      return;
    }
    if (isLeaf) {
      if (parent) {
        paths[_path] = convertType(parent.node);
      }
    } else if (key === '$type') {
      if (Array.isArray(node)) {
        paths[_path] = merge({}, {$options: {default: []}}, parent.node, {$type: 'Array'});
      } else if (typeof node === 'object') {
        let _$options = {}
        if (path[path.length - 2] !== '0') {
          _$options = {default: {}}
        }
        paths[_path] = merge({}, {$options: _$options}, parent.node, {$type: 'Object'});
        paths[`${_path}._id`] = {$type: 'ObjectID'};
      }
    }
  })

  return paths;
}

// parse function : init + convert ObjectID, convert String, convert Number, convert Object -> Array []

function parseSchema(paths, obj) {
  return traverse(obj).map(function (node) {
    const {key, path, isRoot, parent, isLeaf} = this;
    if (node instanceof ObjectID) {
      return this.block();
    }
    if (!isRoot && isLeaf && typeof node !== 'object') return;
    /*if (isRoot) {
      return;
    }*/

    const pathsInLevel = findAllPathsInLevel(paths, path);
    let _node = Array.isArray(node) ? [...node] : {...node};

    for (const _path of pathsInLevel) {
      if (_path.split('.').length === 1) {
        const pathSchema = paths[path.concat(_path.split('.')).join('.')];
        initDefaultValue(_node, pathSchema, _path);
        convertPathSchema(_node, pathSchema, _path);
      }
    }
    //if (!this.parent || !Array.isArray(this.parent.node)) {
    //this.before(() => {
    this.update(_node)
    //})
    //}
  })
}

const logicOperators = ['$or', '$nor', '$and', '$in' /*'$where', '$not'*/];

function parseCondition(paths, obj) {
  return traverse(obj).map(function (node) {
    const {key, path, isRoot, parent, isLeaf} = this;
    if (node instanceof ObjectID) {
      return this.block();
    }
    //if (!isRoot && isLeaf && typeof node !== 'object') return;
    /*if (isRoot) {
      return;
    }*/

    let pathFilter = filterMongoOperators(path);
    pathFilter = pathFilter.join('.').split('.');
    const last = _.last(pathFilter);
    if (pathFilter.length >= 1) {
      pathFilter.pop();
    }

    const pathsInLevel = findAllPathsInLevel(paths, pathFilter);
    if (!parent) return;
    let _node = node;

    for (const _path of pathsInLevel) {
      if (_path.split('.').length === 1 && _path === last && isLeaf) {
        const pathSchema = paths[pathFilter.concat(_path.split('.')).join('.')];
        _node = convertPathParentSchema(_node, pathSchema, _path);
        this.update(_node);
        this.block();
      }
    }
    //if (!this.parent || !Array.isArray(this.parent.node)) {
    //this.before(() => {
    //})
    //}
  })
}

function filterMongoOperators(paths) {
  let rememberPrevent= false;
  return paths.reduce((list, item, k) => {
    if (logicOperators.includes(item)) {
      rememberPrevent = true;
    } else {
      if (!rememberPrevent) {
        if (!item.includes('$')) {
          list.push(item);
        }
      }
      rememberPrevent = false;
    }
    return list;
  }, [])
}

function convertPathParentSchema(node, pathSchema, _path) {
  const value = node;
  if (value && pathSchema.$type === 'ObjectID') {
    return new ObjectID(node);
  } else if (value && typeof value !== 'string' && pathSchema.$type === 'String') {
    return value.toString;
  } else if (value && typeof value !== 'number' && pathSchema.$type === 'Number') {
    return Number(value);
  }
  return value;
}

function initDefaultValue(node, pathSchema, _path) {
  if (pathSchema.$options && pathSchema.$options.default) {
    if (!_.get(node, _path)) {
      _.set(node, _path, pathSchema.$options.default);
    }
  }
}

function convertPathSchema(node, pathSchema, _path) {
  const value = _.get(node, _path);
  if (value && pathSchema.$type === 'ObjectID') {
    _.set(node, _path, new ObjectID(node[_path]));
  } else if (value && typeof value !== 'string' && pathSchema.$type === 'String') {
    _.set(node, _path, value.toString());
  } else if (value && typeof value !== 'number' && pathSchema.$type === 'Number') {
    _.set(node, _path, Number(value));
  }
}

function findAllPathsInLevel(paths, path) {
  const _paths = [];
  for (const _path of Object.keys(paths)) {
    if (path.length + 1 === _path.split('.').length) {
      const __path = _path.split('.');
      const __beginPath = __path.splice(0, path.length);
      if (checkEqual(path, __beginPath)) {
        _paths.push(__path.join('.'));
      }
    }
  }
  return _paths;
}

function checkEqual(arr1, arr2) {
  if (arr1.length !== arr2.length) return false;
  let equal = true;
  for (let i = 0; i < arr1.length; i++) {
    const e = arr1[i];
    if (arr1[i] !== arr2[i]) {
      if (arr1[i] === '0' && isNormalInteger(arr2[i])) {
      } else {
        equal = false;
      }
    }
  }
  return equal;
}

function isNormalInteger(str) {
  return /^\+?(0|[1-9]\d*)$/.test(str);
}

function convertType(node) {
  if (node.$type) {
    return _.assign({}, node, {$type: node.$type.name});
  }
}

function hasTypeDefined(key, node, isRoot) {
  if (typeof node === 'object' && node.hasOwnProperty('type')) {
    if (isSchemaType('type', node.type, false)) {
      if (typeof node.type === 'object') {
        return 'embed'
      }
      return true;
    } else {
      return false;
    }
  }
}

function isSchemaType(key, node, isRoot) {
  if ([String, Number, Boolean, ObjectID].includes(node)) return true;
  if (typeof node === 'object' && node.hasOwnProperty('type')) {
    return false;
  }
  if (isPrimitive(node)) return true;
  if (key === 'type' && !node.hasOwnProperty('type') && !isRoot) {
    return true;
  }
  return false;
}

function isPrimitive(test) {
  return (test !== Object(test));
}

module.exports = {
  convertSchemaToPaths,
  parseCondition,
  parseSchema,
}

