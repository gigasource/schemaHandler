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
    strArr: [String],
    obj: {
      person: {
        autopopulate: '-age',
        type: ObjectID,
        ref: 'Person'
      },
    },
    author: {
      autopopulate: '-age',
      type: ObjectID,
      ref: 'Person'
    },
    author2: {
      type: ObjectID,
      ref: 'Person'
    },
    author3: [{
      type: ObjectID,
      ref: 'Person'
    }]
  });

  orm.registerSchema('Person', dbName, {
    name: String
  });

  const Model = orm.getCollection('Model', dbName);
  await Model.remove({});

  const Person = orm.getCollection('Person', dbName);
  await Person.remove({});

  const person = await Person.create({
    name: 'me', age: 20
  });

  await Model.create({
    a: 10,
    author: person._id.toString(),
    author2: person._id.toString(),
    author3: [person._id.toString(), person._id.toString()],
    obj: {person: person._id.toString()}
  });

  const models = await Model.find().populate('author2', 'age').lean();
  console.log(models);

});
