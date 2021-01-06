const traverse = require('traverse');
const ObjectID = require('bson').ObjectID;
const _ = require('lodash');
const _merge = require('extend');
const Hooks = require('./hooks/hooks');
const hooks = new Hooks();
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
    } else if (isLeaf && key === '$type' && node && isSchemaTypePrimitive(node)) {
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
        paths[`${_path}._id`] = {$type: 'ObjectID', $options: {default: () => new ObjectID()}};
      }
    }
  })

  return paths;
}

// parse function : init + convert ObjectID, convert String, convert Number, convert Object -> Array []

function parseSchema(paths, obj, {prefixPath} = {}) {
  return traverse(obj).map(function (node) {
    const {key, path, isRoot, parent, isLeaf} = this;
    if (this.node_ instanceof ObjectID || (typeof this.node_ === 'object' && ObjectID.isValid(this.node_))) {
      delete this.node_['__id'];
      this.update(this.node_, true);
      return this.block();
    }
    if (!isRoot && isLeaf && isPrimitive(node)) return;
    /*if (isRoot) {
      return;
    }*/
    let _path = [...path];
    if (prefixPath) {
      _path.unshift(...prefixPath);
    }

    const pathsInLevel = findAllPathsInLevel(paths, _path);
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

const logicArrayOperators = ['$or', '$nor', '$and', '$in' /*'$where', '$not'*/];

function parseCondition(paths, obj, {arrayFilters, prefixPath, identifier} = {}) {
  if (!paths) return obj
  return traverse(obj).map(function (node) {
    const {key, path, isRoot, parent, isLeaf} = this;
    if (this.node_ instanceof ObjectID || (typeof this.node_ === 'object' && ObjectID.isValid(this.node_))) {
      this.update(this.node_, true);
      return this.block();
    }
    if (!parent) return;

    let pathFilter = path;
    pathFilter = pathFilter.join('.').split('.');
    if (identifier) {
      pathFilter = pathFilter.filter(p => p !== identifier);
    }
    if (prefixPath) {
      pathFilter.unshift(...prefixPath);
    }

    if (path.join('.').split('.').find(p => /^\$\[\w*\]$/i.test(p))) {
      const _filters = convertArrayFilters(path.join('.').split('.'), arrayFilters, paths);
      arrayFilters.splice(0, arrayFilters.length, ..._filters);
    }

    let _node = node;
    const pathsInLevel2 = findAllPathsInLevelArrHandler2(paths, pathFilter);
    const {value, ok} = hooks.emit('processNode', {paths, path, pathFilter, pathsInLevel2, _node, self: this});
    if (ok) return;
    for (let {relative: _path, absolute} of pathsInLevel2) {
      const pathSchema = paths[absolute];
      if (isLeaf || (pathSchema.$options && pathSchema.$options.autopopulate && _node._id)) {
        if (pathSchema) {
          _node = convertPathParentSchema(_node, pathSchema);
        }
        this.update(_node);
        this.block();
      }
    }
  })
}

hooks.on('processNode', function ({paths, path, pathFilter, pathsInLevel2, _node, self}) {
  if (path.includes('$push')) {
    const _path = filterMongoOperators(pathFilter).slice(0, 2);
    let pathsInLevel = findAllPathsInLevelArrHandler2(paths, _path);
    pathsInLevel.forEach(p => p.pathSchema = paths[p.absolute]);
    if (pathsInLevel.find(({pathSchema}) => pathSchema.$type === 'Array')) {
      for (let {relative, absolute, pathSchema} of pathsInLevel) {
        if (relative === '0') {
          let prefixPath = [...filterMongoOperators(pathFilter, true, true), '0'];
          const convert = item => parseSchema(paths, item, {prefixPath});
          if (_node.$each) {
            _node.$each = _node.$each.map(item => convert(item));
          } else {
            _node = convert(_node);
          }

          self.update(_node);
          self.block();
          self.ok = true;
          this.stop();
        }
      }
    }
  }
})

function convertArrayFilters(path, arrayFilters, paths) {
  const identifierRegex = /^\$\[(\w*)\]$/i;
  const identifiers = path.filter(p => identifierRegex.test(p));
  let _arrayFilters = [];
  for (let filter of arrayFilters) {
    let pushed;
    for (const identifier of identifiers) {
      let _path = [...path];
      _path.splice(_path.indexOf(identifier));
      _path = _path.filter(p => !identifierRegex.test(p));
      const _identifier = identifierRegex.exec(identifier)[1];
      let shouldPush = false;
      if (!filter[_identifier]) {
        let _filter = traverse(filter).map(function (node) {
          const {key, path, isRoot, parent, isLeaf} = this;
          if (this.node_ instanceof ObjectID || (typeof this.node_ === 'object' && ObjectID.isValid(this.node_))) {
            this.update(this.node_, true);
            return this.block();
          }
          if (!parent || !isLeaf) return;

          let pathFilter = key;
          pathFilter = pathFilter.split('.');
          if (pathFilter[0] === _identifier) {
            shouldPush = true;
            this.parent.after(function _parentNode(_node) {
              delete _node[key]
              pathFilter.shift();
              const _key = pathFilter.join('.');
              _node[_key] = node;
              this.update(_node);
            })
          }
        });
        _filter = parseCondition(paths, filter, {prefixPath: _path, identifier: _identifier})
        //_filter = {[_identifier]: _filter};
        if (shouldPush) {
          _arrayFilters.push(_filter);
          pushed = true;
        }
      } else {
        const _filter = parseCondition(paths, filter[_identifier], {prefixPath: _path})
        _arrayFilters.push(_filter);
        pushed = true;
      }
    }
    if (!pushed) _arrayFilters.push(filter);
  }
  return _arrayFilters;
}

function filterMongoOperators2(paths, keepLast = true) {
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
    if (!item.includes('$')) {
      list.push(item);
    } else if (keepLast && index === paths.length - 1) {
      list.push(item);
    }
    return list;
  }, [])
}

function filterMongoOperators(paths, keepLast = true, keepDollar = false) {
  let rememberPrevent = false;
  return paths.reduce((list, item, index) => {
    if (logicArrayOperators.includes(item)) {
      rememberPrevent = true;
    } else {
      if (!rememberPrevent) {
        if (!item.includes('$')) {
          list.push(item);
        } else if (keepDollar && item === '$') {
          list.push('0');
        }
      }
      rememberPrevent = false;
    }
    return list;
  }, [])
}

function convertPathParentSchema(node, pathSchema) {
  const value = node;
  if (value && pathSchema.$type === 'ObjectID') {
    if (typeof node === 'string' && ObjectID.isValid(node)) {
      return new ObjectID(node);
    } else if (typeof node === 'object' && node._id) {
      if (typeof node._id === 'string' && ObjectID.isValid(node._id)) {
        return new ObjectID(node._id);
      } else if (node._id instanceof ObjectID) {
        return node._id;
      }
    }
  } else if (value && typeof value !== 'string' && pathSchema.$type === 'String') {
    return value.toString;
  } else if (value && typeof value !== 'number' && pathSchema.$type === 'Number') {
    return Number(value);
  }
  return value;
}

function initDefaultValue(node, pathSchema, _path) {
  if (pathSchema.$type === 'ObjectID') {
    if (!_.get(node, _path)) {
      _.set(node, _path, new ObjectID());
    }
  } else if (pathSchema.$options && pathSchema.$options.default) {
    let _default = pathSchema.$options.default;
    _default = typeof _default === 'function' ? _default() : _default
    if (!_.get(node, _path)) {
      _.set(node, _path, _default);
    }
  }
}

function convertPathSchema(node, pathSchema, _path) {
  const value = _.get(node, _path);
  if (value && pathSchema.$type === 'ObjectID') {
    if (ObjectID.isValid(value)) {
      _.set(node, _path, new ObjectID(value));
    } else if (pathSchema.$options && pathSchema.$options.autopopulate && value._id) {
      _.set(node, _path, new ObjectID(value._id));
    }
  } else if (value && typeof value !== 'string' && pathSchema.$type === 'String') {
    _.set(node, _path, value.toString());
  } else if (value && typeof value !== 'number' && pathSchema.$type === 'Number') {
    _.set(node, _path, Number(value));
  } else if (value && typeof value === 'string' && pathSchema.$type === 'Date') {
    if (value.match(iso8061)) {
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

function findAllPathsInLevelArrHandler2(paths, path) {
  const _paths = [];
  for (let _path of Object.keys(paths)) {
    const {isEqual, relative, match} = checkEqual2(_path.split('.'), path);
    if (match) {
      _paths.push({relative, absolute: _path});
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

function checkEqual2(_arr1, _arr2) {
  const arr1 = [..._arr1];
  const arr2 = filterMongoOperators(_arr2, false);
  const {isEqual, relative} = arr1.reduce((result, item1, index1) => {
    arr1;
    const {relative, isEqual, index2} = result;
    if (!result.isEqual) return result;
    if (index2 >= arr2.length) {
      relative.push(item1);
      return result;
    }
    const item2 = arr2[index2];
    const before = () => {
      if (index1 === arr1.length - 1) {
        const restLength = arr2.length - result.index2;
        if (restLength === 1 && isNormalInteger(_.last(arr2))) {
        } else if (restLength !== 0) {
          /*if (process.env.NODE_ENV === 'test') {
            console.log('arr2 has too much items')
            console.log('restLength : ', restLength);
          }*/
          result.isEqual = false;
        }
      }
      result.prevent = false;
    }
    if (item1 === item2) {
      result.isEqual = true;
      result.index2++;
      before();
      return result;
    } else if (item1 === '0') {
      if (isNormalInteger(item2) || item2.includes('$')) {
        result.isEqual = true;
        result.index2++;
        before();
        return result;
      } else if (!result.prevent) {
        result.prevent = true;
        before();
        return result;
      } else {
        before();
        return result;
      }
    } else {
      result.isEqual = false;
      return result;
    }
  }, {relative: [], isEqual: true, index2: 0});
  let match = isEqual && relative.filter(r => r !== '0').length === 0;
  return {isEqual, relative: relative.join('.'), match};
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

function isSchemaTypePrimitive(node) {
  if ([String, Number, Boolean, ObjectID, Date].includes(node)) return true;
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
  checkEqual,
  checkEqual2,
  findAllPathsInLevelArrHandler2,
  filterMongoOperators
}

