const {parseSchema} = require("../schemaHandler");
const {parseCondition} = require("../schemaHandler");
const {convertSchemaToPaths} = require("../schemaHandler");
const ObjectID = require('bson').ObjectID;
const schema = {
  /*a: String,
  b: {
    default: 'b',
    type: String
  },
  type: String,*/
  /*obj: {
    _a: String,
    _b: {
      type: String
    }
  },*/
  /*author: {
    type: ObjectID,
    ref: 'Person'
  },
  obj2: {
    type: {
      _a: String,
      _b: {
        type: String
      }
    }
  },*/
  arr: [{
    _a: String,
    _b: {
      default: 10,
      type: Number
    }
  }],
  /*arr2: {
    default: [{_c: '_c'}],
    type: [{
      _a: [{
        c: String,
        d: String
      }],
      _b: {
        c: String,
        d: {
          default: 'd',
          type: String
        }
      },
      _c: {
        type: String
      }
    }]
  }*/
}

const paths = convertSchemaToPaths(schema);

const obj = {
  _id: '5fa14641c81c7fa0bc38ca12',
  /*obj: {
    _id: '5fa14641c81c7fa0bc38ca12'
  },*/
  arr: [{
    _a: 'a',
  }]
  /*arr2: [{
    _b: {}
  }]*/
}

const _obj = parseSchema(paths, obj);
console.log(_obj);


const condition = {
  'obj._id' : new ObjectID().toString(),
  /*$or: [
    {_id: {$eq: new ObjectID().toString()}},
    {_id: new ObjectID().toString()}
  ]*/
}

//const obj2 = parseSchema(paths, obj);
//obj2._id = new ObjectID();
//console.log(obj2);

//const condition2 = parseCondition(paths, condition);

//console.log(condition2);
