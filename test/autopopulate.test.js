const {
  checkEqual2,
  convertSchemaToPaths,
  findAllPathsInLevelArrHandler2,
  parseCondition
} = require("../schemaHandler");
const _ = require("lodash");
const orm = require("../orm");
const { parseSchema } = require("../schemaHandler");
const { ObjectID } = require("bson");

let id = () => "5fb7f13453d00d8aace1d89b";
let A, B, C, D, E;
jest.setTimeout(10000000);

const collections = [];

function registerSchema(collectionName, schema) {
  collections.push(collectionName);
  return orm.registerSchema(collectionName, schema);
}

function stringify() {
  return JSON.parse(
    JSON.stringify(
      arguments[0],
      function(k, v) {
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

describe("test populate", function() {
  beforeAll(async done => {
    orm.connect(
      { uri: "mongodb://localhost:27017", loggerLevel: "debug" },
      "myproject"
    );
    const schemaA = {
      name: String
    };
    const schemaB = {
      name: String,
      a: {
        type: ObjectID,
        autopopulate: true,
        ref: "A"
      }
    };
    const schemaB1 = {
      name: "String",
      a: ObjectID
    };
    const schemaC = {
      name: String,
      a: {
        type: ObjectID,
        autopopulate: true,
        ref: "A"
      },
      b: {
        type: ObjectID,
        autopopulate: true,
        ref: "B"
      }
    };
    const schemaD = {
      name: String,
      a: [{ type: ObjectID, autopopulate: true, ref: "A" }]
    };
    const schemaE = {
      name: String,
      b: [{ type: ObjectID, autopopulate: true, ref: "B" }]
    };
    A = registerSchema("A", schemaA);
    B = registerSchema("B", schemaB);
    B1 = registerSchema("B1", schemaB1);
    C = registerSchema("C", schemaC);
    D = registerSchema("D", schemaD);
    E = registerSchema("E", schemaE);
    //Model = orm.getCollection('Model')
    done();
  });

  afterEach(async () => {
    for (const collection of collections) {
      await orm.getCollection(collection, "myproject").remove();
    }
  });
  test("autopopulate", async () => {
    const one = await A.create({ name: "one" });
    const two = await B.create({ name: "two", a: one._id });
    expect(stringify(two)).toMatchInlineSnapshot(`
      Object {
        "_id": "ObjectID",
        "a": Object {
          "_id": "ObjectID",
          "name": "one",
        },
        "name": "two",
      }
    `);
  });
  test("deep populate 1", async () => {
    const one = await A.create({ name: "one" });
    const two = await B.create({ name: "two", a: one._id });
    const three = await C.create({ name: "three", a: one._id, b: two._id });
    expect(three.a.name).toBe("one");
    expect(three.b.name).toBe("two");
    expect(three.b.a.name).toBe("one");
  });
  test("deep populate 2", async () => {
    const Handler = registerSchema("Handler", {
      name: String
    });
    const Task = registerSchema("Task", {
      name: String,
      handler: {
        type: ObjectID,
        ref: "Handler",
        autopopulate: true
      }
    });
    const Application = registerSchema("Application", {
      name: String,
      tasks: [{ type: ObjectID, ref: "Task", autopopulate: true }]
    });
    const handler = await Handler.create({ name: "test" });
    const task = await Task.create({ name: "test2", handler: handler._id });
    const application = await Application.create({
      name: "test3",
      tasks: [task._id]
    });
    expect(stringify(application)).toMatchInlineSnapshot(`
      Object {
        "_id": "ObjectID",
        "name": "test3",
        "tasks": Array [
          Object {
            "_id": "ObjectID",
            "handler": Object {
              "_id": "ObjectID",
              "name": "test",
            },
            "name": "test2",
          },
        ],
      }
    `);
    expect(application.tasks[0].name).toBe("test2");
    expect(application.tasks[0].handler.name).toBe("test");
  });
  test("multiple paths with same options", async () => {
    const Company = registerSchema("Company", {
      name: String
    });
    const User = registerSchema("User", {
      name: String,
      company: {
        type: ObjectID,
        ref: "Company",
        autopopulate: true
      }
    });
    const Comment = registerSchema("Comment", {
      message: String,
      author: { type: ObjectID, ref: "User", autopopulate: true },
      target: { type: ObjectID, ref: "User", autopopulate: true }
    });
    const company = await Company.create({ name: "gigasource" });
    const user1 = await User.create({ name: "duong", company: company._id });
    const user2 = await User.create({ name: "thinh", company: company._id });
    const message = await Comment.create({
      message: "hello",
      author: user1._id,
      target: user2._id
    });
    expect(stringify(message)).toMatchInlineSnapshot(`
      Object {
        "_id": "ObjectID",
        "author": Object {
          "_id": "ObjectID",
          "company": Object {
            "_id": "ObjectID",
            "name": "gigasource",
          },
          "name": "duong",
        },
        "message": "hello",
        "target": Object {
          "_id": "ObjectID",
          "company": Object {
            "_id": "ObjectID",
            "name": "gigasource",
          },
          "name": "thinh",
        },
      }
    `);
    expect(message.author.name).toBe("duong");
    expect(message.target.name).toBe("thinh");
    expect(message.author.company.name).toBe("gigasource");
  });
  test("performance", async () => {
    const n = 1000;
    const listA = await A.create(_.range(n).map(i => ({ name: "" + i })));

    await B.create(_.range(n).map(i => ({ name: "" + i, a: listA[i]._id })));
    await B1.create(_.range(n).map(i => ({ name: "" + i, a: listA[i]._id })));
    const startTime = new Date().getTime();
    let bs = await B.find({});
    const endTime = new Date().getTime();
    const startTime1 = new Date().getTime();
    await B1.find({});
    const endTime1 = new Date().getTime();
    console.log(`with autopopulate: ${endTime - startTime} ms`);
    console.log(`without autopopulate: ${endTime1 - startTime1} ms`);
    expect(bs.length).toBe(n);
    for (let i = 0; i < bs.length; i++) {
      expect(bs[i].a.name).toBe("" + i);
    }
    expect(true).toBeTruthy();
  });
  test("populating array of object", async () => {
    const Blog = registerSchema("Blog", {
      name: String,
      creator: [{ type: ObjectID, ref: "User", autopopulate: true }]
    });
    const User = registerSchema("User", {
      name: String
    });
    const duong = await User.create({ name: "Duong" });
    const thinh = await User.create({ name: "Thinh" });
    const blog = await Blog.create({
      name: "pos",
      creator: [duong._id, thinh._id]
    });
    expect(stringify(blog)).toMatchInlineSnapshot(`
      Object {
        "_id": "ObjectID",
        "creator": Array [
          Object {
            "_id": "ObjectID",
            "name": "Duong",
          },
          Object {
            "_id": "ObjectID",
            "name": "Thinh",
          },
        ],
        "name": "pos",
      }
    `);
    expect(blog.creator[0].name).toBe("Duong");
    expect(blog.creator[1].name).toBe("Thinh");
  });
  test("null as ref", async () => {
    const a = await A.create({ name: "a" });
    const b = await B.create({ name: "b", a: null });
    expect(stringify(b)).toMatchInlineSnapshot(`
      Object {
        "_id": "ObjectID",
        "a": null,
        "name": "b",
      }
    `);
  });
  test("nulls as ref (array)", async () => {
    const a = await A.create({ name: "a" });
    const d = await D.create({ name: "d", a: [null, null, null, a._id] });
    expect(stringify(d)).toMatchInlineSnapshot(`
      Object {
        "_id": "ObjectID",
        "a": Array [
          null,
          null,
          null,
          Object {
            "_id": "ObjectID",
            "name": "a",
          },
        ],
        "name": "d",
      }
    `);
  });
  test("population of undefined fields in a collection of docs", async () => {
    const a = await A.create({ name: "a" });
    const b = await B.create({ name: "b", a: a._id });
    const b2 = await B.create({ name: "b2" });
    expect(stringify(b2)).toMatchInlineSnapshot(`
      Object {
        "_id": "ObjectID",
        "name": "b2",
      }
    `);
  });
  test("undefined for nested paths ", async () => {
    const a = await A.create({ name: "a" });
    const b = await B.create({ name: "b" });
    const b2 = await B.create({ name: "b2", a: a._id });
    const e = await E.create({ name: "e", b: [b._id, b2._id] });
    expect(stringify(e)).toMatchInlineSnapshot(`
      Object {
        "_id": "ObjectID",
        "b": Array [
          Object {
            "_id": "ObjectID",
            "name": "b",
          },
          Object {
            "_id": "ObjectID",
            "a": Object {
              "_id": "ObjectID",
              "name": "a",
            },
            "name": "b2",
          },
        ],
        "name": "e",
      }
    `);
  });
  test("select", async () => {
    const Student = registerSchema("Student", {
      name: String,
      age: Number,
      weight: Number
    });
    const Class = registerSchema("Class", {
      students: [{ type: ObjectID, autopopulate: "name age", ref: "Student" }]
    });
    const student1 = await Student.create({
      name: "duong",
      age: 20,
      weight: 10
    });
    const student2 = await Student.create({
      name: "thinh",
      age: 20,
      weight: 10
    });
    const class1 = await Class.create({
      students: [student1._id, student2._id]
    });
    expect(stringify(class1)).toMatchInlineSnapshot(`
      Object {
        "_id": "ObjectID",
        "students": Array [
          Object {
            "age": 20,
            "name": "duong",
          },
          Object {
            "age": 20,
            "name": "thinh",
          },
        ],
      }
    `);
    expect(class1.students[0].weight).toBeUndefined();
  });
});