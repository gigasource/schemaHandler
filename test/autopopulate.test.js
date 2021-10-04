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
let A, B, C, D, E, F;
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
    const schemaF = {
      name: String,
      d: [{ type: ObjectID, autopopulate: true, ref: "D" }]
    };
    A = registerSchema("A", schemaA);
    B = registerSchema("B", schemaB);
    B1 = registerSchema("B1", schemaB1);
    C = registerSchema("C", schemaC);
    D = registerSchema("D", schemaD);
    E = registerSchema("E", schemaE);
    F = registerSchema("F", schemaF);
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
    const n = 200;
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
  test("remove nulls as ref in array", async () => {
    const a = await A.create({ name: "a" });
    const d = await D.create({ name: "d", a: [null, null, null, a._id] });
    expect(stringify(d)).toMatchInlineSnapshot(`
      Object {
        "_id": "ObjectID",
        "a": Array [
          Object {
            "_id": "ObjectID",
            "name": "a",
          },
        ],
        "name": "d",
      }
    `);
  });
  test("remove nulls as ref in deep array", async () => {
    const a = await A.create({ name: "a" });
    const a1 = await A.create({ name: "a1" });
    const d = await D.create({ name: "d", a: [a._id, null, a1._id] });
    const f = await F.create({ name: "f", d: [null, d._id, null, null] });
    expect(stringify(f)).toMatchInlineSnapshot(`
      Object {
        "_id": "ObjectID",
        "d": Array [
          Object {
            "_id": "ObjectID",
            "a": Array [
              Object {
                "_id": "ObjectID",
                "name": "a",
              },
              Object {
                "_id": "ObjectID",
                "name": "a1",
              },
            ],
            "name": "d",
          },
        ],
        "name": "f",
      }
    `);
    expect(f.d.length).toBe(1);
    expect(f.d[0].a.length).toBe(2);
  });
  test("empty array ref", async () => {
    const d = await D.create({ name: "d", a: [] });
    expect(stringify(d)).toMatchInlineSnapshot(`
      Object {
        "_id": "ObjectID",
        "a": Array [],
        "name": "d",
      }
    `);
  });
  test("deep empty array", async () => {
    const d = await D.create({ name: "d", a: [] });
    const f = await F.create({ name: "f", d: [d._id] });
    expect(stringify(f)).toMatchInlineSnapshot(`
      Object {
        "_id": "ObjectID",
        "d": Array [
          Object {
            "_id": "ObjectID",
            "a": Array [],
            "name": "d",
          },
        ],
        "name": "f",
      }
    `);
    expect(f.d[0].a.length).toBe(0);
  });

  test("not exist ref", async () => {
    const b = await B.create({ name: "b", a: new ObjectID() });
    expect(b.a).toBe(null);
  });
  test("not exist ref array", async () => {
    const b = await B.create({ name: "b" });
    const e = await E.create({
      name: "e",
      b: [
        b._id,
        new ObjectID(),
        {},
        null,
        undefined,
        new Date(),
        "1234",
        b._id.toString(),
        false,
        true
      ]
    });
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
            "name": "b",
          },
        ],
        "name": "e",
      }
    `);
    expect(e.b.length).toBe(2);
  });
  test("missing ref", async () => {
    const a = await A.create({ name: "a" });
    const b = await B.create({ name: "b" });
    const d = await D.create({ name: "d" });
    expect(stringify(d)).toMatchInlineSnapshot(`
      Object {
        "_id": "ObjectID",
        "a": Array [],
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
  test("deselect", async() => {
    const Brand = registerSchema('Brand', {
      name: String,
      country: String
    })
    const Rubik = registerSchema('Rubik', {
      name: String,
      type: String,
      brand: {
        type: ObjectID,
        autopopulate: "-country",
        ref: "Brand"
      }
    })
    const gan = await Brand.create({name: 'Gan', country: 'China'})
    const gan11Pro = await Rubik.create({
      name: 'Gan 11 pro',
      type: '3x3',
      brand: gan._id
    })
    expect(gan11Pro.brand.name).toBe('Gan')
    expect(gan11Pro.brand.country).toBeUndefined()
  })
  test(" populate findOneAndUpdate result", async () => {
    const a = await A.create({ name: "a" });
    const a1 = await A.create({ name: "a1" });
    const b = await B.create({ name: "b" });
    const b1 = await B.findOneAndUpdate({ _id: b._id }, { name: "b1" });
    const b2 = await B.findOneAndUpdate(
      { _id: b._id },
      { name: "b2", a: a._id }
    );
    const b3 = await B.findOneAndUpdate(
      { _id: b._id },
      { name: "b3", a: a1._id }
    );
    expect(b2.a.name).toBe("a");
    expect(b3.a.name).toBe("a1");
  });
  test("populate findOne result", async () => {
    const a = await A.create({ name: "a" });
    const b = await B.create({ name: "b", a: a._id });
    const _b = await B.findOne();
    expect(_b.a.name).toBe("a");
  });
  test("populate updateMany result", async () => {
    const a = await A.create({ name: "a" });
    const a1 = await A.create({ name: "a1" });
    for (let i = 0; i < 10; i++) {
      await B.create({ name: `b${i}`, a: a._id });
    }
    const updatedBs = await B.updateMany({ a: a._id }, { a: a1._id });
    expect(updatedBs).toMatchInlineSnapshot(`
      Object {
        "n": 10,
        "nModified": 10,
        "ok": 1,
      }
    `);
    const db = await B.find({});
    for (let i = 0; i < 10; i++) {
      expect(db[i].a.name).toBe("a1");
    }
  });
  test("multi level array", async () => {
    const Cell = registerSchema("Cell", {
      x: Number,
      y: Number
    });
    const Grid = registerSchema("Grid", {
      rows: [
        {
          rowId: Number,
          cells: [
            {
              type: ObjectID,
              ref: "Cell",
              autopopulate: true
            }
          ]
        }
      ]
    });

    const cell0_0 = await Cell.create({ x: 0, y: 0 });
    const cell1_0 = await Cell.create({ x: 1, y: 0 });
    const grid = await Grid.create({
      rows: [
        { rowId: 0, cells: [cell0_0._id] },
        { rowId: 1, cells: [cell1_0._id] }
      ]
    });
    expect(stringify(grid)).toMatchInlineSnapshot(`
      Object {
        "_id": "ObjectID",
        "rows": Array [
          Object {
            "_id": "ObjectID",
            "cells": Array [
              Object {
                "_id": "ObjectID",
                "x": 0,
                "y": 0,
              },
            ],
            "rowId": 0,
          },
          Object {
            "_id": "ObjectID",
            "cells": Array [
              Object {
                "_id": "ObjectID",
                "x": 1,
                "y": 0,
              },
            ],
            "rowId": 1,
          },
        ],
      }
    `);
  });
  test("circular dependencies", async() => {
    const Account = registerSchema("Account", {
      name: String,
      createdBy: {
        type: ObjectID,
        ref: "Account",
        autopopulate: true
      }
    })
    const a = await Account.create({name: 'duong', createdBy: null})
    const b = await Account.create({name: 'thinh', createdBy: a._id})
    const c = await Account.create({name: 'xa', createdBy: b._id})
    expect(b.createdBy.name).toBe("duong")
    expect(c.createdBy.createdBy.name).toBe("duong")
  })

});
