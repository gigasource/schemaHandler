const ObjectID = require('bson').ObjectID

const orm = require("../orm");

const url = 'mongodb://localhost:27017';
// Database Name
const dbName = 'myproject';
orm.setMultiDbMode();

orm.connect(url, async (err) => {

  orm.registerSchema('Person', dbName, {
    name: String
  });

  orm.registerSchema('Model', dbName, {
    a: Number,
    b: {
      type: Number,
      default: 100
    },
    items: [{}],
    strArr: [String],
    author: {
      type: ObjectID,
      ref: 'Person'
    }
  });

  const Model = orm.getCollection('Model', dbName);
  await Model.remove({});

  const Person = orm.getCollection('Person', dbName);
  await Person.remove({});

  const person = await Person.create({name: 'me', age: 20});

  await Model.create({a: 10, author: person._id.toString()});

  const models = await Model.find().populate({path: 'author', select: '-age'}).lean();
  console.log(models);

});
