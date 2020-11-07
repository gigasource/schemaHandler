const ObjectID = require('bson').ObjectID

const orm = require("../orm");

const url = 'mongodb://localhost:27017';
// Database Name
const dbName = 'myproject';
orm.setMultiDbMode();

orm.connect(url, async (err) => {
  orm.registerSchema('Model', dbName, {
    a: Number,
    b: {
      type: Number,
      default: 100
    },
    items: [{}],
    strArr: [String]
  });
  const Model = orm.getCollection('Model', dbName);
  await Model.remove({});
  await Model.create({a: 10});

});
