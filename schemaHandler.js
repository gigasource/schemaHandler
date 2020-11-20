const traverse = require('traverse');
const ObjectID = require('bson').ObjectID;
const _ = require('lodash');
const _merge = require('extend');
const iso8061 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2}(?:\.\d*)?)Z$/;

function merge() {
  return _merge(true, ...arguments);
}

function convertSchemaToPaths(schema, collectionName) {
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
    } else if (hasTypeDefined(node)) {
      if (hasTypeDefined(node) === true) {
        this.block();
      }
      const _node = {};
      _node.$options = _.omit(node, ['type', '$type']);
      _node.$type = node.type;
      this.update(_node)
    } else if (key !== '$type' && typeof node === 'object' && (!node.hasOwnProperty('type') || hasTypeDefined(node.type))) {
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
    if (isLeaf && key !== '$type' && _.last(_path.split('.')) !== '0') {
      if (parent) {
        paths[_path] = convertType(parent.node);
      }
    } else if (isLeaf && key === '$type' && _.last(_path.split('.')) === '0' && JSON.stringify(node) !== '{}') {
      if (parent) {
        paths[_path] = convertType(parent.node);
      }
    } else if (isLeaf && key === '$type' && node && (node.name === 'ObjectId' || node.name === 'Date')) {
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
      this.update(this.node_, true);
      return this.block();
    }
    if (!isRoot && isLeaf && isPrimitive(node)) return;
    /*if (isRoot) {
      return;
    }*/

    const pathsInLevel = findAllPathsInLevel(paths, path);
    let _node = Array.isArray(node) ? [...node] : {...node};

    for (const {relative: _path, absolute} of pathsInLevel) {
      if (_path.split('.').length === 1) {
        const pathSchema = paths[absolute];
        if (_path === '0' && Array.isArray(_node)) {
          for (let i = 0; i < _node.length; i++) {
            initDefaultValue(_node, pathSchema, i + '');
            convertPathSchema(_node, pathSchema, i + '');
          }
        } else {
          initDefaultValue(_node, pathSchema, _path);
          convertPathSchema(_node, pathSchema, _path);
        }
      }
    }
    //if (!this.parent || !Array.isArray(this.parent.node)) {
    //this.after(() => {
    this.update(_node)
    //})
    //}
  })
}

const logicOperators = ['$or', '$nor', '$and', '$in' /*'$where', '$not'*/];

function parseCondition(paths, obj) {
  return traverse(obj).map(function (node) {
    const {key, path, isRoot, parent, isLeaf} = this;
    if (this.node_ instanceof ObjectID || (typeof this.node_ === 'object' && ObjectID.isValid(this.node_))) {
      this.update(this.node_, true);
      return this.block();
    }
    //if (!isRoot && isLeaf && typeof node !== 'object') return;
    /*if (isRoot) {
      return;
    }*/

    let arrHandler = false;

    let pathFilter = filterMongoOperators(path);
    const _pathFilter = pathFilter.join('.').split('.');
    if (_pathFilter.length !== pathFilter.length) arrHandler = true;

    pathFilter = _pathFilter;
    const last = _.last(pathFilter);
    if (pathFilter.length >= 1) {
      pathFilter.pop();
    }
    if (paths[pathFilter.join('.')] && paths[pathFilter.join('.')].$type === 'Array') arrHandler = true;

    let pathsInLevel = findAllPathsInLevel(paths, pathFilter);
    if (!parent) return;
    let _node = node;

    for (const {relative: _path, absolute} of pathsInLevel) {
      if (_path.split('.').length === 1 && checkEqual([_path], [last]) && isLeaf && !Array.isArray(_node)) {
        const pathSchema = paths[absolute];
        _node = convertPathParentSchema(_node, pathSchema, _path);
        this.update(_node);
        this.block();
      }
    }

    if (arrHandler) {
      const pathsInLevel2 = findAllPathsInLevelArrHandler(paths, pathFilter);

      for (let {relative: _path, absolute} of pathsInLevel2) {
        if (_path.split('.').length === 2 && _path.split('.')[0] === '0' && _path.split('.')[1] === last && isLeaf) {
          _path = _path.split('.')[1];
        }
        if (_path.split('.').length === 1 && _path === last && isLeaf) {
          const pathSchema = paths[_path];
          if (pathSchema) {
            _node = convertPathParentSchema(_node, pathSchema, absolute);
          }
          this.update(_node);
          this.block();
        }
      }
    }
    //if (!this.parent || !Array.isArray(this.parent.node)) {
    //this.before(() => {
    //})
    //}
  })
}

function filterMongoOperators(paths) {
  let rememberPrevent = false;
  return paths.reduce((list, item, index) => {
    /*if (logicOperators.includes(item)) {
      rememberPrevent = true;
    } else {
      if (!rememberPrevent) {
        if (!item.includes('$')) {
          list.push(item);
        }
      }
      rememberPrevent = false;
    }*/
    if (!item.includes('$') || index === paths.length - 1) {
      list.push(item);
    }
    return list;
  }, [])
}

function convertPathParentSchema(node, pathSchema, _path) {
  const value = node;
  if (value && pathSchema.$type === 'ObjectID') {
    if (typeof node === 'string' && ObjectID.isValid(node)) {
      return new ObjectID(node);
    }
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
    if (ObjectID.isValid(value)) {
      _.set(node, _path, new ObjectID(value));
    } else if (pathSchema.$options.autopopulate && value._id) {
      _.set(node, _path, new ObjectID(value._id));
    }
  } else if (value && typeof value !== 'string' && pathSchema.$type === 'String') {
    _.set(node, _path, value.toString());
  } else if (value && typeof value !== 'number' && pathSchema.$type === 'Number') {
    _.set(node, _path, Number(value));
  } else if (value && typeof value === 'string' && pathSchema.$type === 'Date') {
    if (value.match(iso8061)){
      _.set(node, _path, new Date(value));
    }
  }
}

function findAllPathsInLevelArrHandler(paths, path) {
  const _paths = [];
  for (let _path of Object.keys(paths)) {
    let changed = false;
    const _path2 = _path.replace(/\.0/g, '');
    if (_path2 !== _path) changed = true;
    if (path.length + 1 === _path2.split('.').length) {
      const __path2 = _path2.split('.');
      const __beginPath = __path2.splice(0, path.length);
      if (checkEqual(__beginPath, path)) {
        if (changed) {
          const __path = _path.split('.');
          __path.splice(0, path.length + 1);
          _paths.push({relative: __path.join('.'), absolute: _path});
        } else {
          _paths.push({relative: __path2.join('.'), absolute: _path});
        }
      }
    }
  }
  return _paths;
}

function findAllPathsInLevel(paths, path) {
  const _paths = [];
  for (const _path of Object.keys(paths)) {
    if (path.length + 1 === _path.split('.').length) {
      const __path = _path.split('.');
      const __beginPath = __path.splice(0, path.length);
      if (checkEqual(__beginPath, path)) {
        _paths.push({relative: __path.join('.'), absolute: _path});
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
      if (arr1[i] === '0' && (isNormalInteger(arr2[i]) || arr2[i].includes('$'))) {
      } else {
        equal = false;
        break;
      }
    }
  }
  return equal;
}

function isNormalInteger(str) {
  return /^\+?(0|[1-9]\d*)$/.test(str);
}

function convertType(node) {
  if (node.$type.name === 'ObjectId') {
    return _.assign({}, node, {$type: 'ObjectID'});
  } else if (node.$type) {
    return _.assign({}, node, {$type: node.$type.name});
  }
}

function hasTypeDefined(node) {
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
  if ([String, Number, Boolean, ObjectID, Date].includes(node)) return true;
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
  if ([String, Number, Boolean, ObjectID, Date].find(_class => test instanceof _class)) return true;
  return (test !== Object(test));
}

module.exports = {
  convertSchemaToPaths,
  parseCondition,
  parseSchema,
  checkEqual
}

